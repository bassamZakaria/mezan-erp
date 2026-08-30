import { X509Certificate } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { generate } from "selfsigned";

/**
 * The host's TLS identity for the multi-till socket.
 *
 * WHAT THIS FIXES. `startLanHost` served the shared Hono app over PLAIN HTTP.
 * `POST /auth/login` carries a user's PIN in the request body and hands back a
 * bearer token in the response body, and both crossed a WPA2-PSK shop network
 * whose key the staff, the delivery drivers and the customers all know — so
 * anyone associated to that wifi could read a PIN off the air and replay the
 * token. The token is worth the whole ERP: `packages/api/src/session-auth.ts`
 * binds a session to no device, no address and no seat, and it lives twelve
 * hours, so a capture at 09:00 is still an admin at 20:00.
 *
 * WHY SELF-SIGNED AND PINNED, not chain-validated. There is no CA a shop LAN
 * can reach, no DNS name to certify (the host is `192.168.1.7`, and it moves
 * when the router reboots), and no internet on most installs. The till instead
 * pins THIS certificate's SHA-256 fingerprint, which the consultant reads off
 * the connected-devices screen while standing in the shop. That only works if
 * the identity is stable, which is the single most important property of this
 * module — see `loadOrCreateLanTlsIdentity`.
 *
 * Deliberately free of any `electron` import (like lan-host.ts and
 * recovery.ts): the directory comes in as an argument, so vitest exercises the
 * real generate/persist/reload path headlessly.
 */

const KEY_FILE_NAME = "lan-tls-key.pem";
const CERT_FILE_NAME = "lan-tls-cert.pem";

/** Owner read/write only. The file is the host's TLS private key. */
const OWNER_ONLY = 0o600;

/**
 * Twenty years. NOT a security parameter here: nothing validates this chain,
 * so expiry buys no revocation — it only sets the date on which every paired
 * till stops trusting a host that has not changed. A one-year default would
 * have made the LAN feature fail, shop by shop, exactly one year after each
 * install, with the message "certificate expired" on a till whose operator has
 * no way to re-pair it.
 */
const VALIDITY_YEARS = 20;

/**
 * A day of backdating. Shop machines are frequently minutes-to-hours off, and
 * a certificate that is not yet valid is rejected by a TLS client that checks
 * dates at all.
 */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export interface LanTlsIdentity {
  /** PEM private key, as `https.createServer`'s `key`. */
  readonly key: string;
  /** PEM certificate, as `https.createServer`'s `cert`. */
  readonly cert: string;
  /**
   * `AB:CD:…` uppercase colon-separated hex, byte-identical to what a TLS
   * client sees as `getPeerCertificate().fingerprint256`. That equality is the
   * whole pinning contract: the string on the host's screen is the string the
   * till compares.
   */
  readonly fingerprintSha256: string;
  /** Where the pair lives, for the operator and for the loud failure message. */
  readonly keyPath: string;
  readonly certPath: string;
}

export function lanTlsPaths(dbPath: string): { keyPath: string; certPath: string } {
  const dir = path.dirname(dbPath);
  return { keyPath: path.join(dir, KEY_FILE_NAME), certPath: path.join(dir, CERT_FILE_NAME) };
}

/** The fingerprint a pinning client will compute for this certificate. */
export function certificateFingerprintSha256(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256;
}

/**
 * Every address a till might dial this host on, as SAN entries.
 *
 * Baked in at CREATION time and never revisited, because re-minting to cover a
 * new IP would change the fingerprint and break every till that pinned the old
 * one. A client that pins does not consult the SAN at all; this list exists so
 * that a client which ALSO does ordinary hostname verification is not stranded
 * on the common case (the host keeps its DHCP reservation for years).
 */
function subjectAltNames(): Array<{ type: 1 | 2 | 6 | 7; value?: string; ip?: string }> {
  const names: Array<{ type: 1 | 2 | 6 | 7; value?: string; ip?: string }> = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    { type: 7, ip: "::1" },
  ];

  const seen = new Set(["127.0.0.1", "::1"]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const family = String(entry.family);
      if (family !== "IPv4" && family !== "4") continue;
      if (seen.has(entry.address)) continue;
      seen.add(entry.address);
      names.push({ type: 7, ip: entry.address });
    }
  }
  return names;
}

