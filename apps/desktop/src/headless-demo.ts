import { createApp } from "@mezan/api";
import {
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteLedgerStore,
  createSqliteUnitOfWork,
} from "@mezan/persistence";

/**
 * Headless demonstration of the desktop mount without Electron.
 *
 * Electron's main process calls `app.fetch(new Request(...))` in-process (see
 * ./index.ts). This script performs exactly that call sequence in a plain Node
 * process so the dual-mount can be exercised in CI/dev without a display or the
 * Electron binary. `pnpm --filter desktop demo`.
 */
async function main() {
  const uow = createSqliteUnitOfWork(":memory:");
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();

  for (const [id, type, naturalBalance] of [
    ["1300-1", "asset", "debit"],
    ["4000", "revenue", "credit"],
  ] as const) {
    await accounts.create({
      id,
      code: id,
      nameAr: id,
      nameEn: null,
      type,
      naturalBalance,
      parentId: null,
      isHeader: false,
      status: "active",
    });
  }
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
