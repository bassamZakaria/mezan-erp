import type { SeedFragment } from "./fragments.js";
import { step } from "./shared.js";

/**
 * One unposted accrual dated inside September, so the close workspace always
 * has a failing "unposted documents" row beside its passing ones (trial
 * balance, sub-ledger ties) — and the «فتح قيود اليومية» jump has a real draft
 * to land on. 5910/2170 are ordinary accounts: a control account here would
 * move the reconciliation the same screen reports.
 */
export const seed: SeedFragment = {
  async run(app) {
    await step(app, "POST", "/gl/journal-entries/draft", {
      id: "JE-DEMO-CLOSE-ACCRUAL",
      date: "2026-09-30",
      memo: "استحقاق رواتب سبتمبر — بانتظار مراجعة المحاسب قبل الترحيل",
      lines: [
        { accountId: "5910", debit: "1850.00", credit: "0.00" },
        { accountId: "2170", debit: "0.00", credit: "1850.00" },
      ],
    });
  },
};
