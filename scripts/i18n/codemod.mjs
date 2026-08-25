import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const AR = /[؀-ۿ]/;

/** Every Arabic-bearing node we know how to rewrite, innermost-first. */
function collect(sf) {
  const hits = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && AR.test(node.text)) {
      hits.push({ node, kind: ts.isJsxAttribute(node.parent) ? "jsx-attr" : "string", text: node.text });
      return;
    }
    if (ts.isJsxText(node) && AR.test(node.text) && node.text.trim()) {
      hits.push({ node, kind: "jsx-text", text: node.text.trim() });
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return hits;
}

/** The nearest enclosing function, and whether it looks like a React component. */
function enclosingComponent(node, sf) {
  let n = node.parent;
  while (n) {
    if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      let name = n.name?.getText(sf);
      if (!name && ts.isVariableDeclaration(n.parent)) name = n.parent.name.getText(sf);
      if (name && /^[A-Z]/.test(name)) return n;
    }
    n = n.parent;
  }
  return null;
}

export function run(file, dict, ns, { dryRun = false } = {}) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = collect(sf);

  const keyOf = new Map();
  const used = new Set();
  const slug = (en) =>
    en.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 5)
      .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("") || "text";

  const missing = [];
  const fresh = {}; // key -> [arabic, english], only for keys this file introduces
  for (const h of hits) {
    if (keyOf.has(h.text)) continue;
    const en = dict[h.text];
    if (en === undefined) { missing.push(h.text); continue; }
    // "@some.existing.key" reuses a catalogue entry instead of minting a new one.
    if (en.startsWith("@")) { keyOf.set(h.text, en.slice(1)); continue; }
    let k = `${ns}.${slug(en)}`;
    let i = 2;
    while (used.has(k)) k = `${ns}.${slug(en)}${i++}`;
    used.add(k);
    keyOf.set(h.text, k);
    fresh[k] = [h.text, en];
  }
  if (missing.length) return { missing, hits: hits.length };

  // Rewrite back-to-front so earlier spans keep their offsets.
  const edits = [];
  const componentsNeedingHook = new Set();
  const moduleScope = [];
  for (const h of hits) {
    const key = keyOf.get(h.text);
    const call = `t("${key}")`;
    const comp = enclosingComponent(h.node, sf);
    if (!comp) {
      // Module scope has no translator in scope. Report it and leave the source
      // alone rather than emitting a `t(...)` that cannot compile.
      moduleScope.push({ text: h.text, key, line: sf.getLineAndCharacterOfPosition(h.node.getStart(sf)).line + 1 });
      continue;
    }
    componentsNeedingHook.add(comp);
    const start = h.node.getStart(sf);
    const end = h.node.getEnd();
    if (h.kind === "jsx-attr") edits.push({ start, end, text: `{${call}}` });
    else if (h.kind === "jsx-text") {
      const raw = h.node.getText(sf);
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      edits.push({ start: start + lead, end: end - trail, text: `{${call}}` });
    } else edits.push({ start, end, text: call });
  }

  const ordered = edits.slice().sort((a, b) => a.start - b.start);

  // Hook positions are captured in ORIGINAL coordinates, so they must be mapped
  // through the edits before being applied to the rewritten text — an earlier
  // version inserted at stale offsets and landed inside a string literal.
  const shift = (pos) => {
    let delta = 0;
    for (const e of ordered) {
      if (e.end <= pos) delta += e.text.length - (e.end - e.start);
      else break;
    }
    return pos + delta;
  };

  const hookInserts = [];
  for (const comp of componentsNeedingHook) {
    const body = comp.body;
    if (!body || !ts.isBlock(body)) continue;
    hookInserts.push(shift(body.getStart(sf) + 1));
  }

  let out = src;
  for (const e of ordered.slice().sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  for (const pos of hookInserts.sort((a, b) => b - a)) {
    out = out.slice(0, pos) + "\n  const { t } = useAppTranslation();" + out.slice(pos);
  }

  if (hookInserts.length && !/import \{[^}]*useAppTranslation/.test(out)) {
    // Anchor on the line that CLOSES an import: a multi-line import's
    // continuation lines do not start with `import`, so matching on that alone
    // lands inside the braces.
    const lines = out.split("\n");
    const closes = /^(?:import\b.*|\}.*)\s*from\s*".*";\s*$|^import\s+".*";\s*$/;
    let last = -1;
    for (let i = 0; i < lines.length; i++) if (closes.test(lines[i])) last = i;
    const depth = file.split("/src/")[1].split("/").length - 1;
    const rel = "../".repeat(depth) + "i18n";
    lines.splice(last + 1, 0, `import { useAppTranslation } from "${rel}";`);
    out = lines.join("\n");
  }

  // A key minted for a module-scope string is not applied, so it must not be
  // added to the catalogue as though it were.
  const appliedKeys = new Set(edits.map((e) => e.text.match(/t\("([^"]+)"\)/)?.[1]).filter(Boolean));
  for (const k of Object.keys(fresh)) if (!appliedKeys.has(k)) delete fresh[k];
  if (!dryRun) writeFileSync(file, out);
  return { fresh, moduleScope, componentCount: componentsNeedingHook.size, rewritten: hits.length };
}

const isMain = process.argv[1] && process.argv[1].endsWith("codemod.mjs");
if (isMain && process.argv[2]) {
  const [, , file, dictPath, ns] = process.argv;
  const dict = JSON.parse(readFileSync(dictPath, "utf8"));
  const res = run(file, dict, ns);
  console.log(JSON.stringify(res, null, 1));
}