async function mint(keyPath: string, certPath: string): Promise<LanTlsIdentity> {
  const notBeforeDate = new Date(Date.now() - CLOCK_SKEW_MS);
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + VALIDITY_YEARS);

  // `generate()` is a PROMISE in selfsigned v5 (v2's synchronous return is a
  // different library); awaiting it is not optional.
  const pems = await generate([{ name: "commonName", value: "Mezan LAN host" }], {
    keyType: "rsa",
    keySize: 2048,
    // Not the library's `sha1` default: a SHA-1 signature is rejected outright
    // by current TLS stacks, so the default would produce a certificate no
    // modern till can complete a handshake against.
    algorithm: "sha256",
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: subjectAltNames() },
    ],
  });

  await mkdir(path.dirname(keyPath), { recursive: true });

  // Both files, or neither. A key written without its certificate is read on
  // the next start as "half an identity", and the recovery for that is a
  // re-mint — which is exactly the fingerprint change this module exists to
  // prevent, arrived at by crash instead of by design.
  try {
    await writeFile(keyPath, pems.private, { encoding: "utf8", mode: OWNER_ONLY });
    // `writeFile`'s `mode` applies only when the file is CREATED, so a second
    // run over an existing world-readable file would keep the old permissions
    // (the same trap recovery.ts documents). On Windows this is a no-op and
    // the per-user app-data directory's ACL is what scopes the file.
    await chmod(keyPath, OWNER_ONLY).catch(() => undefined);
    await writeFile(certPath, pems.cert, { encoding: "utf8" });
  } catch (err) {
    await rm(keyPath, { force: true }).catch(() => undefined);
    await rm(certPath, { force: true }).catch(() => undefined);
    throw err;
  }

  return {
    key: pems.private,
    cert: pems.cert,
    fingerprintSha256: certificateFingerprintSha256(pems.cert),
    keyPath,
    certPath,
  };
}

async function readIfPresent(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * The host's identity: minted on the first LAN start, REUSED forever after.
 *
 * The reuse is the feature. A certificate regenerated each launch cannot be
 * pinned by anything, so a till would have to accept whatever key answered on
 * the address — which is the plain-HTTP threat model back again, wearing TLS:
 * a laptop that answers first on `192.168.1.7:4173` presents its own
 * certificate, the till accepts it, and the PIN goes to the laptop.
 *
 * A PRESENT-BUT-UNREADABLE pair therefore throws rather than re-minting. A new
 * fingerprint is indistinguishable, from the till's side, from an attacker
 * standing in for the host, so silently minting one would train the shop to
 * click past exactly the warning that protects it. The operator is told which
 * two files to look at; deleting them is a deliberate act that re-pairs every
 * till.
 */
export async function loadOrCreateLanTlsIdentity(dbPath: string): Promise<LanTlsIdentity> {
  const { keyPath, certPath } = lanTlsPaths(dbPath);

  const [key, cert] = await Promise.all([readIfPresent(keyPath), readIfPresent(certPath)]);

  if (key === null && cert === null) return mint(keyPath, certPath);

  if (key === null || cert === null) {
    const missing = key === null ? keyPath : certPath;
    throw new Error(
      `[lan-tls] half an identity on disk: ${missing} is missing while its pair is present. ` +
        `Delete both ${keyPath} and ${certPath} to mint a new one — every till that has ` +
        `pinned this host must then be paired again.`,
    );
  }

  let fingerprintSha256: string;
  try {
    fingerprintSha256 = certificateFingerprintSha256(cert);
  } catch (err) {
    throw new Error(
      `[lan-tls] ${certPath} is not a readable certificate (${String(err)}). It is NOT being ` +
        `replaced: a new certificate is indistinguishable from an impostor to every till that ` +
        `pinned the old one. Restore the file, or delete both it and ${keyPath} and re-pair.`,
    );
  }

  return { key, cert, fingerprintSha256, keyPath, certPath };
}
