import {
  cre,
  Runner,
  type HTTPPayload,
  decodeJson,
  TeeRuntime,
  HTTPClient,
  text,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
} from "@chainlink/cre-sdk";
import type { APIPayload, ValidateX402OPayload } from "./types/types";
import { ed25519 } from "@noble/curves/ed25519.js";

type Config = {};
type Runtime = TeeRuntime<Config>;

const onHttpTrigger = async (
  runtime: Runtime,
  payload: HTTPPayload,
): Promise<string> => {
  const data = decodeJson(payload.input) as ValidateX402OPayload;
  runtime.log(`Block processing complete | `);

  const apiResponse = callApi(runtime, data.api);
  const validateResult = await validateApi(
    apiResponse,
    data.validationFunction,
  );
  return JSON.stringify({ validateResult }, null, 2);
};

const callApi = (runtime: Runtime, api: APIPayload): string => {
  const timestamp = runtime.now().getTime();
  const response = new HTTPClient()
    .sendRequest(runtime, {
      url: api.url,
      method: api.requestType,
      multiHeaders: {
        "content-type": { values: ["application/json"] },
        "x-signature": {
          values: [sig(runtime, timestamp, api.body)],
        },
        timestamp: { values: [timestamp.toString()] },
      },
      body: api.body,
    })
    .result();
  return bytesToBase64(response.body);
};

const validateApi = async (
  apiResponse: string,
  validationFunction: string,
): Promise<boolean> => {
  //TODO remove async wrapper
  //TODO make sure logging does not work
  const result: unknown = await eval(
    `(async function(apiResponse) {
      ${validationFunction}
    })(apiResponse)`,
  );

  if (typeof result != "boolean") {
    throw Error("Result of validation function should only be boolean");
  }

  return result;
};

const initWorkflow = () => {
  const http = new cre.capabilities.HTTPCapability();

  return [cre.handlerInTee(http.trigger({}), onHttpTrigger, {})];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();

const sig = (runtime: Runtime, timestamp: number, body: string): string => {
  const signingSecret = runtime.getSecret({ id: "API_SIGNING_KEY" }).result();
  const payload = JSON.stringify({
    timestamp,
    body: body,
  });
  return bytesToHex(
    ed25519.sign(
      new TextEncoder().encode(payload),
      hexToBytes(signingSecret.value),
    ),
  );
};
