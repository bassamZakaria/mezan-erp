import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Every permission in the catalog must have an Arabic AND an English name for
 * the thing it acts on.
 *
 * The role editor derives each of its ~281 checkbox labels as
 * `<action verb> — <entity>`. When an entity has no `perm.entity.*` key the
 * label silently falls back to the raw Latin identifier, so an Arabic-first
 * screen renders «عرض — supplier360» and nothing fails: not typecheck, not
 * lint, not the scenarios. It was a browser console warning that found the
 * last two, which is not a gate.
 *
 * This also fails on a STALE key, so deleting a permission from the catalog
 * does not leave a translation behind claiming a screen still grants it.
 */

const CATALOG = "packages/domain/src/permissions/catalog.ts";
const LABELS = "apps/web/src/i18n/catalog.ts";

function filesUnder(dir) {
  let out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(filesUnder(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// POS and enhancement lanes register their codes and labels in fragment files, not in the two catalogs.
const PERMISSION_FRAGMENTS = [...filesUnder("packages/domain/src/pos/permissions"), ...filesUnder("packages/domain/src/enh/permissions")];
const LABEL_FRAGMENTS = [...filesUnder("apps/web/src/screens/pos"), ...filesUnder("apps/web/src/screens/enh")];

const codes = [CATALOG, ...PERMISSION_FRAGMENTS].flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/\[\s*"([a-z0-9_]+\.[a-z0-9_.]+)"/g)].map((m) => m[1]),
);

if (codes.length === 0) {
  console.error(`✖ permission labels: read no permission codes out of ${CATALOG} — the extraction is broken, not the catalog`);
  process.exit(1);
}

// `module.entity.action` -> entity; `module.action` -> module. Mirrors entitySegment().
const segments = new Set(
  codes.map((code) => {
    const parts = code.split(".");
    return parts.length >= 3 ? parts[1] : parts[0];
  }),
);

const labels = [LABELS, ...LABEL_FRAGMENTS].map((file) => readFileSync(file, "utf8")).join("\n");
const counts = new Map();
for (const [, segment] of labels.matchAll(/"perm\.entity\.([a-z0-9_]+)":/g)) {
  counts.set(segment, (counts.get(segment) ?? 0) + 1);
}

const missing = [...segments].filter((s) => !counts.has(s)).sort();
// Two locales, so exactly two occurrences per key: one in webAr, one in webEn.
const oneLocaleOnly = [...segments].filter((s) => counts.get(s) === 1).sort();
const stale = [...counts.keys()].filter((s) => !segments.has(s)).sort();

const problems = [];
if (missing.length > 0) problems.push(`missing perm.entity.* for: ${missing.join(", ")}`);
if (oneLocaleOnly.length > 0) problems.push(`translated in only one locale: ${oneLocaleOnly.join(", ")}`);
if (stale.length > 0) problems.push(`perm.entity.* with no permission left in the catalog: ${stale.join(", ")}`);

if (problems.length > 0) {
  console.error("✖ permission labels:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`✔ permission labels: ${codes.length} permissions over ${segments.size} entities, every one named in Arabic and English`);
