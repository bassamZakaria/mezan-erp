import { createApp } from "@mezan/api";
import { createSqliteUnitOfWork } from "@mezan/persistence";

/**
 * Desktop-edition mount (Electron main-process shape, simulated).
 * There is NO HTTP server and NO port. The renderer would marshal a request
 * over IPC; the main process calls `app.fetch(new Request(...))` directly.
 * This script does exactly that in one process to prove the mount works.
 */
async function main() {
  const uow = createSqliteUnitOfWork(":memory:");
  const app = createApp(uow);

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

  const postRes = await app.fetch(
    new Request("http://local/journal-entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    }),
  );
  console.log(`[desktop] POST -> ${postRes.status}`);
  console.log("[desktop] body:", await postRes.json());

  const getRes = await app.fetch(
    new Request(`http://local/journal-entries/${entry.id}`),
  );
  console.log(`[desktop] GET  -> ${getRes.status}`);
  console.log("[desktop] body:", await getRes.json());

  // Show the domain rejection path too.
  const bad = await app.fetch(
    new Request("http://local/journal-entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...entry,
        id: "JE-DESKTOP-0002",
        lines: [
          { accountId: "1300-1", debit: "500.000000", credit: "0.000000" },
          { accountId: "4000", debit: "0.000000", credit: "499.000000" },
        ],
      }),
    }),
  );
  console.log(`[desktop] POST unbalanced -> ${bad.status}`);
  console.log("[desktop] body:", await bad.json());

  uow.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
