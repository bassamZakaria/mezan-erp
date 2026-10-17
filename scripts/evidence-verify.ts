import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { EVIDENCE_PACK_FORMAT, EvidenceFileName, verifyEvidenceManifest, type EvidenceManifest } from "@mezan/domain";

enum Verdict {
  Ok = "OK",
  Fail = "FAIL",
  Warn = "WARN",
}

function report(verdict: Verdict, message: string): void {
  console.log(`${verdict.padEnd(4)}  ${message}`);
}

async function main(): Promise<number> {
  const [zipPath, expectedKey] = process.argv.slice(2);
  if (!zipPath) {
    console.error("usage: pnpm evidence:verify <pack.zip> <public-key-hex>");
    console.error("The public key must come from the Mezan screen «حزمة أدلة المراجعة» or from the company in writing — not from inside the pack.");
    return 2;
  }
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const manifestBytes = files[EvidenceFileName.Manifest];
  const signatureBytes = files[EvidenceFileName.Signature];
  if (!manifestBytes || !signatureBytes) {
    report(Verdict.Fail, "manifest.json or manifest.sig is missing");
    return 1;
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as EvidenceManifest;
  let failures = 0;
  if (manifest.format !== EVIDENCE_PACK_FORMAT) {
    report(Verdict.Fail, `unknown pack format ${String(manifest.format)}`);
    failures += 1;
  }
  const key = (expectedKey ?? manifest.signing.publicKeyHex).toLowerCase();
  if (!expectedKey) report(Verdict.Warn, "no public key given: checking against the key printed inside the pack, which proves integrity only, not origin");
  else if (key !== manifest.signing.publicKeyHex.toLowerCase()) report(Verdict.Warn, `the pack names key ${manifest.signing.publicKeyHex}, not the key you supplied`);
  const signed = await verifyEvidenceManifest(manifestBytes, new TextDecoder().decode(signatureBytes), key);
  report(signed ? Verdict.Ok : Verdict.Fail, `Ed25519 signature over manifest.json (key id ${manifest.signing.keyId})`);
  if (!signed) failures += 1;

  const listed = new Set<string>();
  for (const entry of manifest.files) {
    listed.add(entry.name);
    const content = files[entry.name];
    const actual = content ? createHash("sha256").update(content).digest("hex") : null;
    const ok = actual === entry.sha256 && content?.length === entry.bytes;
    report(ok ? Verdict.Ok : Verdict.Fail, `${entry.name}  sha256 ${entry.sha256}${ok ? "" : `  (found ${actual ?? "missing"})`}`);
    if (!ok) failures += 1;
  }
  for (const name of Object.keys(files)) {
    if (name === EvidenceFileName.Manifest || name === EvidenceFileName.Signature || listed.has(name)) continue;
    report(Verdict.Fail, `${name} is in the archive but not in the signed manifest`);
    failures += 1;
  }
  report(manifest.auditChain.ok ? Verdict.Ok : Verdict.Warn, `audit chain at build time: ${manifest.auditChain.reason ?? "unknown"} (${manifest.auditChain.checkedRows} rows checked)`);
  console.log(failures === 0 ? "\nPACK VERIFIED / الحزمة سليمة" : `\nPACK FAILED VERIFICATION — ${failures} problem(s) / الحزمة لم تجتز التحقق`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(2);
  },
);
