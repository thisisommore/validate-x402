// Test client: signs requests exactly like the workflow and calls the mock API.
// Expects /tmp/test_keypair.json ({pub, priv}) and mock-api.js on :3458.
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { readFileSync } from "node:fs";

const { priv } = JSON.parse(readFileSync("/tmp/test_keypair.json", "utf8"));
const privBytes = hexToBytes(priv);

const counts = {};
for (let i = 0; i < 6; i++) {
  const rawBody = JSON.stringify({ test: i });
  const timestamp = Date.now();
  const sigPayload = JSON.stringify({
    timestamp,
    body: Buffer.from(rawBody).toString("base64"),
  });
  const sig =
    "0x" + bytesToHex(ed25519.sign(new TextEncoder().encode(sigPayload), privBytes));

  const res = await fetch("http://localhost:3458", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": sig,
      timestamp: String(timestamp),
    },
    body: rawBody,
  });
  const name = res.headers.get("x-image-name");
  const bytes = (await res.arrayBuffer()).byteLength;
  if (res.status === 200) counts[name] = (counts[name] || 0) + 1;
  console.log(`call ${i}: ${res.status} ${name ?? ""} ${bytes} bytes`);
}
console.log("distribution:", counts);
