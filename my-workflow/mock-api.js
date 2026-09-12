// Mock protected API: only serves requests signed by the workflow's
// enclave-held ed25519 key, with a fresh timestamp. Run: node mock-api.js
// WRONG_PUBKEY=1 node mock-api.js  -> uses a random pubkey (all requests 401)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";

const cfg = JSON.parse(
  readFileSync(new URL("./config/config.tee.json", import.meta.url)),
);
const PUBKEY = process.env.WRONG_PUBKEY
  ? bytesToHex(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))
  : cfg.apiPublicKey;
const MAX_SKEW_MS = 60_000;

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const sigHex = req.headers["x-signature"];
    const timestamp = +req.headers["timestamp"];
    const fail = (code, error) => {
      console.log(`${code} ${error}`);
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify({ error }));
    };

    let parsed;
    try {
      parsed = JSON.parse(body.toString());
    } catch {
      return fail(400, "bad json");
    }
    if (
      typeof timestamp !== "number" ||
      Math.abs(Date.now() - timestamp) > MAX_SKEW_MS
    ) {
      return fail(
        401,
        `stale timestamp (got ${timestamp}, server ${Date.now()})`,
      );
    }

    const sigPayload = {
      timestamp,
      body,
    };
    if (
      typeof sigHex !== "string" ||
      !ed25519.verify(
        hexToBytes(sigHex.substring(2)),
        new TextEncoder().encode(JSON.stringify(sigPayload)),
        hexToBytes(PUBKEY),
      )
    ) {
      return fail(401, "invalid signature");
    }
    console.log(`200 ok, signed payload:`, parsed);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", accepted: parsed }));
  });
});

server.listen(3457, () =>
  console.log(`mock API on :3457, expecting pubkey ${PUBKEY.slice(0, 16)}...`),
);
