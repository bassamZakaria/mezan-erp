import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * WHERE A PACKAGED INSTALL'S LICENCE ACTUALLY COMES FROM.
 *
 * Entitlements were read from `MEZAN_ENTITLEMENTS_JSON` and from nowhere else.
 * An environment variable is a fine seam for a dev run and it is unreachable
 * from a real install: an app launched from the Start menu or the Dock inherits
 * no such variable, so every packaged Mezan in the field resolved to
 * UNLICENSED — zero seats, no modules, and `lan.multi_till` permanently off.
 * The multi-machine feature could not be switched on by anybody, which is not a
 * licensing policy, it is an unreachable code path.
 *
 * So the licence is a FILE, beside the database, where a consultant can put it
 * during a rollout and a support call can ask the owner to look for it.
 *
 * WHAT THIS IS NOT. It is not cryptographically verified. The contents are
 * schema-validated and nothing more — exactly the same trust level the
 * environment variable had, moved somewhere reachable. A signed, machine-bound
 * licence is a real thing this repo already models
 * (packages/domain/src/licensing: Ed25519 `verifyLicense`, machine fingerprint,
 * monotonic-clock guard) and it is NOT wired, because wiring it needs a signing
 * key and an activation service that do not exist yet (docs/archive/plan.md
 * Phase 8). Do not describe this file to a client as tamper-proof; anyone with
 * write access to the data directory can grant themselves every module. What it
 * buys today is an install that can be licensed at all, and one clear place for
 * the signed format to replace when it lands.
 *
 * docs/INSTALL.md §7 is where that honesty is owed to whoever sells this.
 */
export function licenceFilePath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "licence.json");
}

/**
 * The licence JSON for this install, or undefined when there is none.
 *
 * `MEZAN_ENTITLEMENTS_JSON` still wins when it is set, so every existing dev
 * script, test harness and `pnpm dev` invocation behaves exactly as before and
 * a developer can override a machine's real licence without deleting it.
 */
export async function readLicenceSource(
  dbPath: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  const fromEnv = env["MEZAN_ENTITLEMENTS_JSON"];
  if (fromEnv) return fromEnv;

  try {
    return await readFile(licenceFilePath(dbPath), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Not fatal, and deliberately so: an unreadable licence file falls to
      // unlicensed, which is closed. It is logged because a permissions problem
      // on this file looks identical, from the screen, to never having been
      // given a licence — and those need different phone calls.
      console.warn(`[licence] ${licenceFilePath(dbPath)} could not be read`, err);
    }
    return undefined;
  }
}
