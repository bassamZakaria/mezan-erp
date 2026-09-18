/**
 * التوقيع الإلكتروني (CAdES-BES) — the e-seal leg of ETA e-invoicing.
 *
 * The authority requires document version 1.0 to carry a CAdES-BES signature
 * produced with the taxpayer's own hardware token (USB e-signature device).
 * The private key never leaves that token, so NO in-process implementation is
 * possible — any code here that produced a signature by itself would be
 * producing an invalid one. The only honest shape is a port that hands the
 * canonical serialisation to an operator-configured external signing program:
 * canonical JSON on stdin, the signature value on stdout.
 *
 * When that program is not configured the refusal is Arabic and names the
 * missing setting, rather than failing somewhere inside the gateway with a
 * rejection code.
 */
import { EtaSignerNotConfiguredError, EtaSigningFailedError } from "./errors.js";
import type { EtaConfig } from "./config.js";

export interface EtaSignerPort {
  /**
   * @param canonicalJson the document exactly as it will be transmitted, in the
   * authority's canonical serialisation. The signature covers these bytes.
   */
  sign(canonicalJson: string): Promise<string>;
}

export interface EtaCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the operator's signing program. Injected so the domain keeps no process dependency. */
export type EtaCommandRunner = (
  command: string,
  args: readonly string[],
  stdin: string,
) => Promise<EtaCommandResult>;

export interface ExternalCommandSignerDeps {
  readonly run: EtaCommandRunner;
  readonly config: () => Promise<EtaConfig>;
}

export function createExternalCommandSigner(deps: ExternalCommandSignerDeps): EtaSignerPort {
  return {
    async sign(canonicalJson: string): Promise<string> {
      const config = await deps.config();
      const command = (config.signingCommand ?? "").trim();
      if (command === "") throw new EtaSignerNotConfiguredError();
      const result = await deps.run(command, config.signingCommandArgs, canonicalJson);
      if (result.code !== 0) {
        throw new EtaSigningFailedError(result.stderr.trim() || `انتهى برنامج التوقيع بالرمز ${result.code}.`);
      }
      const signature = result.stdout.trim();
      if (signature === "") throw new EtaSigningFailedError("لم يُرجع برنامج التوقيع أي توقيع.");
      return signature;
    },
  };
}

/**
 * A signer that refuses every request. The default when no signing program is
 * configured, so a v1.0 install that has not been set up says so in Arabic
 * instead of transmitting an unsigned document the authority will reject.
 */
export function unconfiguredEtaSigner(): EtaSignerPort {
  return {
    async sign(): Promise<string> {
      throw new EtaSignerNotConfiguredError();
    },
  };
}

/**
 * The bytes the signature covers. The authority canonicalises by ordering
 * object keys and dropping insignificant whitespace; getting this wrong yields
 * a signature that verifies against nothing, so it is derived from the payload
 * once, here, and used by both the signer and the transmitted document.
 */
export function canonicalEtaJson(payload: unknown): string {
  return JSON.stringify(sortDeep(payload));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]));
}
