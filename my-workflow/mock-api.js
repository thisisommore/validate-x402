// Mock protected API: only serves requests signed by the workflow's
// enclave-held ed25519 key, with a fresh timestamp. Run: node mock-api.js
// WRONG_PUBKEY=1 node mock-api.js  -> uses a random pubkey (all requests 401)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";

const cfg = JSON.parse(
  readFileSync(new URL("./config/config.tee.json", import.meta.url)),
);
const PUBKEY = process.env.WRONG_PUBKEY
  ? bytesToHex(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))
  : process.env.API_PUBKEY || cfg.apiPublicKey;
const MAX_SKEW_MS = 60_000;

const IMAGES = ["paint_high_color.png", "paint_low_color.png"].map((name) => ({
  name,
  data: readFileSync(new URL(`./test-images/${name}`, import.meta.url)),
}));

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
      console.log("body", body.toString());
      parsed = JSON.parse(body.toString());
      console.log("parsed", parsed);
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
      body: Buffer.from(body).toString("base64"),
    };
    if (
      typeof sigHex !== "string" ||
      !ed25519.verify(
        hexToBytes(sigHex.substring(2)),
        new TextEncoder().encode(JSON.stringify(sigPayload)),
        hexToBytes(PUBKEY),
      )
    ) {
      console.log("verify failed for ", JSON.stringify(sigPayload));
      return fail(401, "invalid signature");
    }
    const image = IMAGES[randomInt(IMAGES.length)];
    console.log(`200 ok, serving ${image.name}, signed payload:`, parsed);
    res.writeHead(200, {
      "content-type": "image/png",
      "x-image-name": image.name,
    });
    res.end(image.data);
  });
});

const PORT = process.env.PORT || 3457;
server.listen(PORT, () =>
  console.log(
    `mock API on :${PORT}, expecting pubkey ${PUBKEY.slice(0, 16)}...`,
  ),
);
