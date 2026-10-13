import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PeriodCloseCheckStatusDTO, type PeriodCloseChecklistDTO } from "@mezan/contracts";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

const TIED = { inventory: "0.000000", ar: "0.000000", ap: "0.000000" };
const AR = "1105";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
  world?.close();
});

async function tiesAt(month: string): Promise<Record<string, string>> {
  const res = await world.request("GET", `/period-close/fp-2026-${month}/checks`);
  expect(res.status).toBe(200);
  const ties = (res.body as unknown as PeriodCloseChecklistDTO).checks.find((c) => c.code === "subledger_ties");
  if (!ties) throw new Error("subledger_ties is missing from the checklist");
  expect(ties.status).not.toBe(PeriodCloseCheckStatusDTO.Unavailable);
  return { month, ...Object.fromEntries(ties.findings.filter((f) => f.ref in TIED).map((f) => [f.ref, f.amount ?? "0.000000"])) };
}

async function expectTied(months: readonly string[]): Promise<void> {
  for (const month of months) expect(await tiesAt(month)).toEqual({ month, ...TIED });
  expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
}

async function receiveCheque(id: string, issueDate: string, amount: string): Promise<void> {
  const created = await world.request("POST", "/cheques", {
    id, direction: "incoming", chequeNumber: `N-${id}`, bankName: "بنك مصر", issueDate, dueDate: issueDate, branchId: "BR-MAIN", partyId: "CUST-DEMO-1",
    counterpartyGlAccountId: AR, controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" }, amount,
  });
  expect(`${created.status} ${created.status === 201 ? "" : JSON.stringify(created.body)}`.trim()).toBe("201");
  expect((await world.request("POST", `/cheques/${id}/deposit`, { bankTreasuryAccountId: "TR-DEMO-BANK" })).status).toBe(200);
}

function entryDate(entryId: string): string {
  return (world.sqlite.prepare(`SELECT date FROM journal_entry WHERE id = ?`).get(entryId) as { date: string }).date;
}

describe("a cheque is read as of the day its journal entries are dated, never the instant it was recorded", () => {
  it("a bounce dated 5 September and recorded in October restores the receivable from September on", async () => {
    await receiveCheque("LD-CH-1", "2026-08-12", "700.00");
    const arSeptember = world.balance(AR, "2026-09-30");

    const bounced = await world.request("POST", "/cheques/LD-CH-1/bounce", { date: "2026-09-05" });

    expect(`${bounced.status} ${bounced.body.status}`).toBe("200 bounced");
    expect(String(bounced.body.bouncedAt).slice(0, 7)).not.toBe("2026-09");
    expect(world.balance(AR, "2026-09-30") - arSeptember).toBe(700_000_000n);
    await expectTied(["08", "09", "10"]);
  });

  it("half an hour after midnight in Cairo, a collection, a bounce and a replacement sent with no date are dated the new day — in the ledger and in the month-end reading", async () => {
    await receiveCheque("LD-CH-2", "2026-10-20", "450.00");
    await receiveCheque("LD-CH-3", "2026-10-21", "320.00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T22:30:00.000Z"));
    try {
      const bounced = await world.request("POST", "/cheques/LD-CH-2/bounce", {});
      expect(`${bounced.status} ${bounced.body.status}`).toBe("200 bounced");
      expect(String(bounced.body.bouncedAt).slice(0, 10)).toBe("2026-10-31");
      expect(entryDate(String(bounced.body.bounceJournalEntryId))).toBe("2026-11-01");

      const collected = await world.request("POST", "/cheques/LD-CH-3/collect", { bankGlAccountId: "1310" });
      expect(`${collected.status} ${collected.body.status}`).toBe("200 collected");
      expect(entryDate(String(collected.body.collectionJournalEntryId))).toBe("2026-11-01");

      const replaced = await world.request("POST", "/cheques/LD-CH-2/replace", {
        newCheque: { id: "LD-CH-2R", chequeNumber: "N-LD-CH-2R", bankName: "بنك مصر", issueDate: "2026-10-25", dueDate: "2026-11-25", branchId: "BR-MAIN" },
      });
      expect(replaced.status).toBe(201);
      expect(entryDate(String((replaced.body.replacement as { creationJournalEntryId: string }).creationJournalEntryId))).toBe("2026-11-01");
    } finally {
      vi.useRealTimers();
    }
    await expectTied(["10", "11"]);
  });

  it("a replacement cheque credits the customer on the day its entry is dated, not on the date written on the cheque", async () => {
    const replaced = await world.request("POST", "/cheques/LD-CH-1/replace", {
      date: "2026-10-06",
      newCheque: { id: "LD-CH-1R", chequeNumber: "N-LD-CH-1R", bankName: "بنك مصر", issueDate: "2026-09-20", dueDate: "2026-10-20", branchId: "BR-MAIN" },
    });
    expect(`${replaced.status} ${replaced.status === 201 || replaced.status === 200 ? "" : JSON.stringify(replaced.body)}`.trim()).toMatch(/^20[01]$/);
    await expectTied(["09", "10"]);
  });
});

