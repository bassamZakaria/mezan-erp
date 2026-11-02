/**
 * Shared row-error shape for every data-migration import kind (customers,
 * suppliers, items, opening balances) — mirrors
 * `packages/domain/src/purchasing/historical-import.ts`'s
 * `HistoricalImportRowError`, which already covers the historical
 * purchase-document import kind.
 */
import type { BilingualReason } from "../collections/errors.js";

export interface ImportRowError {
  readonly rowNumber: number;
  readonly reasons: readonly string[];
  readonly reasonsEn?: readonly string[];
}

export function importRowError(rowNumber: number, reasons: readonly BilingualReason[]): ImportRowError {
  return { rowNumber, reasons: reasons.map((r) => r.ar), reasonsEn: reasons.map((r) => r.en) };
}
