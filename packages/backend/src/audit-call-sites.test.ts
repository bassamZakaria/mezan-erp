import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDITED_MOUNTS, MutatingMethod } from "@mezan/api";
import { createBackend, type BackendHandle } from "./create-backend.js";

const AUDIT_WRITERS: ReadonlySet<string> = new Set(["recordAdminEvent", "recordFieldChanges", "recordSecurityAdminEvent", "recordSensitiveEvent"]);
const ROUTE_REGISTRARS: ReadonlySet<string> = new Set(["get", "post", "put", "patch", "delete", "all"]);
const MUTATING: ReadonlySet<string> = new Set([...Object.values(MutatingMethod).map(String), "ALL"]);
const MOUNT_REGISTRAR = "route";
const WRITER = "<audit writer>";

const here = path.dirname(fileURLToPath(import.meta.url));
const API_SRC = path.resolve(here, "../../api/src");
const REPO_ROOT = path.resolve(here, "../../..");
const ROOT_FACTORIES = [`${path.join(API_SRC, "app.ts")}#createApp`, `${path.join(here, "create-backend.ts")}#createBackend`];
const BACKEND_AREA_APP = "ctx.app";

interface Registration {
  readonly id: number;
  readonly file: string;
  readonly factory: string | null;
  readonly receiver: string;
  readonly method: string;
  readonly path: string;
}

interface Mount {
  readonly factory: string | null;
  readonly receiver: string;
  readonly prefix: string;
  readonly childFactory: string | null;
  readonly childReceiver: string | null;
}

interface CallSite {
  readonly where: string;
  readonly owner: string | null;
  readonly registration: number | null;
}

interface StaticScan {
  readonly registrations: readonly Registration[];
  readonly mounts: readonly Mount[];
  readonly sites: readonly CallSite[];
  readonly references: ReadonlyMap<string, ReadonlySet<string>>;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

function declaredName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? null;
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return null;
  const parent = node.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : null;
}

function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isPropertyAssignment(parent)) return parent.initializer === node;
  return !ts.isParameter(parent) && !ts.isBindingElement(parent) && !ts.isPropertySignature(parent) && !ts.isTypeReferenceNode(parent);
}

function registrarCall(
  node: ts.Node,
  constants: ReadonlyMap<string, string>,
): { readonly receiver: string; readonly verb: string; readonly literal: string; readonly call: ts.CallExpression } | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const first = node.arguments[0];
  const literal = !first ? undefined : ts.isStringLiteralLike(first) ? first.text : ts.isIdentifier(first) ? constants.get(first.text) : undefined;
  if (literal === undefined) return null;
  return { receiver: node.expression.expression.getText(), verb: node.expression.name.text, literal, call: node };
}

function stringConstants(sources: readonly ts.SourceFile[]): Map<string, string> {
  const values = new Map<string, string | null>();
  for (const source of sources) {
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isStringLiteralLike(declaration.initializer)) continue;
        const name = declaration.name.text;
        const value = declaration.initializer.text;
        values.set(name, values.has(name) && values.get(name) !== value ? null : value);
      }
    }
  }
  return new Map([...values].filter((entry): entry is [string, string] => entry[1] !== null));
}

