import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { applyNavFragments, type NavFragment, type NavGroupSpec } from "../../apps/web/src/fragments";

export interface ScreenEntry {
  readonly key: string;
  readonly path: string;
  readonly group: string | null;
  readonly groupLabel: string | null;
  readonly label: string | null;
  readonly labelOccurrence: number;
  readonly inNav: boolean;
  readonly routed: boolean;
}

const WEB_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web/src");

function parse(file: string): ts.SourceFile {
  const full = path.join(WEB_SRC, file);
  return ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((el) => literal(el));
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return literal(node.expression);
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      out[propertyName(prop.name)] = literal(prop.initializer);
    }
    return out;
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  throw new Error(`unsupported property name: ${name.getText()}`);
}

function findVariable(source: ts.SourceFile, name: string): ts.Expression {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = node.initializer;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`${name} not found in ${source.fileName}`);
  return found;
}

function objectKeys(expr: ts.Expression): string[] {
  let node: ts.Expression = expr;
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  if (!ts.isObjectLiteralExpression(node)) throw new Error("expected an object literal");
  return node.properties.filter(ts.isPropertyAssignment).map((p) => propertyName(p.name));
}

function bareKeys(source: ts.SourceFile): string[] {
  const keys: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isForOfStatement(node) && ts.isArrayLiteralExpression(node.expression)) {
      for (const el of node.expression.elements) if (ts.isStringLiteral(el)) keys.push(el.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}

function sourcesUnder(dir: string): string[] {
  const full = path.join(WEB_SRC, dir);
  let entries: string[];
  try {
    entries = readdirSync(full).sort();
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const rel = path.join(dir, entry);
    if (statSync(path.join(WEB_SRC, rel)).isDirectory()) return sourcesUnder(rel);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [rel] : [];
  });
}

// The POS and enhancement lanes register nav, screens and labels in fragment files (apps/web/src/fragments.ts).
const NAV_FRAGMENT_FILES = [...sourcesUnder("screens/pos/nav"), ...sourcesUnder("screens/enh/nav")].filter(
  (file) => path.basename(file, path.extname(file)) !== "index",
);
const LABEL_SOURCES = ["i18n/catalog.ts", ...sourcesUnder("screens/pos"), ...sourcesUnder("screens/enh")];

function arabicLabels(kind: "item" | "group"): Map<string, string> {
  const catalog = LABEL_SOURCES.map((file) => readFileSync(path.join(WEB_SRC, file), "utf8")).join("\n");
  const labels = new Map<string, string>();
  for (const m of catalog.matchAll(new RegExp(`"nav\\.${kind}\\.([a-z0-9-]+)":\\s*"([^"]*)"`, "g"))) {
    if (!labels.has(m[1]!)) labels.set(m[1]!, m[2]!);
  }
  return labels;
}


// Must stay in step with apps/web/src/routing.ts, which builds the real route table the same way.
export function loadScreenCatalog(): ScreenEntry[] {
  const fragments = NAV_FRAGMENT_FILES.map((file) => literal(findVariable(parse(file), "navFragment")) as NavFragment);
  const groups = applyNavFragments(literal(findVariable(parse("nav-config.tsx"), "coreNavGroupSpecs")) as NavGroupSpec[], fragments);
  const routing = parse("routing.ts");
  const unlisted = literal(findVariable(routing, "UNLISTED_SCREEN_GROUP")) as Record<string, string>;
  const bare = bareKeys(routing);
  const routedKeys = new Set([
    ...objectKeys(findVariable(parse("router/screens.ts"), "SCREEN_MODULES")),
    ...NAV_FRAGMENT_FILES.flatMap((file) => objectKeys(findVariable(parse(file), "screens"))),
  ]);
  for (const k of ["users", "roles", "role-editor"]) routedKeys.add(k);
  const labels = arabicLabels("item");
  const groupLabels = arabicLabels("group");

  const pathByKey = new Map<string, { path: string; group: string | null; inNav: boolean }>();
  for (const group of groups) {
    const keys = [...group.itemKeys, ...(group.sections ?? []).flatMap((s) => s.itemKeys)];
    for (const key of keys) pathByKey.set(key, { path: `${group.key}/${key}`, group: group.key, inNav: true });
  }
  for (const [key, group] of Object.entries(unlisted)) {
    if (!pathByKey.has(key)) pathByKey.set(key, { path: `${group}/${key}`, group, inNav: false });
  }
  for (const key of bare) {
    if (!pathByKey.has(key)) pathByKey.set(key, { path: key, group: null, inNav: false });
  }
  for (const key of routedKeys) {
    if (!pathByKey.has(key)) pathByKey.set(key, { path: key, group: null, inNav: false });
  }

  const occurrence = new Map<string, number>();
  for (const group of groups) {
    const seen = new Map<string, number>();
    for (const key of [...group.itemKeys, ...(group.sections ?? []).flatMap((sec) => sec.itemKeys)]) {
      const label = labels.get(key) ?? key;
      const n = seen.get(label) ?? 0;
      occurrence.set(key, n);
      seen.set(label, n + 1);
    }
  }

  return [...pathByKey.entries()].map(([key, v]) => ({
    key,
    path: `/${v.path}`,
    group: v.group,
    groupLabel: v.group ? (groupLabels.get(v.group) ?? null) : null,
    label: labels.get(key) ?? null,
    labelOccurrence: occurrence.get(key) ?? 0,
    inNav: v.inNav,
    routed: routedKeys.has(key),
  }));
}

