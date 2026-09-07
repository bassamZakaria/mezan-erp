#!/usr/bin/env node
// `pnpm licence:keygen` — mints the vendor's Ed25519 signing keypair.
//
// Run ONCE. The private key signs every licence and every check-in answer the
// product will ever accept; the public key is baked into each build
// (MEZAN_LICENSE_PUBLIC_KEY, apps/desktop/scripts/build.mjs). Losing the
// private key means no shop can ever be licensed or renewed again; leaking it
// means anyone can mint licences for free. It belongs in the vendor's password
// manager or an HSM, never in this repository and never in CI logs.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { generateKeypair } from "./licence-crypto.mjs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : null;

const { privateKeyHex, publicKeyHex } = generateKeypair();

if (out) {
  writeFileSync(path.resolve(out), `${privateKeyHex}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`private key written to ${path.resolve(out)} (mode 0600)`);
} else {
  console.log(`MEZAN_LICENSE_PRIVATE_KEY=${privateKeyHex}`);
}
console.log(`MEZAN_LICENSE_PUBLIC_KEY=${publicKeyHex}`);
console.log(
  "\nSet the PUBLIC key in the release build environment; keep the private key off every machine that builds.",
);