describe("reversing a reversal", () => {
  async function collection(id: string, date: string, amount: string): Promise<void> {
    const created = await world.request("POST", "/vouchers", {
      id, date, branchId: "BR-MAIN", memo: "تحصيل", voucherType: "customer_collection", amount, paymentMethod: "cash",
      treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: AR, customerId: "CUST-DEMO-1",
    });
    expect(created.status).toBe(201);
    expect((await world.request("POST", `/vouchers/${id}/confirm`, {})).status).toBe(200);
  }

  it("is refused in Arabic with the way forward, and nothing is posted", async () => {
    await collection("LD-V-1", "2026-08-10", "100.00");
    const first = await world.request("POST", "/vouchers/LD-V-1/reverse", { memo: "سبب العكس", date: "2026-08-31" });
    expect(first.status).toBe(201);
    const reversalId = (first.body.reversal as { id: string }).id;
    const entries = world.count("journal_entry");

    const refused = await world.request("POST", `/vouchers/${encodeURIComponent(reversalId)}/reverse`, { memo: "سبب العكس", date: "2026-09-10" });

    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      error: "REVERSAL_NOT_REVERSIBLE",
      message: `المستند ${reversalId} قيد عكسي ولا يُعكس. أعد إدخال المستند الأصلي من جديد بدلاً من عكس عكسه.`,
      messageEn: `Document ${reversalId} is itself a reversal and cannot be reversed. Re-enter the original document instead.`,
    });
    expect(world.count("journal_entry")).toBe(entries);
    expect((world.sqlite.prepare(`SELECT status FROM voucher WHERE id = ?`).get(reversalId) as { status: string }).status).toBe("confirmed");
    await expectTied(["08", "09", "10"]);
  });

  const statement = async () => {
    const body = (await world.request("GET", "/reports/statements/customers/CUST-DEMO-1")).body as { closing: string; agingTotal: string; lines: { key: string }[] };
    return { closing: BigInt(body.closing.replace(".", "")), agingTotal: BigInt(body.agingTotal.replace(".", "")), keys: body.lines.map((l) => l.key) };
  };
  const aged = async (asOfDate: string) => {
    const rows = (await world.request("GET", `/reports/aging/customers?asOfDate=${asOfDate}`)).body.rows as { customerId: string; total: string }[];
    return BigInt((rows.find((row) => row.customerId === "CUST-DEMO-1")?.total ?? "0.000000").replace(".", ""));
  };

  function mirrorEntry(sourceEntryId: string, id: string, date: string): string {
    const entryNo = `JE-CHAIN-${id}`;
    world.sqlite
      .prepare(
        `INSERT INTO journal_entry (id, entry_no, date, memo, status, source, created_at, posted_at, reverses_entry_id, reversed_by_entry_id, source_doc_type, source_doc_id, source_doc_number)
         SELECT ?, ?, ?, memo, 'posted', 'system', created_at, posted_at, id, NULL, source_doc_type, source_doc_id, source_doc_number FROM journal_entry WHERE id = ?`,
      )
      .run(id, entryNo, date, sourceEntryId);
    world.sqlite
      .prepare(
        `INSERT INTO journal_line (entry_id, line_no, account_id, debit, credit, memo, cost_center_id, currency, fx_rate, tax_rate_percent, project_id, cost_category, branch_id, party_id)
         SELECT ?, line_no, account_id, credit, debit, memo, cost_center_id, currency, fx_rate, tax_rate_percent, project_id, cost_category, branch_id, party_id FROM journal_line WHERE entry_id = ?`,
      )
      .run(id, sourceEntryId);
    world.sqlite.prepare(`UPDATE journal_entry SET status = 'reversed', reversed_by_entry_id = ? WHERE id = ?`).run(id, sourceEntryId);
    return entryNo;
  }

  it("a chain already in the books — a reversal that was itself reversed — still ties at every month end, and the statement and the aging follow it", async () => {
    const before = { statement: await statement(), standing: await aged("2026-08-20"), reversed: await aged("2026-08-31"), restored: await aged("2026-09-10") };
    await collection("LD-V-2", "2026-08-11", "250.00");
    const first = await world.request("POST", "/vouchers/LD-V-2/reverse", { memo: "سبب العكس", date: "2026-08-31" });
    const reversal = first.body.reversal as { id: string };
    const reversalEntryId = (world.sqlite.prepare(`SELECT journal_entry_id AS id FROM voucher WHERE id = ?`).get(reversal.id) as { id: string }).id;
    const secondEntryNo = mirrorEntry(reversalEntryId, "LD-V-2-RR-JE", "2026-09-10");
    const columns = (world.sqlite.prepare(`PRAGMA table_info(voucher)`).all() as { name: string }[]).map((c) => c.name);
    const copied = columns.filter((c) => !["id", "doc_no", "date", "reverses_doc_id", "reversed_by_doc_id", "journal_entry_id"].includes(c));
    world.sqlite
      .prepare(
        `INSERT INTO voucher (id, doc_no, date, reverses_doc_id, reversed_by_doc_id, journal_entry_id, ${copied.join(", ")})
         SELECT 'LD-V-2-RR', ?, '2026-09-10', id, NULL, 'LD-V-2-RR-JE', ${copied.join(", ")} FROM voucher WHERE id = ?`,
      )
      .run(secondEntryNo, reversal.id);
    world.sqlite.prepare(`UPDATE voucher SET status = 'reversed', reversed_by_doc_id = 'LD-V-2-RR' WHERE id = ?`).run(reversal.id);

    const credit = 250_000_000n;
    expect((await aged("2026-08-20")) - before.standing).toBe(-credit);
    expect((await aged("2026-08-31")) - before.reversed).toBe(0n);
    expect((await aged("2026-09-10")) - before.restored).toBe(-credit);
    const now = await statement();
    expect(now.keys).toContain("vch-LD-V-2");
    expect(now.closing - before.statement.closing).toBe(-credit);
    expect(now.agingTotal - before.statement.agingTotal).toBe(-credit);
    await expectTied(["08", "09", "10"]);
  });
});

