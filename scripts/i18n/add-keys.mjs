import { readFileSync, writeFileSync } from "node:fs";

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

let src = readFileSync(CATALOG, "utf8");
const arEnd = src.indexOf("} as const;");
if (arEnd < 0) throw new Error("webAr terminator not found");
src = src.slice(0, arEnd) + block(0) + src.slice(arEnd);

const enMarker = "\nexport const webCatalogs";
const enEnd = src.lastIndexOf("};", src.indexOf(enMarker));
if (enEnd < 0) throw new Error("webEn terminator not found");
src = src.slice(0, enEnd) + block(1) + src.slice(enEnd);

writeFileSync(CATALOG, src);
console.log(`added ${Object.keys(entries).length} keys`);
