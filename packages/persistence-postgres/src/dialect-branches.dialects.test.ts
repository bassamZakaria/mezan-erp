import { describe, expect } from "vitest";
import {
  BankStatementSource,
  CountZoneKind,
  CountZoneStatus,
  Money,
  NotificationChannelCode,
  NotificationChannelState,
  NotificationPriorityCode,
  NotificationReadStatusCode,
  PeriodCloseDocKind,
  type Notification,
  type StatementLine,
} from "@mezan/domain";
import {
  createBankReconciliationStore,
  createDocumentStore,
  createNotificationStore,
  createTaxRateUsage,
  ensureTenantSchema,
  grantSuccessorPermissionsOnce,
  SqlDialect,
  type SqlDb,
} from "@mezan/persistence";
import { createCountModeStore } from "../../persistence/src/count-mode-store.js";
import { createPeriodCloseStore } from "../../persistence/src/period-close-store.js";
import { createRecurringJournalRunRepository } from "../../persistence/src/recurring-journals-store.js";
import { DIALECTS, runOn, useDialectDbs } from "./test-support.js";

const open = useDialectDbs();
const books = new Map<SqlDialect, Promise<SqlDb>>();

function booksOn(dialect: SqlDialect): Promise<SqlDb> {
  let db = books.get(dialect);
  if (!db) {
    db = open(dialect).then(async ({ db: opened }) => {
      await ensureTenantSchema(opened);
      return opened;
    });
    books.set(dialect, db);
  }
  return db;
}