describe("reversing a journal entry directly", () => {
  it("is refused for an entry a document owns, naming the document to reverse instead; the voucher and the receivable stay as they were", async () => {
    const created = await world.request("POST", "/vouchers", {
      id: "LD-V-3", date: "2026-08-12", branchId: "BR-MAIN", memo: "تحصيل", voucherType: "customer_collection", amount: "75.00", paymentMethod: "cash",
      treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: AR, customerId: "CUST-DEMO-1",
    });
    expect(created.status).toBe(201);
    expect((await world.request("POST", "/vouchers/LD-V-3/confirm", {})).status).toBe(200);
    const voucher = world.sqlite.prepare(`SELECT journal_entry_id AS entryId, doc_no AS docNo FROM voucher WHERE id = 'LD-V-3'`).get() as { entryId: string; docNo: string };
    const entries = world.count("journal_entry");

    const refused = await world.request("POST", `/gl/journal-entries/${encodeURIComponent(voucher.entryId)}/reverse`, {});

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      error: "JOURNAL_ENTRY_OWNED_BY_DOCUMENT",
      message: `القيد يخص المستند ${voucher.docNo} ولا يُعكس من دفتر اليومية. اعكس المستند نفسه أو ألغِه من شاشته ليبقى المستند ودفتره الفرعي متطابقين مع القيد.`,
    });
    expect(String(refused.body.messageEn)).toContain(voucher.docNo);
    expect(world.count("journal_entry")).toBe(entries);
    expect((world.sqlite.prepare(`SELECT status FROM voucher WHERE id = 'LD-V-3'`).get() as { status: string }).status).toBe("confirmed");
    await expectTied(["08", "09", "10"]);
  });

  it("reverses a manual journal once; its reversal is not reversed in turn", async () => {
    const posted = await world.request("POST", "/gl/journal-entries", {
      id: "LD-MJ-1", date: "2026-08-15", memo: "قيد يدوي",
      lines: [{ accountId: "2170", debit: "40.00", credit: "0" }, { accountId: "2190", debit: "0", credit: "40.00" }],
    });
    expect(posted.status).toBe(201);
    const reversed = await world.request("POST", "/gl/journal-entries/LD-MJ-1/reverse", { reversalId: "LD-MJ-1-REV", date: "2026-08-20" });
    expect(reversed.status).toBe(201);

    const refused = await world.request("POST", "/gl/journal-entries/LD-MJ-1-REV/reverse", { date: "2026-08-25" });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      error: "JOURNAL_REVERSAL_NOT_REVERSIBLE",
      message: expect.stringContaining("قيد عكسي ولا يُعكس"),
      messageEn: expect.stringContaining("is itself a reversal"),
    });
  });
});
