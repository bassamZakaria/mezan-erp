import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "..", "..", "..");
const MESSAGE_ROOTS = ["packages/api/src", "packages/backend/src", "apps/server/src", "apps/desktop/src/main"];
const CLASS_ROOTS = ["packages/domain/src", "packages/api/src", "packages/backend/src", "apps/server/src"];

// Native OS dialogs, not server sentences.
const NOT_A_SERVER_SENTENCE = new Set(["apps/desktop/src/main/index.ts", "apps/desktop/src/main/updater.ts"]);
// A `message` that is stored or logged, not shown: crash reports and redacted log records.
const STORED_NOT_SHOWN = new Set([
  "packages/api/src/client-error-routes.ts report.message",
  "apps/desktop/src/main/crash-logging.ts message",
  "apps/desktop/src/main/redact.ts redactText(value.message)",
]);

const ARABIC = /[؀-ۿ]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!property.name) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return undefined;
}

function isPlainString(node: ts.Expression): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function at(source: ts.SourceFile, node: ts.Node): string {
  return `${relative(REPO, source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
}

function hasEnglishParams(node: ts.ObjectLiteralExpression): boolean {
  return node.properties.some(
    (property) =>
      propertyName(property) === "params" &&
      ts.isPropertyAssignment(property) &&
      ts.isObjectLiteralExpression(property.initializer) &&
      property.initializer.properties.some((inner) => propertyName(inner) === "messageEn"),
  );
}

function messagesWithoutEnglish(source: ts.SourceFile): string[] {
  const missing: string[] = [];
  const rel = relative(REPO, source.fileName);
  walk(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    for (const property of node.properties) {
      if (propertyName(property) === "messageEn" && ts.isPropertyAssignment(property) && ts.isPropertyAccessExpression(property.initializer) && property.initializer.name.text === "message") {
        missing.push(`${at(source, property)} messageEn carries the Arabic \`.message\``);
      }
    }
    const names = new Set(node.properties.map(propertyName));
    if (names.has("messageEn") || hasEnglishParams(node)) return;
    for (const property of node.properties) {
      if (propertyName(property) !== "message") continue;
      const valueText = ts.isPropertyAssignment(property) ? property.initializer.getText(source) : property.name?.getText(source);
      if (STORED_NOT_SHOWN.has(`${rel} ${valueText}`)) continue;
      const arabicLiteral = ts.isPropertyAssignment(property) && isPlainString(property.initializer) && ARABIC.test(property.initializer.text);
      const computed = ts.isShorthandPropertyAssignment(property) || (ts.isPropertyAssignment(property) && !isPlainString(property.initializer));
      if (arabicLiteral || computed) missing.push(at(source, property));
    }
  });
  return missing;
}

interface ErrorClass {
  where: string;
  parent: string;
  arabic: boolean;
  definesEnglish: boolean;
  overridesMessage: boolean;
}

function errorClasses(source: ts.SourceFile): Map<string, ErrorClass> {
  const classes = new Map<string, ErrorClass>();
  walk(source, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    const parent = node.heritageClauses
      ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression.getText(source);
    if (!parent) return;
    const body = node.getText(source);
    const definesEnglish =
      node.members.some((member) => member.name !== undefined && member.name.getText(source) === "messageEn") ||
      node.members.some(
        (member) => ts.isConstructorDeclaration(member) && member.parameters.some((param) => param.name.getText(source) === "messageEn" && param.modifiers !== undefined),
      ) ||
      /this\.messageEn\s*=/.test(body);
    classes.set(node.name.text, { where: at(source, node), parent, arabic: ARABIC.test(body), definesEnglish, overridesMessage: /this\.message\s*=/.test(body) });
  });
  return classes;
}

function inheritsEnglish(name: string, classes: Map<string, ErrorClass>, seen = new Set<string>()): boolean {
  const cls = classes.get(name);
  if (!cls || seen.has(name)) return false;
  seen.add(name);
  return cls.definesEnglish || inheritsEnglish(cls.parent, classes, seen);
}

describe("every server error sentence has an English twin", () => {
  it("no object carries an Arabic or computed `message` without a literal `messageEn` beside it", () => {
    const missing: string[] = [];
    for (const root of MESSAGE_ROOTS) {
      for (const file of sourceFiles(join(REPO, root))) {
        if (NOT_A_SERVER_SENTENCE.has(relative(REPO, file))) continue;
        missing.push(...messagesWithoutEnglish(parse(file)));
      }
    }
    expect(missing, `\n${missing.join("\n")}\n`).toEqual([]);
  });

  it("no error class with an Arabic message lacks `messageEn`, itself or through a parent", () => {
    const classes = new Map<string, ErrorClass>();
    for (const root of CLASS_ROOTS) {
      for (const file of sourceFiles(join(REPO, root))) {
        for (const [name, cls] of errorClasses(parse(file))) classes.set(name, cls);
      }
    }
    const missing = [...classes]
      .filter(([, cls]) => /Error$/.test(cls.parent) && cls.arabic && !cls.definesEnglish && (cls.overridesMessage || !inheritsEnglish(cls.parent, classes)))
      .map(([name, cls]) => `${cls.where} ${name}`);
    expect(missing, `\n${missing.join("\n")}\n`).toEqual([]);
  });
});
