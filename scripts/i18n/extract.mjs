import { readFileSync } from "node:fs";
import ts from "typescript";

const AR = /[؀-ۿ]/;

export function extract(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const push = (node, kind, text) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ kind, text, line: line + 1, start: node.getStart(sf), end: node.getEnd() });
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) && AR.test(node.text)) {
      const p = node.parent;
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return;
      push(node, ts.isJsxAttribute(p) ? "jsx-attr" : "string", node.text);
      return;
    }
    if (ts.isJsxText(node) && AR.test(node.text) && node.text.trim()) {
      push(node, "jsx-text", node.text.trim());
      return;
    }
    if (ts.isNoSubstitutionTemplateLiteral(node) && AR.test(node.text)) {
      push(node, "template", node.text);
      return;
    }
    if (ts.isTemplateExpression(node) && AR.test(node.getText(sf))) {
      push(node, "template-expr", node.getText(sf));
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return { src, hits };
}

if (process.argv[2]) {
  const all = {};
  for (const f of process.argv.slice(2)) all[f] = extract(f).hits;
  console.log(JSON.stringify(all, null, 1));
}
