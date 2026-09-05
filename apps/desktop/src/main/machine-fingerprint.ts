import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Raw machine fingerprint source (docs/archive/plan.md §2.5) for the desktop
 * edition — the per-OS hardware/install identity the domain hashes with a salt
 * before comparing against a license's `machineBinding`. The domain only ever
 * sees the raw string and never stores it, so this reads it and hands it over;
 * hashing and comparison stay in `@mezan/domain/licensing`.
 *
 * Each OS exposes a stable machine id that survives reboots but not a clean OS
 * reinstall — the correct granularity for binding a license to "this install on
 * this machine":
 *   - Windows: HKLM\SOFTWARE\Microsoft\Cryptography → MachineGuid
 *   - macOS:   IOPlatformUUID (ioreg)
 *   - Linux:   /etc/machine-id (or the D-Bus fallback)
 *
 * The reader is injected so the pure selection logic in `license.ts` is
 * testable without a real machine; `defaultMachineIdReader` binds the real
 * OS calls.
 */
export type MachineIdReader = (platform: NodeJS.Platform) => string;

function readWindowsMachineGuid(): string {
  const out = execFileSync(
    "reg",
    [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
      "/v",
      "MachineGuid",
    ],
    { encoding: "utf8" },
  );
  const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
  const id = match?.[1];
  if (!id) throw new Error("MachineGuid not found in registry output");
  return id.trim();
}

function readMacIoPlatformUuid(): string {
  const out = execFileSync(
    "ioreg",
    ["-rd1", "-c", "IOPlatformExpertDevice"],
    { encoding: "utf8" },
  );
  const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
  const id = match?.[1];
  if (!id) throw new Error("IOPlatformUUID not found in ioreg output");
  return id.trim();
}

function readLinuxMachineId(): string {
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = readFileSync(file, "utf8").trim();
      if (id) return id;
    } catch {
      // Try the next well-known location.
    }
  }
  throw new Error("machine-id not readable");
}

/** Binds the real per-OS machine-id sources. */
export const defaultMachineIdReader: MachineIdReader = (platform) => {
  switch (platform) {
    case "win32":
      return readWindowsMachineGuid();
    case "darwin":
      return readMacIoPlatformUuid();
    default:
      return readLinuxMachineId();
  }
};
