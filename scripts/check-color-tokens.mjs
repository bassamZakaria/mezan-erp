import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * A Tailwind colour class naming a token that does not exist does NOT error and
 * does NOT emit CSS — the class is simply absent from the stylesheet, so the
 * element silently inherits. That shipped an unreadable active tab (near-black
 * ink on the dark teal brand); typecheck, lint and build all passed.
 *
 * Ground truth is the compiled stylesheet, not a re-implementation of Tailwind's
 * name resolution: every colour utility written in source must exist as a
 * selector in the built CSS.
 */

const WEB = "apps/web";
const SOURCE_DIRS = [`${WEB}/src`, "packages/ui/src"];
const COLOUR_UTILS = [
  "text", "bg", "border", "border-s", "border-e", "border-t", "border-b", "border-x", "border-y",
  "from", "to", "via", "fill", "stroke", "ring", "outline", "divide", "decoration", "caret", "accent", "shadow",
];

function newestSourceMtime() {
  const stamps = [fs.statSync(`${WEB}/tailwind.config.js`).mtimeMs];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e.name)) stamps.push(fs.statSync(p).mtimeMs);
    }
  };
  for (const d of SOURCE_DIRS) walk(d);
  return Math.max(...stamps);
}

function builtCss() {
  const dir = path.join(WEB, "dist/assets");
  const find = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".css")) : []);
  // A stale stylesheet would fail a class that a just-added token does emit.
  const stale = () => {
    const files = find();
    if (!files.length) return true;
    const built = Math.min(...files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
    return built < newestSourceMtime();
  };
  if (stale()) {
    execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "error"], { cwd: WEB, stdio: "inherit" });
  }
  const files = find();
  if (!files.length) throw new Error(`no built CSS under ${dir} — run the web build first`);
  return files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
}

const css = builtCss();
const present = new Set([...css.matchAll(/\.((?:[-a-zA-Z0-9]|\\.)+)/g)].map((m) => m[1].replace(/\\/g, "")));

const files = execFileSync("grep", ["-rl", "className", ...SOURCE_DIRS, "--include=*.tsx"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);

const UTIL = new RegExp(String.raw`^((?:[a-z-]+(?:\[[^\]]*\])?:)*)(${COLOUR_UTILS.join("|")})-([a-z][a-z0-9-]*)$`);
const failures = [];

/**
 * Identify class strings by evidence, not by the syntax around them: a ternary
 * branch inside className={...} sits on its own line with no `className=` on it.
 * A literal counts as a class list only if some other token in it is a class the
 * stylesheet actually contains — so "from-receipt" (a lone union member) is
 * skipped while "rounded-md bg-brand text-on-brand" is checked.
 */
for (const file of files) {
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const lit of line.matchAll(/"([^"\n]{4,})"|'([^'\n]{4,})'|`([^`\n]{4,})`/g)) {
      const text = lit[1] ?? lit[2] ?? lit[3];
      const tokens = text.split(/\s+/).filter(Boolean);
      if (tokens.length < 2) continue;
      if (!tokens.some((t) => present.has(t) || present.has(t.replace(/^(?:[a-z-]+:)+/, "")))) continue;
      for (const t of tokens) {
        const m = UTIL.exec(t);
        if (!m) continue;
        const [, variants, util, name] = m;
        if (present.has(t) || present.has(`${util}-${name}`)) continue;
        failures.push(`${file}:${i + 1}  ${t}`);
      }
    }
  });
}

if (failures.length) {
  console.error(`✖ ${failures.length} colour utility class(es) emit no CSS — the token does not exist:\n`);
  for (const f of failures) console.error("  " + f);
  console.error(`\nDeclared colours live in ${WEB}/tailwind.config.js. Add the token, or use an existing one.`);
  process.exit(1);
}
console.log(`✔ colour tokens: ${files.length} files, every colour utility resolves to real CSS`);
