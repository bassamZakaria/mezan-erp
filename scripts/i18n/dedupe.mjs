import { readFileSync, writeFileSync } from "node:fs";
const p = "apps/web/src/i18n/catalog.ts";
let src = readFileSync(p, "utf8");
const removed = [];
// Two object literals in the file: webAr, then webEn. Dedupe each independently.
const bounds = [
  [src.indexOf("const webAr = {"), src.indexOf("} as const;")],
  [src.indexOf("const webEn"), src.lastIndexOf("};", src.indexOf("\nexport const webCatalogs"))],
];
for (const [start, end] of bounds.reverse()) {
  const block = src.slice(start, end);
  const seen = new Set();
  const kept = block.split("\n").filter((line) => {
    const m = line.match(/^\s+"([^"]+)":/);
    if (!m) return true;
    if (seen.has(m[1])) { removed.push(m[1]); return false; }
    seen.add(m[1]);
    return true;
  });
  src = src.slice(0, start) + kept.join("\n") + src.slice(end);
}
writeFileSync(p, src);
console.log(`removed ${removed.length} duplicate lines:`, [...new Set(removed)].join(", "));