export enum ScreenDoor {
  Public = "public",
  Platform = "platform",
  Tenant = "tenant",
}

export enum AddressSource {
  BankStatement = "bank-statement",
  LandedCost = "landed-cost",
  ClosedFiscalPeriod = "closed-fiscal-period",
  OpenFiscalPeriod = "open-fiscal-period",
  PlatformTenant = "platform-tenant",
  PlatformPlan = "platform-plan",
}

export const ADDRESS_PLACEHOLDER = "{id}";

export interface AddressedScreen {
  readonly key: string;
  readonly door: ScreenDoor;
  readonly path: string;
  readonly addressedBy?: AddressSource;
}

export const ADDRESSED_SCREENS: readonly AddressedScreen[] = [
  { key: "bank-reconciliation-workspace", door: ScreenDoor.Tenant, path: `/money/bank-reconciliation/${ADDRESS_PLACEHOLDER}`, addressedBy: AddressSource.BankStatement },
  { key: "landed-cost-document", door: ScreenDoor.Tenant, path: `/buy/landed-costs/${ADDRESS_PLACEHOLDER}`, addressedBy: AddressSource.LandedCost },
  { key: "landed-cost-new", door: ScreenDoor.Tenant, path: "/buy/landed-costs/new" },
  { key: "recurring-journals-due", door: ScreenDoor.Tenant, path: "/money/recurring-journals/due" },
  { key: "recurring-journals-history", door: ScreenDoor.Tenant, path: "/money/recurring-journals/history" },
  { key: "period-close-closed-month", door: ScreenDoor.Tenant, path: `/money/period-close?period=${ADDRESS_PLACEHOLDER}`, addressedBy: AddressSource.ClosedFiscalPeriod },
  { key: "period-close-open-month", door: ScreenDoor.Tenant, path: `/money/period-close?period=${ADDRESS_PLACEHOLDER}`, addressedBy: AddressSource.OpenFiscalPeriod },
  { key: "unlock-link", door: ScreenDoor.Public, path: "/unlock" },
  { key: "signup", door: ScreenDoor.Public, path: "/signup" },
  { key: "owner-hand-over", door: ScreenDoor.Public, path: "/signup/owner-handover" },
  { key: "platform-login", door: ScreenDoor.Public, path: "/platform/login" },
  { key: "platform-tenants", door: ScreenDoor.Platform, path: "/platform/tenants" },
  { key: "platform-tenant-detail", door: ScreenDoor.Platform, path: `/platform/tenants/${ADDRESS_PLACEHOLDER}`, addressedBy: AddressSource.PlatformTenant },
  { key: "platform-plans", door: ScreenDoor.Platform, path: "/platform/plans" },
  { key: "platform-plan-editor", door: ScreenDoor.Platform, path: `/platform/plans/${ADDRESS_PLACEHOLDER}`, addressedBy: AddressSource.PlatformPlan },
  { key: "platform-operators", door: ScreenDoor.Platform, path: "/platform/users" },
  { key: "platform-security-events", door: ScreenDoor.Platform, path: "/platform/security" },
];
