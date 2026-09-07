import { describe, expect, it } from "vitest";
import { DEFAULT_ETA_CONFIG, type EtaConfig } from "./config.js";
import { EtaSignerNotConfiguredError, EtaSigningFailedError } from "./errors.js";
import { canonicalEtaJson, createExternalCommandSigner, unconfiguredEtaSigner } from "./signer.js";

/** guards P-1 — the e-seal leg. A CAdES-BES signature is made on the taxpayer's hardware token, never in-process. */

const ESEAL: EtaConfig = { ...DEFAULT_ETA_CONFIG, signingMethod: "eseal" };

describe("the ETA signer port", () => {
  it("refuses in Arabic, naming the missing setting, when no signing command is configured", async () => {
    const signer = createExternalCommandSigner({
      config: async () => ESEAL,
      run: async () => {
        throw new Error("the signing program must not be reached");
      },
    });

    await expect(signer.sign("{}")).rejects.toBeInstanceOf(EtaSignerNotConfiguredError);
    await expect(signer.sign("{}")).rejects.toThrow(/جهاز التوقيع/);
    await expect(signer.sign("{}")).rejects.toThrow(/أمر التوقيع الخارجي/);
  });

  it("treats a blank signing command as unconfigured", async () => {
    const signer = createExternalCommandSigner({
      config: async () => ({ ...ESEAL, signingCommand: "   " }),
      run: async () => ({ code: 0, stdout: "SIG", stderr: "" }),
    });
    await expect(signer.sign("{}")).rejects.toBeInstanceOf(EtaSignerNotConfiguredError);
  });

  it("hands the canonical JSON to the configured program on stdin and returns its stdout", async () => {
    let seen: { command: string; args: readonly string[]; stdin: string } | null = null;
    const signer = createExternalCommandSigner({
      config: async () => ({ ...ESEAL, signingCommand: "/opt/eta/sign", signingCommandArgs: ["--slot", "1"] }),
      run: async (command, args, stdin) => {
        seen = { command, args, stdin };
        return { code: 0, stdout: "  CADES-SIGNATURE\n", stderr: "" };
      },
    });

    const signature = await signer.sign('{"internalID":"INV-1"}');

    expect(signature).toBe("CADES-SIGNATURE");
    expect(seen!.command).toBe("/opt/eta/sign");
    expect(seen!.args).toEqual(["--slot", "1"]);
    expect(seen!.stdin).toBe('{"internalID":"INV-1"}');
  });

  it("reports the program's own stderr in Arabic when it exits non-zero", async () => {
    const signer = createExternalCommandSigner({
      config: async () => ({ ...ESEAL, signingCommand: "/opt/eta/sign" }),
      run: async () => ({ code: 2, stdout: "", stderr: "token not present" }),
    });

    await expect(signer.sign("{}")).rejects.toBeInstanceOf(EtaSigningFailedError);
    await expect(signer.sign("{}")).rejects.toThrow(/تعذّر توقيع المستند: token not present/);
  });

  it("refuses an empty signature rather than transmitting an unsigned document", async () => {
    const signer = createExternalCommandSigner({
      config: async () => ({ ...ESEAL, signingCommand: "/opt/eta/sign" }),
      run: async () => ({ code: 0, stdout: "   \n", stderr: "" }),
    });
    await expect(signer.sign("{}")).rejects.toBeInstanceOf(EtaSigningFailedError);
  });

  it("the default signer refuses every request", async () => {
    await expect(unconfiguredEtaSigner().sign("{}")).rejects.toBeInstanceOf(EtaSignerNotConfiguredError);
  });
});

describe("canonicalEtaJson", () => {
  it("orders keys deeply so the same document always yields the same bytes", () => {
    const a = canonicalEtaJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } });
    const b = canonicalEtaJson({ a: { c: 3, d: [{ y: 2, z: 1 }] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}');
  });
});
