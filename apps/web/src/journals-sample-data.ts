import { Money, type FiscalPeriod, type FrameworkDocument, type JournalDocLine } from "@mezan/domain";

/**
 * Journal Entries demo data (docs/catalog/04 §القيود المحاسبية) for the Cyag
 * tenant. The current fiscal period (أغسطس 2026) is open for posting; a few
 * posted entries seed the list so its KPIs/rows/reverse action have data. New
 * entries continue from JE-000004 (see `startJeNumber`).
 */

export const demoOpenPeriod: FiscalPeriod = {
  id: "fp-2026-08",
  year: 2026,
  periodNumber: 8,
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  status: "open",
};

export const demoJeStartNumber = 3;

function posted(
  n: number,
  date: string,
  memo: string,
  lines: JournalDocLine[],
): FrameworkDocument<JournalDocLine> {
  const id = `je-seed-${n}`;
  const docNo = `JE-${String(n).padStart(6, "0")}`;
  return {
    id,
    docType: "JOURNAL_ENTRY",
    docNo,
    date,
    memo,
    status: "posted",
    lines,
    createdAt: `${date}T09:0${n}:00.000Z`,
    confirmedAt: `${date}T09:0${n}:00.000Z`,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: id,
  };
}

const line = (accountId: string, debit: string, credit: string): JournalDocLine => ({
  accountId,
  debit: Money.fromMajor(debit),
  credit: Money.fromMajor(credit),
});

export const demoJournalDocuments: FrameworkDocument<JournalDocLine>[] = [
  posted(1, "2026-08-05", "إثبات رأس المال الافتتاحي", [
    line("1300-1", "50000", "0"),
    line("3100", "0", "50000"),
  ]),
  posted(2, "2026-08-12", "تسجيل إيراد مبيعات نقدي شامل الضريبة", [
    line("1300-1", "1140", "0"),
    line("4100", "0", "1000"),
    line("2200", "0", "140"),
  ]),
  posted(3, "2026-08-18", "إثبات مصروف تكلفة البضاعة المباعة", [
    line("5100", "620", "0"),
    line("1200", "0", "620"),
  ]),
];
