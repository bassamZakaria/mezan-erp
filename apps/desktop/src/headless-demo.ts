import { createApp } from "@mezan/api";
import {
  createSqliteUnitOfWork,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
} from "@mezan/persistence";

/**
 * Headless demonstration of the desktop mount without Electron.
 *
 * Electron's main process calls `app.fetch(new Request(...))` in-process (see
 * ./index.ts). This script performs exactly that call sequence in a plain Node
 * process so the dual-mount can be exercised in CI/dev without a display or the
 * Electron binary. `pnpm --filter desktop demo`.
 *
 * It posts through `/gl`, the route the product uses. It used to post through a
 * bare `POST /journal-entries` — the spike's original poster, which checked no
 * fiscal period, validated no account, stamped no number and wrote no audit
 * row. Being one of its last two callers is what kept that second way into the
 * books alive (D99).
 */
async function main() {
  const uow = createSqliteUnitOfWork(":memory:");
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();

  await accounts.create({
    id: "1300-1",
    code: "1300-1",
    nameAr: "النقدية بالخزينة",
    nameEn: "Cash on hand",
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
  });
  await accounts.create({
    id: "4000",
    code: "4000",
    nameAr: "إيرادات المبيعات",
    nameEn: "Sales revenue",
    type: "revenue",
    naturalBalance: "credit",
    parentId: null,
    isHeader: false,
    status: "active",
  });
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  const honoApp = createApp(uow, {
    gl: { ledger, accounts, periods, numbering: ledger.numbering },
  });

  const entry = {
    id: "JE-DESKTOP-0001",
    date: "2026-08-22",
    memo: "In-process cash sale",
    lines: [
      { accountId: "1300-1", debit: "500.000000", credit: "0.000000" },
      { accountId: "4000", debit: "0.000000", credit: "500.000000" },
    ],
  };

  console.log("[desktop] calling app.fetch() in-process (no socket, no port)");

  const postRes = await honoApp.fetch(
    new Request("http://local/gl/journal-entries", {
      method: "POST",
      headers: { "content-type": "application/json", "x-permissions": "accounting.journal.post" },
      body: JSON.stringify(entry),
    }),
  );
  console.log(`[desktop] POST -> ${postRes.status}`);
  console.log("[desktop] body:", await postRes.json());

  const getRes = await honoApp.fetch(
    new Request(`http://local/gl/journal-entries/${entry.id}`, {
      headers: { "x-permissions": "accounting.journal.view" },
    }),
  );
  console.log(`[desktop] GET  -> ${getRes.status}`);
  console.log("[desktop] body:", await getRes.json());

  ledger.close();
  accounts.close();
  periods.close();
  uow.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
