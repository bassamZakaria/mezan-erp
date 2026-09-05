import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseDesktopEntitlementsJson } from "./entitlements.js";
import {
  createFingerprintSource,
  createMonotonicClockStore,
  decideLicense,
  systemClock,
  type DesktopLicense,
} from "./license.js";

/**
 * Runtime binder for the desktop license (docs/archive/plan.md §2.5): reads the
 * `license.mezan` file and env config off the machine and drives the pure
 * `decideLicense`. Kept out of `license.ts` so that module stays adapter-pure
 * and unit-testable; kept out of `index.ts` so it never imports Electron and
 * can be exercised headlessly by passing `userDataDir`/`packaged` directly.
 *
 * Distribution note: `MEZAN_LICENSE_PUBLIC_KEY` and
 * `MEZAN_LICENSE_FINGERPRINT_SALT` are baked at build time by the vendor's
 * release pipeline. The empty defaults below are deliberate — an install with
 * no public key configured cannot verify a license and therefore fails CLOSED
 * (read-only), never open.
 */

const VENDOR_PUBLIC_KEY_HEX = ""; // set by the release build (electron-builder env)
const FINGERPRINT_SALT = "mezan.license.fingerprint.v1";

export interface LoadLicenseInput {
  /** Electron `app.getPath("userData")`. */
  readonly userDataDir: string;
  /** Electron `app.isPackaged`. */
  readonly packaged: boolean;
  readonly env?: Record<string, string | undefined>;
}

function readFileOrNull(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/** Reads and verifies the license on disk, returning entitlements + write state. */
export async function loadDesktopLicense(input: LoadLicenseInput): Promise<DesktopLicense> {
  const env = input.env ?? process.env;

  const licenseFile = env["MEZAN_LICENSE_FILE"] ?? path.join(input.userDataDir, "license.mezan");
  const licenseRaw = env["MEZAN_LICENSE"] ?? readFileOrNull(licenseFile);

  const publicKey = env["MEZAN_LICENSE_PUBLIC_KEY"] || VENDOR_PUBLIC_KEY_HEX || null;
  const fingerprintSalt = env["MEZAN_LICENSE_FINGERPRINT_SALT"] || FINGERPRINT_SALT;

  const monotonicStore = createMonotonicClockStore(
    path.join(input.userDataDir, "license-clock.json"),
    {
      readFile: readFileOrNull,
      writeFile: (p, data) => writeFileSync(p, data, "utf8"),
    },
  );

  return decideLicense({
    licenseRaw,
    publicKey,
    fingerprintSalt,
    packaged: input.packaged,
    devEntitlements: parseDesktopEntitlementsJson(env),
    clock: systemClock,
    fingerprintSource: createFingerprintSource(),
    monotonicStore,
  });
}