function scan(files: readonly string[]): StaticScan {
  const registrations: Registration[] = [];
  const mounts: Mount[] = [];
  const sites: CallSite[] = [];
  const references = new Map<string, Set<string>>();
  const exportedBy = new Map<string, string[]>();
  const parsed = files.map((file) => ({ file, source: ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true) }));
  const constants = stringConstants(parsed.map(({ source }) => source));

  for (const { file, source } of parsed) {
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) exportedBy.set(statement.name.text, [...(exportedBy.get(statement.name.text) ?? []), file]);
    }
  }

  for (const { file, source } of parsed) {
    const local = new Set<string>();
    const imported = new Map<string, string>();
    const collectLocals = (node: ts.Node): void => {
      const name = declaredName(node);
      if (name) local.add(name);
      ts.forEachChild(node, collectLocals);
    };
    collectLocals(source);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const specifier = statement.moduleSpecifier.text;
      const relative = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts")) : null;
      for (const element of bindings.elements) {
        const exportedName = (element.propertyName ?? element.name).text;
        const candidates = exportedBy.get(exportedName) ?? [];
        const target = relative && existsSync(relative) && candidates.includes(relative) ? relative : candidates.length === 1 ? candidates[0] : null;
        if (target) imported.set(element.name.text, `${target}#${exportedName}`);
      }
    }
    const resolve = (name: string): string | null => {
      if (local.has(name)) return `${file}#${name}`;
      if (imported.has(name)) return imported.get(name)!;
      return AUDIT_WRITERS.has(name) ? WRITER : null;
    };
    const refer = (from: string, name: string): void => {
      const target = resolve(name);
      if (!target || target === from) return;
      references.set(from, (references.get(from) ?? new Set<string>()).add(target));
    };
    const calledFactory = (expression: ts.Expression, scope: ts.Node): string | null => {
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) return resolve(expression.expression.text);
      if (!ts.isIdentifier(expression)) return null;
      let found: string | null = null;
      const look = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expression.text && node.initializer) {
          found = calledFactory(node.initializer, scope);
        }
        ts.forEachChild(node, look);
      };
      look(scope);
      return found;
    };

    const visit = (node: ts.Node, factory: string | null, factoryNode: ts.Node, owner: string | null, registration: number | null): void => {
      const name = declaredName(node);
      const isTopLevel = name !== null && factory === null;
      const nextFactory = isTopLevel ? `${file}#${name}` : factory;
      const nextFactoryNode = isTopLevel ? node : factoryNode;
      let nextOwner = name ? `${file}#${name}` : owner;
      let nextRegistration = name ? null : registration;

      const registrar = registrarCall(node, constants);
      if (registrar && ROUTE_REGISTRARS.has(registrar.verb)) {
        const id = registrations.length;
        registrations.push({ id, file, factory, receiver: registrar.receiver, method: registrar.verb.toUpperCase(), path: registrar.literal });
        nextOwner = null;
        nextRegistration = id;
      }
      if (registrar && registrar.verb === MOUNT_REGISTRAR && registrar.call.arguments[1]) {
        const child = registrar.call.arguments[1];
        const childFactory = calledFactory(child, factoryNode);
        mounts.push({
          factory,
          receiver: registrar.receiver,
          prefix: registrar.literal,
          childFactory,
          childReceiver: !childFactory && ts.isIdentifier(child) ? child.text : null,
        });
      }

      const from = owner ?? (registration === null ? null : `route:${registration}`);
      if (from && ts.isIdentifier(node) && isValueReference(node)) refer(from, node.text);
      if (ts.isCallExpression(node)) {
        const callee = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
        const ownerName = owner?.slice(owner.indexOf("#") + 1);
        if (callee && AUDIT_WRITERS.has(callee) && !(ownerName && AUDIT_WRITERS.has(ownerName))) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          sites.push({ where: `${path.relative(REPO_ROOT, file)}:${line + 1}`, owner, registration: owner ? null : registration });
        }
      }
      ts.forEachChild(node, (child) => visit(child, nextFactory, nextFactoryNode, nextOwner, nextRegistration));
    };
    visit(source, null, source, null, null);
  }
  return { registrations, mounts, sites, references };
}

function join(prefix: string, local: string): string {
  const joined = `${prefix}${local === "/" ? "" : local}`.replace(/\/{2,}/g, "/");
  return joined === "" ? "/" : joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

function mountedPaths(scanned: StaticScan): Map<number, string[]> {
  const paths = new Map<number, string[]>();
  const walk = (factory: string, prefix: string, trail: readonly string[]): void => {
    if (trail.includes(factory)) return;
    const mounts = scanned.mounts.filter((mount) => mount.factory === factory);
    const nested = new Set(mounts.flatMap((mount) => (mount.childReceiver ? [mount.childReceiver] : [])));
    const prefixOf = (receiver: string, seen: readonly string[] = []): string[] => {
      if (!nested.has(receiver) || seen.includes(receiver)) return [prefix];
      return mounts
        .filter((mount) => mount.childReceiver === receiver)
        .flatMap((mount) => prefixOf(mount.receiver, [...seen, receiver]).map((base) => join(base, mount.prefix)));
    };
    for (const registration of scanned.registrations.filter((entry) => entry.factory === factory)) {
      const full = prefixOf(registration.receiver).map((base) => join(base, registration.path));
      paths.set(registration.id, [...(paths.get(registration.id) ?? []), ...full]);
    }
    for (const mount of mounts) {
      if (!mount.childFactory) continue;
      for (const base of prefixOf(mount.receiver)) walk(mount.childFactory, join(base, mount.prefix), [...trail, factory]);
    }
  };
  for (const root of ROOT_FACTORIES) walk(root, "", []);
  for (const mount of scanned.mounts) {
    if (mount.receiver === BACKEND_AREA_APP && mount.childFactory) walk(mount.childFactory, join("", mount.prefix), []);
  }
  return paths;
}

function closure(seed: Iterable<string>, edges: (name: string) => Iterable<string>): Set<string> {
  const reached = new Set(seed);
  const pending = [...reached];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    for (const next of edges(name)) {
      if (reached.has(next)) continue;
      reached.add(next);
      pending.push(next);
    }
  }
  return reached;
}

function insideABoundary(routePath: string): boolean {
  const sample = routePath.replace(/:[^/]+/g, "x");
  return AUDITED_MOUNTS.some((mount) => {
    if (sample !== mount.prefix && !sample.startsWith(`${mount.prefix}/`)) return false;
    return !mount.only || mount.only.test(sample.slice(mount.prefix.length));
  });
}

const CONFIG_TRANSACTOR = "write and event run in atomically(deps.transactor), which the backend backs with withSqliteTransaction on the shared connection";
const PREVIEW_OF_A_SHARED_STEP = "shares its step function with the audited /commit route; the preview branch writes and records nothing";

