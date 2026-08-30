import { createApp } from "@mezan/api";
import { createSqliteUnitOfWork } from "@mezan/persistence";

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
  const honoApp = createApp(uow);

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
    new Request("http://local/journal-entries", {
      method: "POST",
      headers: { "content-type": "application/json", "x-permissions": "accounting.journal.post" },
      body: JSON.stringify(entry),
    }),
  );
  console.log(`[desktop] POST -> ${postRes.status}`);
  console.log("[desktop] body:", await postRes.json());

  const getRes = await honoApp.fetch(
    new Request(`http://local/journal-entries/${entry.id}`, {
      headers: { "x-permissions": "accounting.journal.view" },
    }),
  );
  console.log(`[desktop] GET  -> ${getRes.status}`);
  console.log("[desktop] body:", await getRes.json());

  uow.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
