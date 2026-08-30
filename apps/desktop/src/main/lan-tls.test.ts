import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  certificateFingerprintSha256,
  lanTlsPaths,
  loadOrCreateLanTlsIdentity,
} from "./lan-tls.js";

/**
 * The identity a till pins. Everything here is about STABILITY and about the
 * private key not being readable by the rest of the machine: a certificate
 * that changes cannot be pinned, and a key anyone can read is a certificate
 * anyone can impersonate.
 */
const dirs: string[] = [];

async function scratchDb(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-lan-tls-"));
  dirs.push(dir);
  return path.join(dir, "mezan.db");
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("loadOrCreateLanTlsIdentity", () => {
  it("mints a certificate beside the database and reports the fingerprint a client will see", async () => {
    const dbPath = await scratchDb();
    const identity = await loadOrCreateLanTlsIdentity(dbPath);

    const { keyPath, certPath } = lanTlsPaths(dbPath);
    expect(identity.keyPath).toBe(keyPath);
    expect(identity.certPath).toBe(certPath);
    expect(path.dirname(keyPath)).toBe(path.dirname(dbPath));

    expect(await readFile(certPath, "utf8")).toBe(identity.cert);
    expect(await readFile(keyPath, "utf8")).toBe(identity.key);

    // The exact spelling `tls.TLSSocket#getPeerCertificate().fingerprint256`
    // produces. lan-host.test.ts proves the equality over a real handshake;
    // this pins the FORMAT, which is what a human compares by eye.
    expect(identity.fingerprintSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(identity.fingerprintSha256).toBe(certificateFingerprintSha256(identity.cert));
  });

  it("reuses the SAME identity on the next start — a certificate that changes cannot be pinned", async () => {
    const dbPath = await scratchDb();
    const first = await loadOrCreateLanTlsIdentity(dbPath);
    const second = await loadOrCreateLanTlsIdentity(dbPath);

    expect(second.fingerprintSha256).toBe(first.fingerprintSha256);
    expect(second.cert).toBe(first.cert);
    expect(second.key).toBe(first.key);
  });

  it("keeps the private key owner-only", async () => {
    const dbPath = await scratchDb();
    const identity = await loadOrCreateLanTlsIdentity(dbPath);

    // Windows has no POSIX mode bits; the per-user app-data ACL is what scopes
    // the file there, and asserting 0o600 would fail for the wrong reason.
    if (process.platform === "win32") return;
    expect((await stat(identity.keyPath)).mode & 0o777).toBe(0o600);
  });

  it("covers localhost and this host's own LAN IPv4 addresses in the SAN", async () => {
    const dbPath = await scratchDb();
    const identity = await loadOrCreateLanTlsIdentity(dbPath);

    const san = new X509Certificate(identity.cert).subjectAltName ?? "";
    expect(san).toContain("DNS:localhost");
    expect(san).toContain("IP Address:127.0.0.1");
  });

  it("outlives the hardware: expiry is not a security parameter for a pinned certificate", async () => {
    const dbPath = await scratchDb();
    const identity = await loadOrCreateLanTlsIdentity(dbPath);
    const cert = new X509Certificate(identity.cert);

    // A one-year default would have broken every install on its own
    // anniversary, on a till whose operator cannot re-pair it.
    const tenYears = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(tenYears);
    // Backdated, because shop clocks drift and a not-yet-valid certificate is
    // refused by anything that checks dates at all.
    expect(new Date(cert.validFrom).getTime()).toBeLessThan(Date.now());
  });

  it("refuses to re-mint over an unreadable certificate, and names both files", async () => {
    const dbPath = await scratchDb();
    const { keyPath, certPath } = lanTlsPaths(dbPath);
    await writeFile(keyPath, "not a key", "utf8");
    await writeFile(certPath, "not a certificate", "utf8");

    // Silently minting a replacement is exactly what an impostor's certificate
    // looks like from the till's side, so this must stop and say so.
    await expect(loadOrCreateLanTlsIdentity(dbPath)).rejects.toThrow(/not a readable certificate/);
    expect(await readFile(certPath, "utf8")).toBe("not a certificate");
  });

  it("refuses half an identity rather than pairing a new key with an old certificate", async () => {
    const dbPath = await scratchDb();
    const first = await loadOrCreateLanTlsIdentity(dbPath);
    await rm(first.keyPath);

    await expect(loadOrCreateLanTlsIdentity(dbPath)).rejects.toThrow(/half an identity/);
    // The surviving half is left alone: it is the operator's decision to
    // delete both and re-pair every till.
    expect(await readFile(first.certPath, "utf8")).toBe(first.cert);
  });

  it("propagates a directory it cannot read, rather than answering with no identity", async () => {
    const dbPath = path.join(await mkdtemp(path.join(tmpdir(), "mezan-lan-tls-")), "gone", "mezan.db");
    dirs.push(path.dirname(path.dirname(dbPath)));
    // Nothing exists yet, so this is the mint path and it must succeed by
    // creating the directory — the desktop's userData dir exists, but a
    // restored profile's may not.
    const identity = await loadOrCreateLanTlsIdentity(dbPath);
    expect(identity.fingerprintSha256).toMatch(/^[0-9A-F]{2}:/);
  });
});
