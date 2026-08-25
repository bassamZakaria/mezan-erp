import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

/**
 * The catalogue is one file that several processes append to when the sweep
 * runs in parallel, and each append is a read-modify-write. `mkdir` is atomic
 * on every platform we run on, so it is the lock.
 */
const LOCK = "/tmp/mezan-catalog.lock";
function withLock(fn) {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      mkdirSync(LOCK);
      try { return fn(); } finally { rmSync(LOCK, { recursive: true, force: true }); }
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  throw new Error("could not acquire the catalogue lock");
}

const CATALOG = "apps/web/src/i18n/catalog.ts";
const entries = JSON.parse(readFileSync(process.argv[2], "utf8"));
const banner = process.argv[3] ?? "";

const q = (s) => JSON.stringify(s);
const block = (idx) =>
  (banner ? `\n  // ${banner}\n` : "\n") +
  Object.entries(entries)
    .map(([k, v]) => `  ${q(k)}: ${q(v[idx])},`)
    .join("\n") +
  "\n";

withLock(() => {
  let src = readFileSync(CATALOG, "utf8");
  const arEnd = src.indexOf("} as const;");
  if (arEnd < 0) throw new Error("webAr terminator not found");
  src = src.slice(0, arEnd) + block(0) + src.slice(arEnd);

  const enMarker = "\nexport const webCatalogs";
  const enEnd = src.lastIndexOf("};", src.indexOf(enMarker));
  if (enEnd < 0) throw new Error("webEn terminator not found");
  src = src.slice(0, enEnd) + block(1) + src.slice(enEnd);

  writeFileSync(CATALOG, src);
});
console.log(`added ${Object.keys(entries).length} keys`);
