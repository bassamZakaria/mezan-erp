#!/usr/bin/env node
/**
 * "A theme change alters colour only" — enforced, not documented.
 *
 * Spec: docs/design/visual-identity-and-shell.md
 * §1.1. Measured across the two source directions, 12 of 14 structural tokens
 * differed — `--h-btn` was 44px in the light direction and 38px in the dark
 * one. Shipping that pair would mean the dark theme fails the 44px target-size
 * ground rule that the light theme passes, and a toggle would change typeface,
 * corner radius and row density. A comment cannot stop that from creeping
 * back; this check can.
 *
 * Three assertions over packages/ui/src/tokens/tokens.css:
 *   1. No dark block declares a geometry, size, type or spacing token.
 *   2. The two dark blocks (the `prefers-color-scheme` one and the explicit
 *      `[data-theme="dark"]` one) declare exactly the same tokens at exactly
 *      the same values — they are duplicated by necessity, and silent drift
 *      between them is the failure mode that duplication produces. Drift here
 *      is invisible in review: it only shows when a user with a dark OS
 *      preference toggles the in-app theme and the colours change.
 *   3. No token defined in `:root` as a `var()` alias is given a literal value
 *      in a dark block. Aliases follow the theme for free; pinning one to a
 *      literal freezes it at the light value in the other theme.
 *
 * Dependency-free on purpose: this runs in `pnpm lint` on a machine that may
 * have nothing installed but node.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(pkgRoot, "src/tokens/tokens.css");
const css = readFileSync(file, "utf8");

/** Structural token families that must never appear in a dark block. */
const STRUCTURAL = [
  { re: /^--r$|^--r-/, what: "corner radius" },
  { re: /^--notch/, what: "notch geometry" },
  { re: /^--fs$|^--fs-/, what: "font size" },
  { re: /^--lh$/, what: "line height" },
  { re: /^--font-/, what: "font family" },
  { re: /^--fw-/, what: "font weight" },
  { re: /^--pad/, what: "padding" },
  { re: /^--h-/, what: "control or row height" },
  { re: /^--w-/, what: "width" },
  { re: /^--tile-/, what: "tile geometry" },
];

const lineOf = (index) => css.slice(0, index).split("\n").length;

/** Body of the rule whose selector starts at `from`, by brace matching. */
function bodyAt(from) {
  const open = css.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return { start: open + 1, end: i };
    }
  }
  return null;
}

function declarationsIn(start, end) {
  const out = [];
  // Only top-level declarations of this rule; nested rules have their own braces.
  let depth = 0;
  let i = start;
  let chunkStart = start;
  const flush = (to) => {
    const text = css.slice(chunkStart, to);
    const m = /(--[a-z0-9-]+)\s*:\s*([^;]*)$/is.exec(text.trim() ? text : "");
    if (m) out.push({ name: m[1], value: m[2].trim(), index: chunkStart + text.indexOf(m[1]) });
  };
  for (; i < end; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
    else if (css[i] === ";" && depth === 0) {
      flush(i);
      chunkStart = i + 1;
    }
  }
  flush(end);
  return out;
}

function findBlock(selectorRe, label) {
  const m = selectorRe.exec(css);
  if (!m) {
    console.error(`✖ ${label}: selector not found in ${relative(pkgRoot, file)}`);
    process.exit(1);
  }
  const body = bodyAt(m.index);
  if (!body) {
    console.error(`✖ ${label}: unbalanced braces after the selector`);
    process.exit(1);
  }
  return { label, ...body, decls: declarationsIn(body.start, body.end) };
}

const rootBlock = findBlock(/^:root\s*\{/m, ":root (light)");
const darkBlocks = [
  findBlock(/:root:not\(\[data-theme="light"\]\)\s*\{/, '@media prefers-color-scheme: dark > :root:not([data-theme="light"])'),
  findBlock(/:root\[data-theme="dark"\]\s*\{/, ':root[data-theme="dark"]'),
];

const failures = [];

for (const block of darkBlocks) {
  for (const decl of block.decls) {
    const hit = STRUCTURAL.find((s) => s.re.test(decl.name));
    if (hit) {
      failures.push(
        `${relative(pkgRoot, file)}:${lineOf(decl.index)}  ${decl.name} (${hit.what}) declared inside ${block.label}\n` +
          `      A theme may change colour only. Move it to :root, or make it a var() alias of a colour token.`,
      );
    }
  }
}

const aliases = new Set(rootBlock.decls.filter((d) => /^var\(--[a-z0-9-]+\)$/.test(d.value)).map((d) => d.name));
for (const block of darkBlocks) {
  for (const decl of block.decls) {
    if (aliases.has(decl.name) && !decl.value.startsWith("var(")) {
      failures.push(
        `${relative(pkgRoot, file)}:${lineOf(decl.index)}  ${decl.name} is a var() alias in :root but is pinned to the literal "${decl.value}" in ${block.label}\n` +
          `      Redefine the token it points at instead; the alias follows on its own.`,
      );
    }
  }
}

const [a, b] = darkBlocks.map((blk) => new Map(blk.decls.map((d) => [d.name, d.value])));
const missing = (from, to, fromLabel, toLabel) =>
  [...from.keys()].filter((n) => !to.has(n)).map((n) => `${n} is declared in ${fromLabel} but not in ${toLabel}`);
const drift = [
  ...missing(a, b, darkBlocks[0].label, darkBlocks[1].label),
  ...missing(b, a, darkBlocks[1].label, darkBlocks[0].label),
  ...[...a.entries()]
    .filter(([n, v]) => b.has(n) && b.get(n).replace(/\s+/g, " ") !== v.replace(/\s+/g, " "))
    .map(([n, v]) => `${n} is "${v}" in ${darkBlocks[0].label} but "${b.get(n)}" in ${darkBlocks[1].label}`),
];
for (const d of drift) {
  failures.push(
    `${relative(pkgRoot, file)}  ${d}\n` +
      `      The two dark blocks must stay identical: one is the OS preference, the other the explicit toggle.`,
  );
}

if (failures.length) {
  console.error(`✖ ${failures.length} theme violation(s) — the dark theme must redefine COLOUR ONLY:\n`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

console.log(
  `✔ theme: ${darkBlocks.length} dark blocks, ${a.size} colour tokens each, ` +
    `no geometry/size/type token, no pinned alias, no drift`,
);
