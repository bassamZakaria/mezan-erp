#!/usr/bin/env node
/**
 * Native form-control check.
 *
 * Screens must use the @mezan/ui primitives (Select, TextInput, TextArea,
 * Checkbox, Switch, SearchInput) rather than raw `<select>`, `<input>` and
 * `<textarea>`: the native controls are painted by the OS, which ignores the
 * design tokens, the dark theme and the Arabic type ramp, and renders the
 * `<select>` option list outside the app's styling entirely.
 *
 * The primitives themselves own a native element by definition, so the files
 * that implement them are exempt, as are the input types no primitive covers.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["apps", "packages"];
// `release` is electron-builder output (apps/desktop/release) — a packaged copy of
// the built web bundle, so every rule below matched MINIFIED CSS and reported the
// font-face block as a hardcoded physical property. It is gitignored; these
// scanners walk the filesystem, not the index, so they have to be told too.
// "mobile" is React Native, not the DOM: it has no CSS classes and no @mezan/ui controls,
// so both of these web scanners would report every file. Its RTL and control rules are
// enforced by scripts/check-mobile-rtl.mjs instead — keep that one in step with this one.
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".worktrees", "build", "release", "coverage", "mobile"]);

/** Files that implement a primitive, and so legitimately render the native element. */
const EXEMPT_FILES = new Set(
  [
    "packages/ui/src/primitives/form.tsx",
    "packages/ui/src/primitives/Select.tsx",
    "packages/ui/src/primitives/MoneyInput.tsx",
    "packages/ui/src/primitives/MoneyStringInput.tsx",
    "packages/ui/src/primitives/QtyInput.tsx",
    "packages/ui/src/primitives/EntityPicker.tsx",
    "packages/ui/src/shell/CommandPalette.tsx",
    "packages/ui/src/shell/CommandBar.tsx",
  ].map((p) => p.split("/").join("/")),
);

// No primitive wraps these; the browser control is the only implementation.
const ALLOWED_INPUT_TYPES = new Set(["file", "color", "hidden", "radio", "range"]);
const ALLOW_MARKER = "native-control-allow";

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
    else if (extname(entry) === ".tsx" && !entry.endsWith(".test.tsx")) files.push(full);
  }
}
for (const dir of SCAN_DIRS) walk(join(repoRoot, dir));

const failures = [];
for (const file of files) {
  const rel = relative(repoRoot, file).split("\\").join("/");
  if (EXEMPT_FILES.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const match = /<(select|textarea|input)\b/.exec(line);
    if (!match) return;
    if (line.includes(ALLOW_MARKER)) return;
    if (match[1] === "input") {
      // The type may sit on a later line of a multi-line element.
      const block = lines.slice(index, index + 12).join(" ");
      const type = /type=(?:"([a-z]+)"|\{"([a-z]+)"\})/.exec(block);
      if (type && ALLOWED_INPUT_TYPES.has(type[1] ?? type[2])) return;
    }
    failures.push({ where: `${rel}:${index + 1}`, tag: match[1] });
  });
}

if (failures.length > 0) {
  console.error(`✖ ${failures.length} native form control(s) — use the @mezan/ui primitive instead:\n`);
  for (const f of failures) {
    const fix =
      f.tag === "select"
        ? "Select"
        : f.tag === "textarea"
          ? "TextArea"
          : "TextInput / Checkbox / SearchInput";
    console.error(`  ${f.where}  <${f.tag}>  →  ${fix}`);
  }
  console.error(`\nIf the native element is genuinely the only option, mark the line "${ALLOW_MARKER}".`);
  process.exit(1);
}
console.log(`✔ native controls: ${files.length} files, every form control comes from @mezan/ui`);
