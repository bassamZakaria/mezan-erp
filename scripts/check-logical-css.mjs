#!/usr/bin/env node
/**
 * RTL logical-properties check (docs/plan.md §2.1 — "RTL-first rules").
 *
 * Flags hardcoded physical `left`/`right` in CSS and TSX/TS in favour of CSS
 * logical properties (margin-inline / padding-inline / inset-inline and
 * text-align: start|end; Tailwind ps/pe/ms/me scales). This is the grep-style
 * CI check the task allows; it is wired into `pnpm lint`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["apps", "packages"];
const SCAN_EXT = new Set([".css", ".scss", ".tsx", ".ts", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".worktrees", "build"]);

const RULES = [
  {
    re: /(?:^|[\s;{"'`(,])(?:margin|padding|border|inset)-(?:left|right)\b/,
    hint: "use the -inline-start / -inline-end logical property",
  },
  {
    re: /(?:^|[\s;{"'`(,])(?:left|right)\s*:/,
    hint: "use inset-inline-start / inset-inline-end",
  },
  {
    re: /text-align\s*:\s*(?:left|right)\b/,
    hint: "use text-align: start / end",
  },
  {
    re: /\b(?:margin|padding|border)(?:Left|Right)\b/,
    hint: "use the logical *InlineStart / *InlineEnd style property",
  },
  {
    re: /textAlign\s*:\s*["'](?:left|right)["']/,
    hint: "use textAlign: 'start' / 'end'",
  },
];

// A line carrying this marker is intentionally exempt (e.g. a genuine LTR need).
const ALLOW_MARKER = "rtl-allow-physical";

/** @type {string[]} */
const files = [];
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (SCAN_EXT.has(extname(entry))) files.push(full);
  }
}

for (const d of SCAN_DIRS) walk(join(repoRoot, d));

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        violations.push(
          `${file.replace(repoRoot + "/", "")}:${i + 1}  ${line.trim()}  → ${rule.hint}`,
        );
        break;
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    `RTL check failed: ${violations.length} hardcoded physical left/right usage(s) found.\n` +
      `Use CSS logical properties instead (append "// ${ALLOW_MARKER}" to a line only for a genuine LTR need).\n`,
  );
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}

console.log(`RTL check passed: ${files.length} file(s) scanned, no physical left/right.`);
