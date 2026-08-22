import type { FiscalPeriod } from "@mezan/domain";
import { demoAccounts as demoAccountDTOs } from "../accounts-sample-data";

/**
 * Shared demo fixtures for every document-framework screen wired against
 * `returns-landed-installments-store.ts` (sales/purchase returns, landed
 * costs, installment plans) — one open period + the Chart of Accounts, so
 * every screen posts against the same demo ledger.
 */

// AccountDTO (contracts) and Account (domain) are structurally identical —
// this is the same "no live API wiring yet" pattern every Phase-0/1 screen
// uses (see `local-store.ts`'s doc-comment).
export const demoAccounts = demoAccountDTOs;

export const demoOpenPeriod: FiscalPeriod = {
  id: "fp-2026-08",
  year: 2026,
  periodNumber: 8,
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  status: "open",
};
