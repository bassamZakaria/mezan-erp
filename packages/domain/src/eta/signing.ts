/**
 * الختم الإلكتروني — the e-seal seam.
 *
 * A document filed at version 1.0 must carry the taxpayer's electronic seal,
 * produced by an HSM or a signing agent holding the certificate. Neither
 * exists in this environment, and the previous behaviour was worse than not
 * having one: a submission moved to «بانتظار التوقيع», nothing signed it, and
 * pressing إرسال a second time transmitted it ANYWAY — unsigned, at version
 * 1.0. So the parking state read like a queue and behaved like a hole.
 *
 * The port below is the seam. Its default REFUSES and records why, so a
 * document parks and stays parked, and the operator sees the reason on the
 * row instead of discovering it at a tax audit. Wiring a real agent is
 * supplying this port — configuration, not surgery.
 */

import type { EtaConfig } from "./config.js";
import type { EtaSubmission } from "./submission.js";

export interface EtaSignatureResult {
  /**
   * EXTERNAL CONTRACT: `signatureType` "I" is the issuer's seal (as opposed to
   * "S", a service provider's). `value` is the CAdES-BES detached signature
   * over the canonically serialized document, base64-encoded.
   */
  readonly signatureType: "I" | "S";
  readonly value: string;
  readonly signedAt: string;
  /** The certificate the seal was produced with, kept for the audit trail. */
  readonly certificateSubject?: string | null;
}

/**
 * The signing agent. It receives the submission whose payload is to be sealed
 * and the config identifying the taxpayer, and returns the signature block the
 * authority expects on the document.
 *
 * Implementations must throw {@link EtaSigningUnavailableError} — not return a
 * placeholder — when no certificate, HSM or agent is reachable. A document
 * bearing a fabricated seal is a filed document that cannot be verified.
 */
export interface EtaSigningPort {
  sign(submission: EtaSubmission, config: EtaConfig): Promise<EtaSignatureResult>;
}

export class EtaSigningUnavailableError extends Error {
  readonly code = "ETA_SIGNING_UNAVAILABLE";
  constructor(reason?: string) {
    super(
      reason ??
        "لا توجد خدمة ختم إلكتروني موصولة، فبقيت الوثيقة في انتظار الختم ولم تُرسل. " +
          "No e-seal signing agent is wired; the document is parked, not filed.",
    );
    this.name = "EtaSigningUnavailableError";
  }
}

/**
 * The default port. It is deliberately the honest half of the feature: it
 * refuses, and the refusal is what keeps «بانتظار التوقيع» meaning what it
 * says.
 */
export function unavailableEsealSigningPort(): EtaSigningPort {
  return {
    async sign(): Promise<EtaSignatureResult> {
      throw new EtaSigningUnavailableError();
    },
  };
}

/**
 * EXTERNAL CONTRACT: a signed ETA document carries its seals in a top-level
 * `signatures` array. The array is what the authority checks, so the
 * signature is attached to the payload rather than held beside it.
 */
export function attachEtaSignature(payload: unknown, signature: EtaSignatureResult): unknown {
  const document = (payload ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(document.signatures) ? (document.signatures as unknown[]) : [];
  return {
    ...document,
    signatures: [
      ...existing,
      { signatureType: signature.signatureType, value: signature.value },
    ],
  };
}

export function etaPayloadIsSigned(payload: unknown): boolean {
  const document = payload as { signatures?: unknown } | null;
  return Array.isArray(document?.signatures) && document.signatures.length > 0;
}

/**
 * ما يجب أن يظهر على الورق — the compliance notice a printed copy must carry.
 *
 * Null when there is nothing to say. Anything else is a state the paper must
 * not hide: a document built against the test environment was never filed,
 * and one parked awaiting a seal has not been either. Both look identical to
 * a filed document once printed, which is how it gets discovered at an audit.
 */
export function etaComplianceNotice(state: {
  readonly environment: EtaConfig["environment"];
  readonly status?: EtaSubmission["status"];
}): string | null {
  const parts: string[] = [];
  if (state.environment === "preproduction") {
    parts.push("وضع الاختبار — لم تُقدَّم هذه الوثيقة إلى مصلحة الضرائب");
  }
  if (state.status === "pending_signature") {
    parts.push("في انتظار الختم الإلكتروني — لم تُرسل بعد");
  }
  return parts.length === 0 ? null : parts.join(" · ");
}