const OUTSIDE_THE_BOUNDARY: Readonly<Record<string, string>> = {
  "PATCH /sequences/:code": CONFIG_TRANSACTOR,
  "POST /sequences/:code/counter": CONFIG_TRANSACTOR,
  "POST /gl/opening-balance-duplicates/:kind/:partyId/repair": CONFIG_TRANSACTOR,
  "POST /pos/terminals": CONFIG_TRANSACTOR,
  "PUT /pos/terminals/:id": CONFIG_TRANSACTOR,
  "PUT /pos/settings": CONFIG_TRANSACTOR,
  "POST /hr/attendance/import/preview": PREVIEW_OF_A_SHARED_STEP,
  "POST /data-migration/treasury-accounts/preview": PREVIEW_OF_A_SHARED_STEP,
  "POST /data-migration/suppliers/preview": PREVIEW_OF_A_SHARED_STEP,
  "POST /data-migration/customers/preview": PREVIEW_OF_A_SHARED_STEP,
  "POST /data-migration/items/preview": PREVIEW_OF_A_SHARED_STEP,
  "POST /data-migration/item-units/preview": PREVIEW_OF_A_SHARED_STEP,
  "POST /data-migration/chart-of-accounts/preview": PREVIEW_OF_A_SHARED_STEP,
  "POST /audit/evidence-packs": "builds and streams a zip from files on disk, so it holds no transaction; the pack row and its event run together in deps.audit.atomic",
};

const NOT_ROUTE_REACHED: Readonly<Record<string, string>> = {
  "packages/backend/src/pos/master.ts:36": "injected into the POS settings routes as deps.ensureWalkInCustomer; it writes inside its own withSqliteTransaction",
  "packages/backend/src/create-backend.ts:4710": "the start-up backfill that links pre-#120 treasury accounts to a ledger leaf, run as system inside its own db.transaction, never from a route",
  "packages/backend/src/create-backend.ts:4721": "the same start-up backfill's treasury audit event, in the same db.transaction",
  "packages/backend/src/enh/e3-06.ts:189": "runs from the event bus when a quote is accepted, never from a route; the opportunity write and its event share deps.audit.atomic",
};

describe("every route-layer audit call site sits behind an audit boundary", () => {
  let backend: BackendHandle;
  let scanned: StaticScan;
  let paths: Map<number, string[]>;
  let reachedFrom: (registration: Registration) => Set<string>;

  beforeAll(async () => {
    backend = await createBackend({ dbPath: ":memory:", integrations: { tenantCode: "audit-call-sites" } });
    scanned = scan([...sourceFiles(API_SRC), ...sourceFiles(here)]);
    paths = mountedPaths(scanned);
    reachedFrom = (registration) => closure([`route:${registration.id}`], (name) => scanned.references.get(name) ?? []);
  });
  afterAll(() => backend.close());

  const mounted = () => scanned.registrations.filter((registration) => paths.has(registration.id));
  const audits = (registration: Registration) => reachedFrom(registration).has(WRITER);
  const keysOf = (registration: Registration) => (paths.get(registration.id) ?? []).map((full) => `${registration.method} ${full}`);

  it("finds the call sites and the routes it is meant to guard", () => {
    expect(scanned.sites.length).toBeGreaterThan(50);
    expect(mounted().filter(audits).length).toBeGreaterThan(50);
  });

  it("resolves each audited route to a path the running backend really serves", () => {
    const served = new Set(backend.app.routes.map((route) => `${route.method} ${route.path.length > 1 ? route.path.replace(/\/$/, "") : route.path}`));
    const unknown = mounted().filter(audits).flatMap(keysOf).filter((key) => !served.has(key));
    expect(unknown).toEqual([]);
  });

  it("mounts every mutating route that records an audit event under AUDITED_MOUNTS", () => {
    const uncovered = mounted()
      .filter((registration) => MUTATING.has(registration.method) && audits(registration))
      .flatMap(keysOf)
      .filter((key) => !insideABoundary(key.slice(key.indexOf(" ") + 1)) && !(key in OUTSIDE_THE_BOUNDARY));
    expect([...new Set(uncovered)]).toEqual([]);
  });

  it("reaches every call site from a route this backend mounts", () => {
    const reached = closure(
      mounted().map((registration) => `route:${registration.id}`),
      (name) => scanned.references.get(name) ?? [],
    );
    const unreached = scanned.sites
      .filter((site) => (site.owner ? !reached.has(site.owner) : site.registration === null || !paths.has(site.registration)))
      .map((site) => site.where)
      .filter((where) => !(where in NOT_ROUTE_REACHED));
    expect(unreached).toEqual([]);
  });

  it("keeps no stale exemption", () => {
    const live = new Set(mounted().filter((registration) => MUTATING.has(registration.method) && audits(registration)).flatMap(keysOf));
    const sites = new Set(scanned.sites.map((site) => site.where));
    expect(Object.keys(OUTSIDE_THE_BOUNDARY).filter((key) => !live.has(key))).toEqual([]);
    expect(Object.keys(NOT_ROUTE_REACHED).filter((where) => !sites.has(where))).toEqual([]);
  });
});
