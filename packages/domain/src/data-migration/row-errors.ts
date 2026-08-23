/**
 * Shared row-error shape for every data-migration import kind (customers,
 * suppliers, items, opening balances) — mirrors
 * `packages/domain/src/purchasing/historical-import.ts`'s
 * `HistoricalImportRowError`, which already covers the historical
 * purchase-document import kind.
 */
export interface ImportRowError {
  readonly rowNumber: number;
  readonly reasons: readonly string[];
}
