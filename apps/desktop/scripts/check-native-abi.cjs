// Electron MAIN-PROCESS script. Run it with the Electron binary, not node:
//   xvfb-run -a npx electron apps/desktop/scripts/check-native-abi.cjs
//
// WHAT IT CATCHES, AND WHY IT HAS TO RUN INSIDE ELECTRON.
//
// `better-sqlite3` is a native module: its `.node` binary is compiled against
// one NODE_MODULE_VERSION and refuses to load under any other. Node 22 is ABI
// 131 and Electron 39 is ABI 140, so the binary `pnpm install` leaves behind —
// built for Node, because that is what runs the tests — cannot be loaded by the
// packaged app at all. scripts/build.mjs declares better-sqlite3 `external`, so
// nothing about that is visible at bundle time; the failure surfaces at the
// `new Database(dbPath)` in main/index.ts, which runs BEFORE the pre-migration
// backup, so the app does not start and takes no backup on the way down.
//
// The repo went from Electron 33 to 39 — an ABI change — with no CI step that
// ever launched Electron, no `electron-rebuild`, no `npmRebuild` and no
// postinstall. Nothing in `pnpm typecheck`, `pnpm lint`, `pnpm test` or
// `pnpm build` can see this: they all pass on a build that cannot open its own
// database. Only loading the real binary under the real runtime can, which is
// what this does.
//
// CommonJS on purpose: Electron's main process loads `.cjs` directly, and this
// script must not depend on the esbuild bundle it is checking the inputs of.

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { app } = require("electron");

function die(message, err) {
  console.error(`[abi] FAIL: ${message}`);
  if (err) console.error(err);
  process.exit(1);
}

// No window, no GPU, no display work of any kind — this is a headless load test
// and the CI runner has no reason to spin up a compositor for it.
app.disableHardwareAcceleration();

const abi = process.versions.modules;
console.log(
  `[abi] electron ${process.versions.electron} · node ${process.versions.node} · NODE_MODULE_VERSION ${abi}`,
);

let Database;
try {
  Database = require("better-sqlite3");
} catch (err) {
  die(
    `better-sqlite3 will not load under Electron's ABI (NODE_MODULE_VERSION ${abi}). ` +
      "Rebuild it for Electron (@electron/rebuild, or electron-builder's npmRebuild) — " +
      "the packaged app cannot open its database until you do.",
    err,
  );
}

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mezan-abi-")), "abi-check.db");
try {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, memo TEXT NOT NULL)");
  // Arabic text through the same driver the books go through: a build linked
  // against a SQLite without full UTF-8 handling would round-trip this wrong,
  // and every document in this product is Arabic.
  db.prepare("INSERT INTO probe (id, memo) VALUES (?, ?)").run(1, "قيد تجريبي");
  const row = db.prepare("SELECT memo FROM probe WHERE id = 1").get();
  if (!row || row.memo !== "قيد تجريبي") die(`round-trip mismatch: ${JSON.stringify(row)}`);

  const integrity = db.pragma("integrity_check");
  if (integrity.map((r) => r.integrity_check).join("; ") !== "ok") {
    die(`integrity_check did not return ok: ${JSON.stringify(integrity)}`);
  }
  db.close();
} catch (err) {
  die("opening a database under Electron failed", err);
} finally {
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

console.log("[abi] OK — better-sqlite3 loads and opens a database under this Electron build.");
process.exit(0);
