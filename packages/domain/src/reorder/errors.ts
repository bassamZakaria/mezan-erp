import type { BilingualReason } from "../collections/errors.js";

export class InvalidReorderPolicyError extends Error {
  readonly code = "INVALID_REORDER_POLICY";
  readonly messageEn: string;
  constructor(readonly reasons: readonly BilingualReason[]) {
    super(reasons.map((reason) => reason.ar).join("، "));
    this.messageEn = reasons.map((reason) => reason.en).join("; ");
    this.name = "InvalidReorderPolicyError";
  }
}
