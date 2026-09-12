import {
  cre,
  Runner,
  handlerInTee,
  HTTPClient,
  ok,
  text,
  type TeeRuntime,
  type HTTPPayload,
  decodeJson,
} from "@chainlink/cre-sdk";
import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import type { Config } from "./types/types";

// What callers send. apiResponse is plaintext; fn is ECIES-encrypted to the
// workflow's public key: ephemeral x25519 pubkey + AES-GCM over an
// HKDF(shared secret) key. Only the enclave can unwrap it.
type EncryptedFunctionPayload = {
  apiResponse: string;
  fn: {
    eph: string;
    nonce: string;
    ct: string;
  };
};

const HKDF_INFO = new TextEncoder().encode("validation-fn");

const decryptFunction = (privKey: Uint8Array, fn: EncryptedFunctionPayload["fn"]): string => {
  const shared = x25519.getSharedSecret(privKey, hexToBytes(fn.eph));
  const key = hkdf(sha256, shared, undefined, HKDF_INFO, 32);
  const plaintext = gcm(key, hexToBytes(fn.nonce)).decrypt(hexToBytes(fn.ct));
  return new TextDecoder().decode(plaintext);
};

const onHttpTrigger = async (
  runtime: TeeRuntime<Config>,
  payload: HTTPPayload,
): Promise<string> => {
  const data = decodeJson(payload.input) as EncryptedFunctionPayload;

  // The private key is released by the Vault DON only into this attested enclave.
  const privSecret = runtime.getSecret({ id: "FN_PRIVATE_KEY" }).result();
  const functionCode = decryptFunction(hexToBytes(privSecret.value), data.fn);

  // AsyncFunction runs the caller's code in global scope, NOT in this closure —
  // otherwise caller code could read privSecret and decrypt everyone's payloads.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    arg: string,
    body: string,
  ) => (apiResponse: string) => Promise<unknown>;
  const result: unknown = await new AsyncFunction("apiResponse", functionCode)(
    data.apiResponse,
  );

  // Sign {timestamp, result} with the enclave-only signing key. The protected
  // API verifies this against the workflow's public key — a valid fresh
  // signature proves the request came from this workflow, inside an attested
  // enclave (the Vault DON releases the key nowhere else).
  const signingSecret = runtime.getSecret({ id: "API_SIGNING_KEY" }).result();
  const body = JSON.stringify({ timestamp: runtime.now().getTime(), result });
  const signature = bytesToHex(
    ed25519.sign(new TextEncoder().encode(body), hexToBytes(signingSecret.value)),
  );

  const response = new HTTPClient()
    .sendRequest(runtime, {
      url: runtime.config.apiUrl as string,
      method: "POST",
      multiHeaders: {
        "content-type": { values: ["application/json"] },
        "x-signature": { values: [signature] },
      },
      body: Buffer.from(body).toString("base64"),
    })
    .result();

  const status = ok(response) ? "accepted" : "rejected";
  return JSON.stringify({ apiStatus: response.statusCode, apiVerdict: status, apiBody: text(response) });
};

const initWorkflow = (config: Config) => {
  const http = new cre.capabilities.HTTPCapability();

  return [handlerInTee(http.trigger({}), onHttpTrigger, {})];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
