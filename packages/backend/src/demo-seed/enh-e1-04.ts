import type { SeedFragment } from "./fragments.js";
import { call, step } from "./shared.js";

const FIRST_PERIOD = { year: 2024, month: 1 };
const LAST_PERIOD = { year: 2026, month: 4 };
const NO_DEPRECIABLE_ASSETS = 422;

function* monthsThrough(first: { year: number; month: number }, last: { year: number; month: number }): Generator<string> {
  for (let year = first.year, month = first.month; year < last.year || (year === last.year && month <= last.month); month += 1) {
    if (month > 12) {
      month = 1;
      year += 1;
    }
    yield `${year}-${String(month).padStart(2, "0")}`;
  }
}

async function postDepreciationRun(app: Parameters<NonNullable<SeedFragment["run"]>>[0], period: string): Promise<void> {
  const res = await call(app, "POST", "/assets/depreciation/runs", { period });
  if (res.status === NO_DEPRECIABLE_ASSETS) return;
  if (!res.ok) throw new Error(`[demo-seed] depreciation run ${period} failed with ${res.status}: ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  await step(app, "POST", `/assets/depreciation/runs/${id}/post`, {});
}

export const seed: SeedFragment = {
  async run(app) {
    for (const period of monthsThrough(FIRST_PERIOD, LAST_PERIOD)) await postDepreciationRun(app, period);

    await step(app, "POST", "/gl/journal-entries/draft", {
      id: "JE-DEMO-YEAR-END-ADJUSTMENT",
      date: "2025-12-31",
      memo: "تسوية مخصص نهاية السنة — لم تُعتمد قبل إقفال ديسمبر",
      lines: [
        { accountId: "5910", debit: "4200.00", credit: "0.00" },
        { accountId: "2170", debit: "0.00", credit: "4200.00" },
      ],
    });
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
