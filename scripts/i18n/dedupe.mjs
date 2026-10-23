import { readFileSync, writeFileSync } from "node:fs";
const removed = [];
const catalogues = [
  ["apps/web/src/i18n/catalog.ts", (src) => [src.indexOf("const webAr = {"), src.indexOf("} as const;")]],
  ["apps/web/src/i18n/catalog-en.ts", (src) => [src.indexOf("export const webEn"), src.indexOf("\n};", src.indexOf("export const webEn"))]],
];
for (const [path, boundsOf] of catalogues) {
  let src = readFileSync(path, "utf8");
  const [start, end] = boundsOf(src);
  if (start < 0 || end < 0) throw new Error(`catalogue bounds not found in ${path}`);
  const seen = new Set();
  const kept = src.slice(start, end).split("\n").filter((line) => {
    const m = line.match(/^\s+"([^"]+)":/);
    if (!m) return true;
    if (seen.has(m[1])) { removed.push(m[1]); return false; }
    seen.add(m[1]);
    return true;
  });
  src = src.slice(0, start) + kept.join("\n") + src.slice(end);
  writeFileSync(path, src);
}
console.log(`removed ${removed.length} duplicate lines:`, [...new Set(removed)].join(", "));
