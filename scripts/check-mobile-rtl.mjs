import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(repoRoot, "apps", "mobile", "src");
const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "build", "coverage"]);
const EXT = new Set([".ts", ".tsx"]);

const PHYSICAL = [
  [/\bmarginLeft\s*:/, "marginStart"],
  [/\bmarginRight\s*:/, "marginEnd"],
  [/\bpaddingLeft\s*:/, "paddingStart"],
  [/\bpaddingRight\s*:/, "paddingEnd"],
  [/\bborderLeftWidth\s*:/, "borderStartWidth"],
  [/\bborderRightWidth\s*:/, "borderEndWidth"],
  [/\bborderLeftColor\s*:/, "borderStartColor"],
  [/\bborderRightColor\s*:/, "borderEndColor"],
  [/\bborderTopLeftRadius\s*:/, "borderTopStartRadius"],
  [/\bborderTopRightRadius\s*:/, "borderTopEndRadius"],
  [/\bborderBottomLeftRadius\s*:/, "borderBottomStartRadius"],
  [/\bborderBottomRightRadius\s*:/, "borderBottomEndRadius"],
  [/\bleft\s*:\s*[-\d]/, "start"],
  [/\bright\s*:\s*[-\d]/, "end"],
  [/textAlign\s*:\s*"(left|right)"/, 'textAlign: "auto" (or "start"/"end" via the locale)'],
  [/flexDirection\s*:\s*"row-reverse"/, 'flexDirection: "row" — RTL is handled by I18nManager, not by reversing rows'],
];

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
    if (statSync(full).isDirectory()) walk(full);
    else if (EXT.has(extname(entry))) files.push(full);
  }
}
walk(ROOT);

const findings = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.includes("rtl-ok")) return;
    for (const [pattern, replacement] of PHYSICAL) {
      if (pattern.test(line)) {
        findings.push(`${file.slice(repoRoot.length + 1)}:${index + 1}  use ${replacement}\n    ${line.trim()}`);
        break;
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`mobile RTL check failed — ${findings.length} physical direction(s):\n`);
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
console.log(`✔ mobile RTL: ${files.length} file(s) scanned, no physical left/right.`);
