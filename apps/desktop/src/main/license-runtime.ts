import { readFileSync } from "node:fs";
import path from "node:path";
import { saltedFingerprintHash } from "@mezan/domain";
import { parseDesktopEntitlementsJson } from "./entitlements.js";
import { createLicenseGuardStore, type LicenseGuardStore } from "./license-checkin.js";
import {
  createFingerprintSource,
  createGuardMonotonicStore,
  decideLicense,
  systemClock,
  type DesktopLicense,
} from "./license.js";

/**
 * Runtime binder for the desktop license (docs/archive/plan.md §2.5): reads the
 * `license.mezan` file and the BAKED vendor configuration off the build, and
 * drives the pure `decideLicense`. Kept out of `license.ts` so that module stays
 * adapter-pure and unit-testable; kept out of `index.ts` so it never imports
 * Electron and can be exercised headlessly by passing `userDataDir`/`packaged`
 * directly.
 *
 * WHY THE VENDOR CONFIGURATION IS BAKED, NOT READ FROM THE ENVIRONMENT.
 *
 * The public key, the fingerprint salt and the check-in address used to be read
 * from `process.env` with an empty compile-time default and nothing anywhere
 * that set them. A packaged app launched from the Dock or the Start menu has no
 * environment, so every shipped build resolved to `NO_PUBLIC_KEY` and no paid
 * licence file could ever be verified: the shop saw a red banner blaming them
 * for a build defect.
 *
 * They are now substituted into this module at build time by esbuild `define`
 * (apps/desktop/scripts/build.mjs), from the release environment. And on a
 * PACKAGED build the environment is refused outright — the same rule
 * `decideLicense` already applied to `MEZAN_ENTITLEMENTS_JSON`, for the same
 * reason: a licence check whose key, salt, licence path or licensing address
 * can be replaced by an environment variable is a licence check anybody with a
 * shortcut's Properties dialog can switch off.
 */

// Substituted by esbuild `define`. `typeof` keeps them safe to reference when
// nothing was substituted (vitest, `tsx`, a plain `node` run of the sources).
declare const __MEZAN_LICENSE_PUBLIC_KEY__: string;
declare const __MEZAN_LICENSE_FINGERPRINT_SALT__: string;
declare const __MEZAN_LICENSE_CHECKIN_URL__: string;

export const BAKED_LICENSE_PUBLIC_KEY: string =
  typeof __MEZAN_LICENSE_PUBLIC_KEY__ === "string" ? __MEZAN_LICENSE_PUBLIC_KEY__ : "";

/** The default salt is public and deliberately so — the SECRET is the key. */
export const DEFAULT_FINGERPRINT_SALT = "mezan.license.fingerprint.v1";

export const BAKED_FINGERPRINT_SALT: string =
  typeof __MEZAN_LICENSE_FINGERPRINT_SALT__ === "string" &&
  __MEZAN_LICENSE_FINGERPRINT_SALT__ !== ""
    ? __MEZAN_LICENSE_FINGERPRINT_SALT__
    : DEFAULT_FINGERPRINT_SALT;

export const BAKED_CHECKIN_URL: string =
  typeof __MEZAN_LICENSE_CHECKIN_URL__ === "string" ? __MEZAN_LICENSE_CHECKIN_URL__ : "";

export interface VendorConfig {
  readonly publicKey: string | null;
  readonly fingerprintSalt: string;
  readonly checkinUrl: string | undefined;
  readonly licenseFile: string;
  readonly licenseRawOverride: string | null;
}

/**
 * The vendor configuration this process will actually use.
 *
 * On a packaged build NOTHING from `env` is consulted. Unpackaged, every value
 * may be overridden so a developer can drive the whole path with a throwaway
 * keypair.
 */
export function resolveVendorConfig(input: {
  readonly userDataDir: string;
  readonly packaged: boolean;
  readonly env?: Record<string, string | undefined>;
}): VendorConfig {
  const env = input.packaged ? {} : (input.env ?? process.env);
  return {
    publicKey: env["MEZAN_LICENSE_PUBLIC_KEY"] || BAKED_LICENSE_PUBLIC_KEY || null,
    fingerprintSalt: env["MEZAN_LICENSE_FINGERPRINT_SALT"] || BAKED_FINGERPRINT_SALT,
    checkinUrl: env["MEZAN_LICENSE_CHECKIN_URL"] || BAKED_CHECKIN_URL || undefined,
    licenseFile: env["MEZAN_LICENSE_FILE"] ?? path.join(input.userDataDir, "license.mezan"),
    licenseRawOverride: env["MEZAN_LICENSE"] ?? null,
  };
}

export interface LoadLicenseInput {
  /** Electron `app.getPath("userData")`. */
  readonly userDataDir: string;
  /** Electron `app.isPackaged`. */
  readonly packaged: boolean;
  /**
   * The tenant database's sealed encryption key, when the install is
   * encrypted. It is what the anti-rollback record is MAC'd with; `null` on an
   * unencrypted or dev install, where there is no such secret to bind to.
   */
  readonly databaseKey?: string | null;
  readonly env?: Record<string, string | undefined>;
  /** Pre-built guard store; supplied by tests. */
  readonly guardStore?: LicenseGuardStore;
}

function readFileOrNull(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export interface LoadedDesktopLicense {
  readonly license: DesktopLicense;
  readonly config: VendorConfig;
  readonly guard: LicenseGuardStore;
}

/** Reads and verifies the license on disk, returning entitlements + write state. */
export async function loadDesktopLicense(input: LoadLicenseInput): Promise<LoadedDesktopLicense> {
  const config = resolveVendorConfig(input);
  const licenseRaw = config.licenseRawOverride ?? readFileOrNull(config.licenseFile);

  const guard =
    input.guardStore ??
    createLicenseGuardStore({
      dir: input.userDataDir,
      macKey: input.databaseKey ?? null,
    });

  const license = await decideLicense({
    licenseRaw,
    publicKey: config.publicKey,
    fingerprintSalt: config.fingerprintSalt,
    packaged: input.packaged,
    devEntitlements: input.packaged
      ? null
      : parseDesktopEntitlementsJson(input.env ?? process.env),
    clock: systemClock,
    fingerprintSource: createFingerprintSource(),
    monotonicStore: createGuardMonotonicStore(guard),
  });

  return { license, config, guard };
}

/**
 * `--print-machine-fingerprint`: the one value a replacement PC needs and that
 * nothing in the product could previously produce.
 *
 * A shop whose machine died restores its backup onto new hardware, meets
 * `MACHINE_NOT_BOUND`, and neither the owner nor support can obtain the string
 * that would let a new licence be issued — there was no flag, no panel and no
 * log carrying it. This prints exactly the hash `machineBinding` compares
 * against, under the salt THIS build was made with, so the answer is always
 * right for the binary in front of the user.
 */
export async function printableMachineFingerprint(input: {
  readonly userDataDir: string;
  readonly packaged: boolean;
  readonly env?: Record<string, string | undefined>;
}): Promise<string> {
  const config = resolveVendorConfig(input);
  const raw = await createFingerprintSource().read();
  return saltedFingerprintHash(raw, config.fingerprintSalt);
}
