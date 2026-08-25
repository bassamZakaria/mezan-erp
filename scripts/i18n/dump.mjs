import { readFileSync } from "node:fs";
import ts from "typescript";
const AR = /[؀-ۿ]/;
const out = new Map();
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && AR.test(n.text)) { out.set(n.text, 1); return; }
    if (ts.isJsxText(n) && AR.test(n.text) && n.text.trim()) { out.set(n.text.trim(), 1); return; }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
}
console.log(JSON.stringify(Object.fromEntries([...out.keys()].map((k) => [k, ""])), null, 1));
