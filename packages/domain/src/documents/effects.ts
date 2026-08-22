/**
 * "تأثيرات هذا المستند" — the document-effects descriptor.
 *
 * Before a user confirms a document the UI shows a plain-language panel of what
 * confirming WILL do: which GL entry it posts, which stock it moves, which
 * balances it shifts (docs/catalog/04 §"تأثيرات هذا السند"; the @mezan/ui
 * `DocumentDetail` renders exactly this list). Computing it is a pure function
 * of the document, so the same descriptor drives the effects panel, the confirm
 * gate, and tests. It never performs I/O.
 */

import type { Money } from "../money/index.js";

/** The category of a single effect, so the UI can pick an icon/tone per line. */
export type DocumentEffectKind = "gl" | "stock" | "balance" | "workflow" | "info";

/** One plain-language effect line shown in the panel. */
export interface DocumentEffect {
  readonly kind: DocumentEffectKind;
  /** Arabic, user-facing (e.g. "قيد محاسبي متوازن من 3 بنود"). */
  readonly description: string;
  /** Optional secondary detail (e.g. an account name + Dr/Cr amount). */
  readonly detail?: string;
}

/**
 * The full descriptor for a document. `blocked` is true when the document
 * cannot be confirmed as-is (e.g. an unbalanced journal) — the UI disables the
 * confirm/post button and shows `blockedReason`.
 */
export interface DocumentEffects {
  readonly effects: readonly DocumentEffect[];
  /** For GL-bearing documents: does Σ debit equal Σ credit? Undefined for non-GL docs. */
  readonly balanced?: boolean;
  readonly totalDebit?: Money;
  readonly totalCredit?: Money;
  /** True when confirming is not currently allowed (e.g. unbalanced). */
  readonly blocked: boolean;
  readonly blockedReason?: string;
}

/** Small builder so document types compose effect lists without boilerplate. */
export function buildEffects(input: {
  effects: readonly DocumentEffect[];
  balanced?: boolean;
  totalDebit?: Money;
  totalCredit?: Money;
  blocked?: boolean;
  blockedReason?: string;
}): DocumentEffects {
  return {
    effects: input.effects,
    balanced: input.balanced,
    totalDebit: input.totalDebit,
    totalCredit: input.totalCredit,
    blocked: input.blocked ?? false,
    blockedReason: input.blockedReason,
  };
}
