import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
 * TWO THINGS ARE MIXED, NOT ONE. The OS machine id above is read by executing a
 * system binary on two of the three platforms, and that is exactly the weak
 * point: a bare `reg`/`ioreg` resolves through PATH, so anything earlier on the
 * PATH answers for it, and a pirate who reads one licensed machine's id can
 * make every other machine report it. Two changes close that:
 *
 *   1. ABSOLUTE PATHS. The binaries are invoked at their real locations
 *      (`%SystemRoot%\System32\reg.exe`, `/usr/sbin/ioreg`), never by name, so
 *      the PATH is not part of the answer.
 *   2. A SECOND, NON-SHELL SOURCE. A coarse hardware profile read straight out
 *      of the Node process — platform, architecture, CPU model, installed RAM
 *      rounded to whole gigabytes — is mixed in. It executes nothing, so no
 *      PATH trick reaches it, and transplanting a scraped machine id onto other
 *      hardware no longer reproduces the fingerprint. It is rounded and coarse
 *      on purpose: it must not change when a stick of RAM reports a slightly
 *      different byte count, or a licensed shop is locked out by its own PC.
 *
 * The reader is injected so the pure selection logic in `license.ts` is
 * testable without a real machine; `defaultMachineIdReader` binds the real
 * OS calls.
 */
export type MachineIdReader = (platform: NodeJS.Platform) => string;

/** `reg.exe` where Windows actually keeps it, never whatever PATH resolves. */
function windowsRegExe(): string {
  const systemRoot = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "reg.exe");
}

function readWindowsMachineGuid(): string {
  const out = execFileSync(
    windowsRegExe(),
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
    "/usr/sbin/ioreg",
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

/**
 * The non-shell half. Deliberately coarse: RAM is rounded to whole gibibytes
 * and only the first CPU's model string is used, so ordinary reporting jitter
 * cannot invalidate a licence.
 */
export function hardwareProfile(): string {
  const cpu = os.cpus()[0]?.model ?? "unknown-cpu";
  const gib = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  return `${process.platform}/${process.arch}/${cpu.replace(/\s+/g, " ").trim()}/${gib}G`;
}

/** Binds the real per-OS machine-id sources. */
export const defaultMachineIdReader: MachineIdReader = (platform) => {
  const osId = (() => {
    switch (platform) {
      case "win32":
        return readWindowsMachineGuid();
      case "darwin":
        return readMacIoPlatformUuid();
      default:
        return readLinuxMachineId();
    }
  })();
  return `${osId}|${hardwareProfile()}`;
};