describe.each(DIALECTS)("dialect-specific SQL on $dialect", ({ dialect }) => {
  const run = runOn(dialect);

  run("finds a period's numbering neighbours, reading a number's leading digits the way SQLite's CAST does", async () => {
    const db = await booksOn(dialect);
    const rows: Array<[string, string]> = [
      ["JE-ABC", "2031-02-01"],
      ["JE-000001", "2031-02-10"],
      ["JE-000002", "2031-03-05"],
      ["JE-000004", "2031-03-20"],
      ["JE-000003", "2031-04-02"],
      ["JE-3abc", "2031-04-03"],
      ["JE- 4", "2031-04-04"],
      ["JE-000009", "2031-04-05"],
    ];
    for (const [entryNo, date] of rows) {
      await db.run(`INSERT INTO journal_entry (id, entry_no, date, memo, status, source, created_at) VALUES (?, ?, ?, 'm', 'posted', 'manual', ?)`, [
        `je:${entryNo}`,
        entryNo,
        date,
        `${date}T00:00:00.000Z`,
      ]);
    }

    const window = { periodId: "fp-2031-03", year: 2031, periodNumber: 3, startDate: "2031-03-01", endDate: "2031-03-31" };
    const result = await createPeriodCloseStore(db).queries.numberedDocuments(window);
    const journal = result.find((entry) => entry.kind === PeriodCloseDocKind.JournalEntry)!;

    expect(journal.documents.map((d) => `${d.number}@${d.date}`).sort()).toEqual([
      "JE- 4@2031-04-04",
      "JE-000001@2031-02-10",
      "JE-000002@2031-03-05",
      "JE-000003@2031-04-02",
      "JE-000004@2031-03-20",
      "JE-3abc@2031-04-03",
    ]);
    expect(result.filter((entry) => entry.kind !== PeriodCloseDocKind.JournalEntry).every((entry) => entry.documents.length === 0)).toBe(true);
  });

  run("claims a notification channel once, settles it only under its own claim, and requeues a stale claim", async () => {
    const store = createNotificationStore(await booksOn(dialect));
    const notification: Notification = {
      id: "n-1",
      ruleId: null,
      recipientUserId: "u1",
      eventCode: "INVOICE_CONFIRMED",
      title: "t",
      body: "b",
      priority: NotificationPriorityCode.Normal,
      channels: [NotificationChannelCode.Email, NotificationChannelCode.Push],
      channelStatus: { [NotificationChannelCode.Email]: NotificationChannelState.Queued, [NotificationChannelCode.Push]: NotificationChannelState.Queued },
      status: NotificationReadStatusCode.Unread,
      payload: {},
      createdAt: "2026-08-01T00:00:00.000Z",
      readAt: null,
    };
    await store.save(notification);

    const claims = await Promise.all(Array.from({ length: 5 }, () => store.claimChannel("n-1", NotificationChannelCode.Email, "2026-08-01T00:01:00.000Z")));
    const tokens = claims.filter((claim): claim is string => claim !== null);
    expect(tokens).toHaveLength(1);
    expect(await store.settleChannel("n-1", NotificationChannelCode.Email, NotificationChannelState.Sent, "someone-else")).toBe(false);
    expect(await store.settleChannel("n-1", NotificationChannelCode.Email, NotificationChannelState.Sent, tokens[0]!)).toBe(true);
    expect(await store.settleChannel("n-1", NotificationChannelCode.Email, NotificationChannelState.Sent, tokens[0]!)).toBe(false);
    expect(await store.claimChannel("n-1", NotificationChannelCode.Email, "2026-08-01T00:02:00.000Z")).toBeNull();

    const stale = await store.claimChannel("n-1", NotificationChannelCode.Push, "2026-08-01T00:01:00.000Z");
    expect(stale).not.toBeNull();
    expect(await store.requeueStaleSending("2026-08-01T00:00:30.000Z")).toBe(0);
    expect(await store.requeueStaleSending("2026-08-01T00:05:00.000Z")).toBe(1);
    expect(await store.settleChannel("n-1", NotificationChannelCode.Push, NotificationChannelState.Sent, stale!)).toBe(false);
    const again = await store.claimChannel("n-1", NotificationChannelCode.Push, "2026-08-01T00:06:00.000Z");
    expect(again).not.toBeNull();
    expect(await store.settleChannel("n-1", NotificationChannelCode.Push, NotificationChannelState.Failed, again!)).toBe(true);

    expect((await store.findById("n-1"))?.channelStatus).toEqual({ [NotificationChannelCode.Email]: NotificationChannelState.Sent, [NotificationChannelCode.Push]: NotificationChannelState.Failed });
    expect(await store.listQueued(10)).toEqual([]);
  });

  run("lists documents by a line reference once each, honouring the header filters", async () => {
    type Line = { sourceInvoiceId?: string; qty: string };
    const store = createDocumentStore<Line>(await booksOn(dialect), "PARITY_RETURN", (line) => line, (wire) => wire as Line);
    const doc = (id: string, date: string, status: "draft" | "confirmed", lines: Line[]) => ({
      id,
      docType: "PARITY_RETURN",
      docNo: null,
      date,
      memo: id,
      status,
      lines,
      createdAt: `${date}T00:00:00.000Z`,
      confirmedAt: null,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });
    await store.save(doc("r-1", "2026-08-01", "confirmed", [{ sourceInvoiceId: "inv-a", qty: "1" }, { sourceInvoiceId: "inv-b", qty: "2" }, { sourceInvoiceId: "inv-a", qty: "3" }]));
    await store.save(doc("r-2", "2026-08-02", "draft", [{ sourceInvoiceId: "inv-c", qty: "1" }]));
    await store.save(doc("r-3", "2026-08-03", "confirmed", [{ qty: "1" }]));

    const ids = async (refs: string[], filter = {}) => (await store.listByLineRef!("sourceInvoiceId", refs, filter)).map((d) => d.id);
    expect(await ids(["inv-a", "inv-b"])).toEqual(["r-1"]);
    expect(await ids(["inv-a", "inv-c"])).toEqual(["r-1", "r-2"]);
    expect(await ids(["inv-a", "inv-c"], { status: "draft" })).toEqual(["r-2"]);
    expect(await ids(["inv-a", "inv-c"], { fromDate: "2026-08-02" })).toEqual(["r-2"]);
    expect(await ids(["inv"])).toEqual([]);
    expect(await ids([])).toEqual([]);
  });

  run("finds a counter's zones by an exact member of the counters array", async () => {
    const store = createCountModeStore(await booksOn(dialect));
    const zone = (id: string, counterUserIds: string[]) => ({
      id,
      countId: "cnt-parity",
      name: id,
      kind: CountZoneKind.AdHoc,
      categoryId: null,
      itemIds: ["u2"],
      counterUserIds,
      status: CountZoneStatus.Open,
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
    });
    await store.saveZones([zone("z-1", ["u1", "u2"]), zone("z-2", ["u3"]), zone("z-3", ["u22"]), zone("z-4", [])]);

    expect((await store.zonesOfCounter("u2")).map((z) => z.id)).toEqual(["z-1"]);
    expect((await store.zonesOfCounter("u3")).map((z) => z.id)).toEqual(["z-2"]);
    expect(await store.zonesOfCounter("u")).toEqual([]);
  });

  run("lists recurring-journal runs for exactly the templates named", async () => {
    const runs = createRecurringJournalRunRepository(await booksOn(dialect));
    for (const [id, templateId, generatedAt] of [
      ["run-1", "tpl-1", "2026-08-01T00:00:00.000Z"],
      ["run-2", "tpl-2", "2026-08-02T00:00:00.000Z"],
      ["run-3", "tpl-3", "2026-08-03T00:00:00.000Z"],
      ["run-4", "tpl-10", "2026-08-04T00:00:00.000Z"],
      ["run-5", "tpl", "2026-08-05T00:00:00.000Z"],
    ] as const) {
      await runs.save({ id, templateId, period: "2026-08", generation: 1, journalEntryId: `je-${id}`, journalEntryNo: null, reversalJournalEntryId: null, reversalJournalEntryNo: null, generatedAt, generatedBy: "u1" });
    }

    expect((await runs.list(200, ["tpl-1", "tpl-3"])).map((r) => r.id)).toEqual(["run-3", "run-1"]);
    expect((await runs.list(1, ["tpl-1", "tpl-3"])).map((r) => r.id)).toEqual(["run-3"]);
    expect(await runs.list(200, [])).toEqual([]);
  });

  run("grants a split permission once to every role that held the older one", async () => {
    const db = await booksOn(dialect);
    for (const [id, permissions] of [
      ["role-parity-a", ["parity.old"]],
      ["role-parity-b", ["parity.other"]],
      ["role-parity-c", ["parity.old", "parity.new"]],
    ] as const) {
      await db.run(`INSERT INTO role (id, code, name, description, permissions, is_system, created_at) VALUES (?, ?, ?, '', ?, 0, '2026-08-01')`, [
        id,
        id,
        id,
        JSON.stringify(permissions),
      ]);
    }
    const successors = new Map([["parity.old", ["parity.new"]]]);

    expect(await grantSuccessorPermissionsOnce(db, "parity-marker", successors)).toBe(1);
    const permissionsOf = async (id: string) => JSON.parse((await db.get<{ permissions: string }>(`SELECT permissions FROM role WHERE id = ?`, [id]))!.permissions) as string[];
    expect(await permissionsOf("role-parity-a")).toEqual(["parity.old", "parity.new"]);
    expect(await permissionsOf("role-parity-b")).toEqual(["parity.other"]);
    expect(await permissionsOf("role-parity-c")).toEqual(["parity.old", "parity.new"]);

    await db.run(`UPDATE role SET permissions = ? WHERE id = 'role-parity-a'`, [JSON.stringify(["parity.old"])]);
    expect(await grantSuccessorPermissionsOnce(db, "parity-marker", successors)).toBe(0);
    expect(await permissionsOf("role-parity-a")).toEqual(["parity.old"]);
  });

  run("finds a tax rate named by a journal line or a JSON document line, and counts only exempt customers", async () => {
    const db = await booksOn(dialect);
    const usage = createTaxRateUsage(db);
    expect(await usage.isReferenced("vat-parity")).toBe(false);

    await db.run(
      `INSERT INTO framework_document (id, doc_type, date, memo, status, lines_json, created_at) VALUES ('fd-tax', 'PARITY_TAX', '2026-08-01', 'm', 'draft', ?, '2026-08-01')`,
      [JSON.stringify([{ qty: "1", taxRateId: "vat-parity-json" }])],
    );
    expect(await usage.isReferenced("vat-parity-json")).toBe(true);
    expect(await usage.isReferenced("vat-parity")).toBe(false);

    await db.run(`INSERT INTO journal_entry (id, date, memo, status, source, created_at) VALUES ('je-tax', '2026-08-01', 'm', 'posted', 'manual', '2026-08-01')`);
    await db.run(`INSERT INTO journal_line (entry_id, line_no, account_id, debit, credit, tax_rate_id) VALUES ('je-tax', 1, '1300', 1, 0, 'vat-parity-line')`);
    expect(await usage.isReferenced("vat-parity-line")).toBe(true);

    for (const [id, exempt] of [["c-parity-exempt", 1], ["c-parity-taxed", 0]] as const) {
      await db.run(
        `INSERT INTO customer (id, code, name_ar, payment_terms_days, currency, opening_balance, active, credit_limit, tax_exempt, eta_buyer_type, tax_exemption_rate_id)
         VALUES (?, ?, 'عميل', 0, 'EGP', 0, 1, 0, ?, 'P', 'vat-parity')`,
        [id, id, exempt],
      );
    }
    expect(await usage.exemptCustomerCount!("vat-parity")).toBe(1);
    expect(await usage.exemptCustomerCount!("vat-parity-line")).toBe(0);
  });

  run("returns a bank line's matched entries in the order they were matched", async () => {
    const { statements } = createBankReconciliationStore(await booksOn(dialect));
    await statements.save({
      id: "stmt-parity",
      treasuryAccountId: "ta-parity",
      branchId: null,
      currency: "EGP",
      importFingerprint: null,
      source: BankStatementSource.Csv,
      statementNumber: null,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      openingBalance: Money.zero(),
      closingBalance: Money.zero(),
      status: "imported",
      importedAt: "2026-08-22T00:00:00.000Z",
      finalizedAt: null,
    });
    const line: StatementLine = {
      id: "stmt-parity:L0",
      statementId: "stmt-parity",
      date: "2026-08-01",
      description: "Deposit",
      reference: null,
      amount: Money.fromMajor("100"),
      status: "unmatched",
      matchedEntryId: null,
      matchedAt: null,
    };
    await statements.saveLine(line);

    await statements.replaceLineMatches(line, "ta-parity", ["je-z", "je-a", "je-m"]);
    expect((await statements.findLineById(line.id))?.matchedEntryIds).toEqual(["je-z", "je-a", "je-m"]);
    await statements.replaceLineMatches(line, "ta-parity", ["je-m", "je-b"]);
    expect((await statements.findLineById(line.id))?.matchedEntryIds).toEqual(["je-m", "je-b"]);
    expect((await statements.listLines("stmt-parity"))[0]?.matchedEntryIds).toEqual(["je-m", "je-b"]);
  });
});
