/**
 * Import rehearsal — run a data-migration import against a FRESH, empty
 * company on this machine and prove every record landed, before the same
 * files go anywhere near staging or production.
 *
 *   pnpm import:rehearsal --chart <accounts.xlsx> --journal <entries.xlsx> [--opening <tb.xlsx>] [--keep <dir>]
 *
 * Every run starts from a brand-new SQLite database seeded exactly like a new
 * tenant (default chart of accounts, current fiscal year, nothing else), so a
 * rerun is a reset. The files go through the same parser the screen uses and
 * the same preview → commit routes, then the run checks, record by record:
 *
 *   - every journal row in the file is a posted line in the ledger (date,
 *     account, debit, credit, description) — nothing missing, nothing extra;
 *   - the journal register lists every entry;
 *   - every account's ledger and trial-balance balance equals the file's sum;
 *   - the trial balance, balance sheet and income statement agree with each
 *     other and with the file.
 *
 * It exits non-zero on the first failed check, and writes a report next to
 * the database when `--keep` is given (the database stays there to inspect).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALL_SCOPE } from "@mezan/domain";
import type { App } from "@mezan/api";
import { createBackend } from "../packages/backend/src/create-backend.js";
import { parseDataMigrationFile } from "../packages/ui/src/lib/data-migration-file.js";
import { STEPS } from "../apps/web/src/settings/data-migration-steps.js";

type Row = Record<string, string>;
interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const chartFile = arg("chart");
const journalFile = arg("journal");
const openingFile = arg("opening");
const keepDir = arg("keep");
if (!journalFile && !openingFile) {
  console.error("usage: pnpm import:rehearsal --chart <accounts.xlsx> --journal <entries.xlsx> [--opening <tb.xlsx>] [--keep <dir>]");
  process.exit(2);
}

const cents = (s: string | number | null | undefined): number => Math.round(Number(String(s ?? "0").replace(/,/g, "") || 0) * 100);
const money = (c: number): string => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function rowsOf(file: string, stepId: string): Promise<Row[]> {
  const step = STEPS.find((s) => s.spec.id === stepId);
  if (!step) throw new Error(`no step ${stepId}`);
  const buf = readFileSync(file);
  const parsed = await parseDataMigrationFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), step.spec);
  if (parsed.errors.length > 0) throw new Error(`${file}: ${JSON.stringify(parsed.errors)}`);
  return parsed.rows.map((r) => ({ ...r }));
}

async function main(): Promise<void> {
  const dir = keepDir ?? mkdtempSync(path.join(tmpdir(), "mezan-rehearsal-"));
  mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "rehearsal.sqlite");
  rmSync(dbPath, { force: true }); // a rerun is a reset
  const handle = await createBackend({ dbPath });
  const token = await handle.sessions.issue({ userId: "rehearsal", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const app = handle.app as App;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  async function call(p: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await app.request(p, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep the text */
    }
    return { status: res.status, body: parsed };
  }

  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  };

  async function importStep(stepId: string, file: string): Promise<any> {
    const rows = await rowsOf(file, stepId);
    const preview = await call(`/data-migration/${stepId}/preview`, { rows });
    const errors = (preview.body?.errors ?? []) as { rowNumber: number; reasons: string[] }[];
    check(`${stepId}: preview has no errors`, preview.status === 200 && errors.length === 0, errors.length === 0 ? `${rows.length} rows` : errors.slice(0, 5).map((e) => `row ${e.rowNumber}: ${e.reasons.join("; ")}`).join(" | ") + (errors.length > 5 ? ` … +${errors.length - 5}` : ""));
    if (errors.length > 0) return null;
    const commit = await call(`/data-migration/${stepId}/commit`, { rows });
    check(`${stepId}: commit`, commit.status === 201, `HTTP ${commit.status}${commit.status === 201 ? "" : " " + JSON.stringify(commit.body?.errors ?? commit.body).slice(0, 300)}`);
    return commit.status === 201 ? { rows, result: commit.body } : null;
  }

  if (chartFile) await importStep("chart-of-accounts", chartFile);
  if (openingFile) await importStep("opening-trial-balance", openingFile);

  if (journalFile) {
    const done = await importStep("journal-entries", journalFile);
    if (done) {
      const rows: Row[] = done.rows;
      const accounts = ((await call("/accounts")).body as { id: string; code: string; type: string }[]) ?? [];
      const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
      const typeOf = new Map(accounts.map((a) => [a.code, a.type]));

      // 1. Every entry of the file is posted, with exactly its lines.
      const byRef = new Map<string, Row[]>();
      for (const r of rows) byRef.set(r.entryRef!.trim(), [...(byRef.get(r.entryRef!.trim()) ?? []), r]);
      const missing: string[] = [];
      const wrong: string[] = [];
      for (const [ref, lines] of byRef) {
        const entry = (await call(`/gl/journal-entries/${encodeURIComponent(`IMPORT-JE:${ref}`)}`)).body;
        if (!entry || entry.status !== "posted") {
          missing.push(ref);
          continue;
        }
        const want = lines.map((l) => `${l.date}|${l.accountCode}|${cents(l.debit)}|${cents(l.credit)}|${(l.description ?? "").trim()}`).sort();
        const got = (entry.lines as { accountId: string; debit: string; credit: string; memo: string | null }[]).map((l) => `${entry.date}|${codeOf.get(l.accountId)}|${cents(l.debit)}|${cents(l.credit)}|${(l.memo ?? "").trim()}`).sort();
        if (JSON.stringify(want) !== JSON.stringify(got)) wrong.push(ref);
      }
      check("every entry in the file is posted", missing.length === 0, missing.length === 0 ? `${byRef.size} of ${byRef.size} entries` : `${missing.length} missing, e.g. ${missing.slice(0, 5).join(", ")}`);
      check("every line matches the file (date, account, debit, credit, description)", wrong.length === 0, wrong.length === 0 ? `${rows.length} of ${rows.length} lines` : `${wrong.length} entries differ, e.g. ${wrong.slice(0, 5).join(", ")}`);

      // 2. The register lists them all (paged, as the screen pages it).
      let listed = 0;
      for (let page = 1; ; page += 1) {
        const batch = (await call(`/gl/journal-entries?page=${page}&pageSize=200`)).body as unknown[];
        listed += batch.length;
        if (batch.length < 200) break;
      }
      const counts = (await call("/gl/journal-entries/counts")).body;
      check("the journal register lists every entry", listed === byRef.size, `${listed} listed, ${byRef.size} in the file; counts ${JSON.stringify(counts)}`);

      // 3. Every account: ledger lines and balance equal the file.
      const dates = rows.map((r) => r.date!).sort();
      const lastDate = dates.at(-1)!;
      const firstDate = dates[0]!;
      const fileNet = new Map<string, number>();
      const fileLines = new Map<string, number>();
      for (const r of rows) {
        fileNet.set(r.accountCode!, (fileNet.get(r.accountCode!) ?? 0) + cents(r.debit) - cents(r.credit));
        fileLines.set(r.accountCode!, (fileLines.get(r.accountCode!) ?? 0) + 1);
      }
      const tb = (await call(`/financial-reports/trial-balance?asOfDate=${lastDate}`)).body;
      const tbNet = new Map<string, number>((tb.rows as { code: string; debit: number; credit: number }[]).map((r) => [r.code, cents(r.debit) - cents(r.credit)]));
      for (const [code, net] of [...fileNet].sort()) {
        const id = accounts.find((a) => a.code === code)?.id ?? code;
        const ledger = (await call(`/gl/accounts/${encodeURIComponent(id)}/ledger?asOf=${lastDate}`)).body;
        const ledgerLines = (ledger.lines as unknown[]).length;
        const ledgerNet = cents(ledger.balance.balance);
        check(`account ${code}`, ledgerNet === net && tbNet.get(code) === net && ledgerLines === fileLines.get(code), `file ${money(net)} (${fileLines.get(code)} lines) · ledger ${money(ledgerNet)} (${ledgerLines} lines) · trial balance ${money(tbNet.get(code) ?? 0)}`);
      }
      const tbDebit = [...tbNet.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const tbCredit = -[...tbNet.values()].filter((v) => v < 0).reduce((a, b) => a + b, 0);
      check("trial balance balances", tbDebit === tbCredit, `debit ${money(tbDebit)} · credit ${money(tbCredit)} as of ${lastDate}`);

      // 4. The statements read the same ledger.
      const expenseNet = [...fileNet].filter(([c]) => typeOf.get(c) === "expense").reduce((a, [, v]) => a + v, 0);
      const revenueNet = -[...fileNet].filter(([c]) => typeOf.get(c) === "revenue").reduce((a, [, v]) => a + v, 0);
      const is = (await call(`/financial-reports/income-statement?periodFrom=${firstDate.slice(0, 4)}-01-01&periodTo=${lastDate}`)).body;
      const isText = JSON.stringify(is);
      const isNet = (revenueNet - expenseNet) / 100;
      check("income statement carries the file's expenses", isText.includes(String(Math.abs(isNet))) || isText.includes(Math.abs(isNet).toFixed(2)), `expected net result ${money(revenueNet - expenseNet)} for ${firstDate.slice(0, 4)}-01-01 → ${lastDate}`);
      const bs = (await call(`/financial-reports/balance-sheet?asOfDate=${lastDate}`)).body;
      const side = (name: string) => (bs.rows as { side: string; amount: number }[]).filter((r) => r.side === name).reduce((a, r) => a + cents(r.amount), 0);
      const assets = side("asset");
      const funding = side("liability-equity");
      check("balance sheet balances", assets === funding && assets !== 0, `assets ${money(assets)} · liabilities + equity ${money(funding)} as of ${lastDate}`);
      const status = (await call("/data-migration/status")).body;
      check("the import step's count", status.journalEntries === byRef.size, `${status.journalEntries} registered`);

      // 5. As if entered when it happened: month by month, every report that
      //    filters by date sees exactly that month's records, and every
      //    month-end balance is the running total of the file up to then.
      const monthEnd = (ym: string) => {
        const [y, m] = ym.split("-").map(Number) as [number, number];
        return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
      };
      const months = [...new Set(rows.map((r) => r.date!.slice(0, 7)))].sort();
      const timelineFails: string[] = [];
      const timeline: Record<string, unknown>[] = [];
      for (const ym of months) {
        const from = `${ym}-01`;
        const to = monthEnd(ym);
        const monthRows = rows.filter((r) => r.date!.startsWith(ym));
        const monthEntries = new Set(monthRows.map((r) => r.entryRef!.trim())).size;
        const monthExpense = monthRows.filter((r) => typeOf.get(r.accountCode!) === "expense").reduce((a, r) => a + cents(r.debit) - cents(r.credit), 0);
        const monthRevenue = monthRows.filter((r) => typeOf.get(r.accountCode!) === "revenue").reduce((a, r) => a + cents(r.credit) - cents(r.debit), 0);
        // journal register filtered to the month
        let listedInMonth = 0;
        for (let page = 1; ; page += 1) {
          const batch = (await call(`/gl/journal-entries?fromDate=${from}&toDate=${to}&page=${page}&pageSize=200`)).body as { date: string }[];
          listedInMonth += batch.filter((e) => e.date >= from && e.date <= to).length;
          if (batch.length < 200) break;
        }
        // day book for the month
        const dayBook = (await call(`/financial-reports/day-book?periodFrom=${from}&periodTo=${to}`)).body;
        const dayBookDebit = cents(dayBook.grandTotals?.debit ?? (dayBook.rows as { debit?: number }[] | undefined)?.reduce((a, r) => a + (r.debit ?? 0), 0) ?? 0);
        const fileDebit = monthRows.reduce((a, r) => a + cents(r.debit), 0);
        // income statement for the month alone
        const isMonth = (await call(`/financial-reports/income-statement?periodFrom=${from}&periodTo=${to}`)).body;
        const isMonthNet = cents(isMonth.grandTotals?.amount ?? 0);
        // trial balance at month end = running total of the file
        const tbMonth = (await call(`/financial-reports/trial-balance?asOfDate=${to}`)).body;
        const tbAt = new Map<string, number>((tbMonth.rows as { code: string; debit: number; credit: number }[]).map((r) => [r.code, cents(r.debit) - cents(r.credit)]));
        const running = new Map<string, number>();
        for (const r of rows) if (r.date! <= to) running.set(r.accountCode!, (running.get(r.accountCode!) ?? 0) + cents(r.debit) - cents(r.credit));
        const tbOk = [...running].every(([c, v]) => tbAt.get(c) === v) && [...tbAt].every(([c, v]) => v === 0 || running.get(c) === v);
        const ok = listedInMonth === monthEntries && dayBookDebit === fileDebit && isMonthNet === monthRevenue - monthExpense && tbOk;
        timeline.push({ month: ym, entries: monthEntries, listed: listedInMonth, fileDebit: fileDebit / 100, dayBookDebit: dayBookDebit / 100, expense: monthExpense / 100, incomeStatementNet: isMonthNet / 100, trialBalanceMatchesRunningTotal: tbOk });
        if (!ok) timelineFails.push(`${ym} (journal ${listedInMonth}/${monthEntries}, day book ${money(dayBookDebit)}/${money(fileDebit)}, income statement ${money(isMonthNet)}/${money(monthRevenue - monthExpense)}, trial balance ${tbOk ? "ok" : "differs"})`);
        console.log(`        ${ym}: ${monthEntries} entries · expenses ${money(monthExpense)} · income statement ${money(isMonthNet)} · day book ${money(dayBookDebit)} · month-end trial balance ${tbOk ? "= running total" : "DIFFERS"}`);
      }
      check(`month by month (${months[0]} → ${months.at(-1)}): journal, day book, income statement and month-end trial balance match the file`, timelineFails.length === 0, timelineFails.length === 0 ? `${months.length} months` : timelineFails.join(" | "));
      // nothing outside the file's dates
      const before = (await call(`/gl/journal-entries?toDate=${new Date(Date.parse(firstDate) - 86400000).toISOString().slice(0, 10)}&pageSize=200`)).body as unknown[];
      const after = (await call(`/gl/journal-entries?fromDate=${new Date(Date.parse(lastDate) + 86400000).toISOString().slice(0, 10)}&pageSize=200`)).body as unknown[];
      check("no entry dated outside the file's period", before.length === 0 && after.length === 0, `${before.length} before ${firstDate}, ${after.length} after ${lastDate}`);
      // entry numbers run in date order, as if keyed in day by day
      const all: { entryNo: string; date: string }[] = [];
      for (let page = 1; ; page += 1) {
        const batch = (await call(`/gl/journal-entries?page=${page}&pageSize=200`)).body as { entryNo: string; date: string }[];
        all.push(...batch);
        if (batch.length < 200) break;
      }
      const byNo = [...all].sort((a, b) => a.entryNo.localeCompare(b.entryNo));
      const outOfOrder = byNo.filter((e, i) => i > 0 && e.date < byNo[i - 1]!.date);
      check("entry numbers run in date order", outOfOrder.length === 0, outOfOrder.length === 0 ? `${byNo[0]?.entryNo} (${byNo[0]?.date}) … ${byNo.at(-1)?.entryNo} (${byNo.at(-1)?.date})` : `${outOfOrder.length} out of order, e.g. ${outOfOrder[0]?.entryNo}`);
      const periods = (await call("/fiscal-periods")).body as { year: number; status: string }[];
      const years = [...new Set(periods.map((p) => p.year))].sort();
      check("fiscal years cover every date and stay open", months.every((ym) => years.includes(Number(ym.slice(0, 4)))) && periods.every((p) => p.status === "open"), `years ${years.join(", ")}`);
      if (keepDir) writeFileSync(path.join(dir, "timeline.json"), JSON.stringify(timeline, null, 2));
    }
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length === 0 ? "ALL CHECKS PASSED" : `${failed.length} CHECK(S) FAILED`} — ${checks.length} checks`);
  if (keepDir) {
    writeFileSync(path.join(dir, "report.json"), JSON.stringify({ chartFile, journalFile, openingFile, checks }, null, 2));
    console.log(`database and report kept in ${dir}`);
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
  handle.close();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
