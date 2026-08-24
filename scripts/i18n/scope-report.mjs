import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import ts from "typescript";
const AR = /[؀-ۿ]/;

function enclosing(node, sf) {
  let n = node.parent, fn = null;
  while (n) {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) {
      let name = n.name?.getText(sf);
      if (!name && ts.isVariableDeclaration(n.parent)) name = n.parent.name.getText(sf);
      if (!fn) fn = name ?? "<anon>";
    }
    n = n.parent;
  }
  return fn;
}

const counts = { component: 0, helper: 0, module: 0 };
const moduleHits = [];
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    const isStr = (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && AR.test(node.text);
    const isTxt = ts.isJsxText(node) && AR.test(node.text) && node.text.trim();
    if (isStr || isTxt) {
      const p = node.parent;
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return;
      const fn = enclosing(node, sf);
      if (!fn) { counts.module++; moduleHits.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1}`); }
      else if (/^[A-Z]/.test(fn)) counts.component++;
      else counts.helper++;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}
console.log(counts);
console.log("module-scope sample:", moduleHits.slice(0, 15));
console.log("module-scope total:", moduleHits.length);
