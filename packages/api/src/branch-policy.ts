import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { METHOD_NAME_ALL } from "hono/router";
import { ALL_SCOPE, can, type AuthContext } from "@mezan/domain";
import type { AuthContextResolver } from "./permission-gate.js";

import {
  BODY_REFERENCE_KEYS,
  BRANCH_POLICY_TABLE,
  BRANCH_REFUSALS,
  BranchAccess,
  BranchPolicy,
  BranchRecordKind,
  BranchRefusalCode,
  ScopedReads,
  VIEW_UNATTRIBUTED_PERMISSION,
  type BranchDirectory,
  type BranchPolicyEntry,
  type BranchRefusalBody,
} from "@mezan/contracts";

export {
  BODY_REFERENCE_KEYS,
  BRANCH_POLICY_TABLE,
  BRANCH_REFUSALS,
  BranchAccess,
  BranchPolicy,
  BranchRecordKind,
  BranchRefusalCode,
  ScopedReads,
  VIEW_UNATTRIBUTED_PERMISSION,
  type BranchDirectory,
  type BranchPolicyEntry,
  type BranchRefusalBody,
};

const K = BranchRecordKind;

export const TREASURY_HOLDER_KEYS: ReadonlySet<string> = new Set(["treasuryAccountId", "drawerTreasuryAccountId"]);
const RESTRICTED_TREASURY_HOLDER_KEYS: ReadonlySet<string> = new Set([...TREASURY_HOLDER_KEYS, "bankTreasuryAccountId"]);

const DOCUMENT_BRANCH_KEYS: ReadonlySet<string> = new Set(["branchId", "warehouseId", "sourceWarehouseId", "destinationWarehouseId", "fromWarehouseId"]);

/**
 * SECURITY: keys that name one kind of record on every route. An id under one
 * of them that nothing holds answers exactly as an id another branch holds, so
 * the refusal does not say which it was. A key that means different records on
 * different routes (`runId`, `templateId`, `planId`, `orderId`, `docId`) is not
 * here: the directory cannot tell "absent" from "not the kind I look up".
 */
const SOLE_MEANING_KEYS: ReadonlySet<string> = new Set([
  "receiptId",
  "purchaseOrderId",
  "quoteId",
  "invoiceId",
  "sourceInvoiceId",
  "voucherId",
  "chequeId",
  "statementId",
  "rfqId",
  "vanId",
  "tripId",
  "terminalId",
  "assetId",
  "workOrderId",
  "opportunityId",
  "relatedOpportunityId",
  "installmentPlanId",
]);

const NAMED_LOCATION_KINDS: ReadonlySet<BranchRecordKind> = new Set([K.Branch, K.Warehouse, K.TreasuryAccount]);
const QUERY_BRANCH_KEYS = ["branchId", "branchIds", "branch"] as const;
const UNATTRIBUTED_QUERY_VALUE = "__unattributed__";
const BODY_SCAN_DEPTH = 6;

const REFUSAL_STATUS: Readonly<Record<BranchRefusalCode, 400 | 403 | 404 | 422>> = {
  [BranchRefusalCode.NotFound]: 404,
  [BranchRefusalCode.BranchOutOfScope]: 403,
  [BranchRefusalCode.CompanyWideOnly]: 403,
  [BranchRefusalCode.PolicyUndeclared]: 403,
  [BranchRefusalCode.BranchRequired]: 400,
  [BranchRefusalCode.TreasuryBranchMismatch]: 403,
  [BranchRefusalCode.WarehouseBranchMismatch]: 422,
  [BranchRefusalCode.SharedFieldRestricted]: 403,
  [BranchRefusalCode.WarehouseOutOfScope]: 403,
};

export function branchRefusal(c: Context, code: BranchRefusalCode): Response {
  return c.json(BRANCH_REFUSALS[code], REFUSAL_STATUS[code]);
}

export function branchPolicyFor(routePath: string, table: readonly BranchPolicyEntry[] = BRANCH_POLICY_TABLE): BranchPolicyEntry | undefined {
  let best: BranchPolicyEntry | undefined;
  for (const entry of table) {
    const matches = routePath === entry.prefix || routePath.startsWith(`${entry.prefix}/`);
    if (matches && (!best || entry.prefix.length > best.prefix.length)) best = entry;
  }
  return best;
}

function subPathListed(entry: BranchPolicyEntry, routePath: string, list: readonly string[] | undefined, method?: string): boolean {
  if (!list) return false;
  const rest = routePath.slice(entry.prefix.length);
  return list.some((listed) => {
    const [first, second] = listed.split(" ");
    const sub = second ?? first!;
    if (second !== undefined && first !== method) return false;
    return rest === sub || (second === undefined && rest.startsWith(`${sub}/`));
  });
}

export function paramNamesOf(routePath: string): string[] {
  return routePath
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1).replace(/[{?].*$/, ""));
}

export function undeclaredPolicyOf(routePath: string, table: readonly BranchPolicyEntry[] = BRANCH_POLICY_TABLE): string | null {
  const entry = branchPolicyFor(routePath, table);
  if (!entry) return "no branch policy declared";
  if (entry.policy !== BranchPolicy.Scoped || subPathListed(entry, routePath, entry.companyWide)) return null;
  const missing = paramNamesOf(routePath).filter((name) => entry.params?.[name] === undefined);
  return missing.length > 0 ? `scoped route has no stored-branch resolver for :${missing.join(", :")}` : null;
}

function terminalRoutePathOf(c: Context): string | undefined {
  // The FIRST concrete match is the handler that answers: `/receipts/stats`
  // also matches a later `/receipts/:id`, and reading that one would resolve
  // "stats" as a document id.
  // A wildcard path registered for ANY method is middleware. One registered
  // for a method is a handler, and is judged like every other route — reading
  // it as middleware left a `/files/*` handler open to every session.
  return matchedRoutes(c).find((route) => !route.path.endsWith("*") || route.method !== METHOD_NAME_ALL)?.path;
}

function paramsOf(routePath: string, pathname: string): Record<string, string> {
  const pattern = routePath.split("/");
  const actual = pathname.split("/");
  const params: Record<string, string> = {};
  pattern.forEach((segment, index) => {
    if (!segment.startsWith(":")) return;
    const value = actual[index];
    if (value !== undefined && value !== "") params[segment.slice(1).replace(/[{?].*$/, "")] = decodeURIComponent(value);
  });
  return params;
}

export interface NamedReference {
  readonly key: string;
  readonly kind: BranchRecordKind;
  readonly id: string;
  readonly depth: number;
}

export function referencesNamedIn(value: unknown, depth = 0, found: NamedReference[] = []): NamedReference[] {
  if (depth > BODY_SCAN_DEPTH || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) referencesNamedIn(item, depth + 1, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const kind = BODY_REFERENCE_KEYS[key];
    const pluralKind = key.endsWith("Ids") ? BODY_REFERENCE_KEYS[`${key.slice(0, -1)}`] : undefined;
    if (typeof child === "string") {
      if (kind && child !== "") found.push({ key, kind, id: child, depth });
    } else if (pluralKind && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string" && id !== "") found.push({ key: key.slice(0, -1), kind: pluralKind, id, depth });
    } else {
      referencesNamedIn(child, depth + 1, found);
    }
  }
  return found;
}

const BRANCH_DIRECTORY_KEY = "branchDirectory" as const;
const GRANTED_WAREHOUSES_KEY = "grantedWarehouseIds" as const;
const BRANCH_SESSION_KEY = "branchSession" as const;

declare module "hono" {
  interface ContextVariableMap {
    branchDirectory?: BranchDirectory;
    grantedWarehouseIds?: readonly string[];
    branchSession?: Session;
  }
}

export function branchDirectoryOf(c: Context): BranchDirectory | undefined {
  return c.get(BRANCH_DIRECTORY_KEY);
}

export function grantedWarehouseIdsOf(c: Context): readonly string[] | undefined {
  return c.get(GRANTED_WAREHOUSES_KEY);
}

interface Session {
  readonly ctx: AuthContext;
  readonly grant: readonly string[];
  readonly seesUnattributed: boolean;
  readonly directory: BranchDirectory | undefined;
  readonly access: BranchAccess;
  readonly cache: Map<string, Promise<readonly (string | null)[] | null>>;
}

function lookup(session: Session, kind: BranchRecordKind, id: string): Promise<readonly (string | null)[] | null> {
  if (kind === K.Branch) return Promise.resolve([id]);
  const key = `${kind}\u0000${id}`;
  let pending = session.cache.get(key);
  if (!pending) {
    pending = Promise.resolve(session.directory ? session.directory.branchesOf(kind, id, session.access) : null);
    session.cache.set(key, pending);
  }
  return pending;
}

enum Standing {
  Granted = "granted",
  Unattributed = "unattributed",
  PartlyForeign = "partly_foreign",
  Foreign = "foreign",
  Absent = "absent",
}

function standingOf(session: Session, branches: readonly (string | null)[] | null): Standing {
  if (branches === null) return Standing.Absent;
  const attributed = branches.filter((id): id is string => typeof id === "string" && id !== "");
  if (attributed.length === 0) return Standing.Unattributed;
  const foreign = attributed.filter((id) => !session.grant.includes(id));
  if (foreign.length === 0) return Standing.Granted;
  return foreign.length === attributed.length ? Standing.Foreign : Standing.PartlyForeign;
}

function isRead(c: Context): boolean {
  return c.req.method === "GET" || c.req.method === "HEAD";
}

async function storedRecordRefusal(c: Context, session: Session, entry: BranchPolicyEntry, routePath: string): Promise<Response | null> {
  const params = paramsOf(routePath, new URL(c.req.url).pathname);
  const sharedData = entry.policy === BranchPolicy.MasterDataShared;
  if (sharedData && isRead(c)) return null;
  for (const [name, value] of Object.entries(params)) {
    const kind = entry.params?.[name];
    if (kind === null) continue;
    if (kind === undefined) {
      if (sharedData) continue;
      return branchRefusal(c, BranchRefusalCode.PolicyUndeclared);
    }
    const standing = standingOf(session, await lookup(session, kind, value));
    if (standing === Standing.Granted) continue;
    if (standing === Standing.Unattributed && entry.unownedIsCompanys) {
      if (isRead(c)) continue;
      return branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
    }
    if (standing === Standing.Unattributed && (sharedData || session.seesUnattributed)) continue;
    if (standing === Standing.Absent && sharedData) continue;
    if (standing === Standing.PartlyForeign) {
      if (isRead(c)) continue;
      return branchRefusal(c, BranchRefusalCode.BranchOutOfScope);
    }
    return branchRefusal(c, BranchRefusalCode.NotFound);
  }
  return null;
}

async function readJsonBody(c: Context): Promise<unknown> {
  // SECURITY: read whatever the declared content type. Every route parses its
  // body with `c.req.json()`, which ignores the header — so trusting the
  // header here let `content-type: text/plain` carry a foreign branch past.
  try {
    return JSON.parse(await c.req.text());
  } catch {
    return undefined;
  }
}

/**
 * INVARIANT: every write by a branch-restricted session passes through here,
 * so a body that NAMES another record — a source document, a warehouse, the
 * account the money is held in — is held to the grant by the record's stored
 * branch, on every route, including one added later.
 */
async function bodyRefusal(c: Context, session: Session, entry: BranchPolicyEntry, body: unknown): Promise<Response | null> {
  for (const reference of referencesNamedIn(body)) {
    const standing = standingOf(session, await lookup(session, reference.kind, reference.id));
    if (standing === Standing.Foreign || standing === Standing.PartlyForeign) {
      return branchRefusal(c, NAMED_LOCATION_KINDS.has(reference.kind) ? BranchRefusalCode.BranchOutOfScope : BranchRefusalCode.NotFound);
    }
    if (standing === Standing.Absent && SOLE_MEANING_KEYS.has(reference.key)) return branchRefusal(c, BranchRefusalCode.NotFound);
  }
  return null;
}

/**
 * For a session restricted to branches: money is not paid out of, or into, an
 * account held by a branch other than the document's, even one the session
 * also holds. An account no branch owns is the company's and serves every
 * branch. An unrestricted session is not held to this — head office pays a
 * branch's expense, banks a branch's collection and runs payroll centrally.
 */
async function treasuryMismatchRefusal(
  c: Context,
  resolve: (kind: BranchRecordKind, id: string) => Promise<readonly (string | null)[] | null>,
  holderKeys: ReadonlySet<string>,
  entry: BranchPolicyEntry | undefined,
  routePath: string,
  body: unknown,
): Promise<Response | null> {
  const references = referencesNamedIn(body);
  const holders = references.filter((reference) => holderKeys.has(reference.key));
  if (holders.length === 0) return null;
  const attributed = async (kind: BranchRecordKind, id: string) => ((await resolve(kind, id)) ?? []).filter((branch): branch is string => typeof branch === "string" && branch !== "");
  const documentBranches = new Set<string>();
  if (entry) {
    for (const [name, value] of Object.entries(paramsOf(routePath, new URL(c.req.url).pathname))) {
      const kind = entry.params?.[name];
      if (!kind || kind === K.TreasuryAccount) continue;
      for (const id of await attributed(kind, value)) documentBranches.add(id);
    }
  }
  if (documentBranches.size === 0) {
    for (const reference of references) {
      if (reference.depth === 0 && DOCUMENT_BRANCH_KEYS.has(reference.key)) for (const id of await attributed(reference.kind, reference.id)) documentBranches.add(id);
    }
  }
  if (documentBranches.size === 0) return null;
  for (const holder of holders) {
    const held = await attributed(holder.kind, holder.id);
    if (held.some((id) => !documentBranches.has(id))) return branchRefusal(c, BranchRefusalCode.TreasuryBranchMismatch);
  }
  return null;
}

const DOCUMENT_WAREHOUSE_KEY = "warehouseId";

/**
 * LEDGER INVARIANT, for every session: a document's warehouse belongs to the
 * document's branch. The journal is stamped with the branch and the stock
 * leaves the warehouse, so a pair that disagrees books one branch's sale
 * against another branch's stock.
 */
async function warehouseBranchRefusal(
  c: Context,
  resolve: (kind: BranchRecordKind, id: string) => Promise<readonly (string | null)[] | null>,
  entry: BranchPolicyEntry | undefined,
  body: unknown,
): Promise<Response | null> {
  if (entry?.movesBetweenWarehouses) return null;
  const disagrees = async (value: unknown, inherited: string | undefined, depth: number): Promise<boolean> => {
    if (depth > BODY_SCAN_DEPTH || value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) {
      for (const item of value) if (await disagrees(item, inherited, depth + 1)) return true;
      return false;
    }
    const record = value as Record<string, unknown>;
    const stated = record["branchId"];
    const branch = typeof stated === "string" && stated !== "" ? stated : inherited;
    const warehouse = record[DOCUMENT_WAREHOUSE_KEY];
    if (branch !== undefined && typeof warehouse === "string" && warehouse !== "") {
      const held = ((await resolve(K.Warehouse, warehouse)) ?? []).filter((id): id is string => typeof id === "string" && id !== "");
      if (held.some((id) => id !== branch)) return true;
    }
    for (const child of Object.values(record)) if (await disagrees(child, branch, depth + 1)) return true;
    return false;
  };
  return (await disagrees(body, undefined, 0)) ? branchRefusal(c, BranchRefusalCode.WarehouseBranchMismatch) : null;
}

/**
 * A create that names no branch lands in the session's only branch; a session
 * holding several must say which. Without this a branch user's document posted
 * unattributed and its own author then could not open it.
 */
function defaultBranchRefusal(c: Context, session: Session, entry: BranchPolicyEntry, routePath: string, body: unknown): Response | null {
  if (!entry.defaultsBranch && !entry.defaultsLineBranch) return null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const sole = session.grant.length === 1 ? session.grant[0]! : undefined;
  let defaulted: Record<string, unknown> | undefined;

  if (entry.defaultsLineBranch && Array.isArray(record["lines"])) {
    const lines = record["lines"] as unknown[];
    const needsBranch = (line: unknown): line is Record<string, unknown> => {
      if (line === null || typeof line !== "object") return false;
      const stated = (line as Record<string, unknown>)["branchId"];
      if (typeof stated === "string" && stated !== "") return false;
      return !(stated === null && session.seesUnattributed);
    };
    if (lines.some(needsBranch)) {
      if (!sole) return session.seesUnattributed ? null : branchRefusal(c, BranchRefusalCode.BranchRequired);
      defaulted = { ...record, lines: lines.map((line) => (needsBranch(line) ? { ...line, branchId: sole } : line)) };
    }
  } else if (entry.defaultsBranch && c.req.method === "POST" && paramNamesOf(routePath).length === 0) {
    const statesBranch = [...DOCUMENT_BRANCH_KEYS].some((key) => typeof record[key] === "string" && record[key] !== "");
    if (!statesBranch && !(record["branchId"] === null && session.seesUnattributed)) {
      if (!sole) return session.seesUnattributed ? null : branchRefusal(c, BranchRefusalCode.BranchRequired);
      defaulted = { ...record, branchId: sole };
    }
  }
  if (!defaulted) return null;
  // Hono keeps the body it already read as a promise under `bodyCache`; the
  // handler's `c.req.json()` is served from it, which is what makes the
  // defaulted branch the one the handler stores.
  const cache = c.req.bodyCache as Record<string, unknown>;
  delete cache["json"];
  cache["text"] = Promise.resolve(JSON.stringify(defaulted));
  return null;
}

/**
 * SECURITY, for every session granted only some warehouses: a write that
 * names a warehouse outside them is refused, on every route. Stock leaves the
 * warehouse a document names, so a draft raised on another one is a claim on
 * stock the session was never given.
 */
function warehouseGrantRefusal(c: Context, ctx: AuthContext, body: unknown): Response | null {
  const granted = ctx.warehouseGrant;
  if (granted === ALL_SCOPE) return null;
  const outside = referencesNamedIn(body).some((reference) => reference.kind === K.Warehouse && !granted.includes(reference.id));
  return outside ? branchRefusal(c, BranchRefusalCode.WarehouseOutOfScope) : null;
}

function companysRecordRefusal(c: Context, entry: BranchPolicyEntry, body: unknown): Response | null {
  if (!entry.unownedIsCompanys || body === null || typeof body !== "object" || Array.isArray(body)) return null;
  return (body as Record<string, unknown>)["branchId"] === null ? branchRefusal(c, BranchRefusalCode.CompanyWideOnly) : null;
}

async function queryRefusal(c: Context, session: Session, entry: BranchPolicyEntry): Promise<Response | null> {
  for (const key of QUERY_BRANCH_KEYS) {
    for (const raw of c.req.queries(key) ?? []) {
      for (const id of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
        if (id === "*" || id === "all") continue;
        if (id === UNATTRIBUTED_QUERY_VALUE) {
          if (!session.seesUnattributed) return branchRefusal(c, BranchRefusalCode.BranchOutOfScope);
          continue;
        }
        if (!session.grant.includes(id)) return branchRefusal(c, BranchRefusalCode.BranchOutOfScope);
      }
    }
  }
  for (const [key, kind] of Object.entries(entry.query ?? {})) {
    for (const id of c.req.queries(key) ?? []) {
      if (id === "") continue;
      const standing = standingOf(session, await lookup(session, kind, id));
      if (standing === Standing.Foreign || standing === Standing.PartlyForeign) return branchRefusal(c, BranchRefusalCode.BranchOutOfScope);
    }
  }
  return null;
}

/**
 * Whether a record is inside the caller's branch grant — for a handler that
 * counts or folds rows the middleware cannot see. True for an unrestricted
 * session.
 */
export async function recordInBranchGrant(c: Context, kind: BranchRecordKind, id: string): Promise<boolean> {
  const session = c.get(BRANCH_SESSION_KEY);
  if (!session) return true;
  const standing = standingOf(session, await lookup(session, kind, id));
  if (standing === Standing.Granted || standing === Standing.PartlyForeign) return true;
  return standing === Standing.Unattributed && session.seesUnattributed;
}

const UNSET_FIELD_VALUES: ReadonlySet<unknown> = new Set([undefined, null, "", false, 0]);
const DECIMAL = /^-?\d+(\.\d+)?$/;
const CREATED_ACTIVE: Readonly<Record<string, unknown>> = { active: true, status: "active" };

function sameFieldValue(stored: unknown, sent: unknown): boolean {
  if (typeof stored === "string" && typeof sent === "string" && DECIMAL.test(stored) && DECIMAL.test(sent)) {
    const scaled = (text: string) => {
      const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
      return (text.startsWith("-") ? -1n : 1n) * BigInt(whole + fraction.padEnd(6, "0").slice(0, 6));
    };
    return scaled(stored) === scaled(sent);
  }
  const unset = (value: unknown) => UNSET_FIELD_VALUES.has(value) || (typeof value === "string" && DECIMAL.test(value) && Number(value) === 0);
  if (unset(stored) && unset(sent)) return true;
  return JSON.stringify(stored) === JSON.stringify(sent);
}

/**
 * SECURITY: a branch-restricted session may create and edit shared master
 * data, but not the fields that apply to every branch — a credit limit, a
 * price list, payment terms, a cost, the accounts a sale posts to, whether the
 * record is active. `stored` is the record as it stands, or null on create;
 * a field the request sends unchanged is not a change.
 */
export function sharedFieldRefusal(c: Context, prefix: string, stored: Readonly<Record<string, unknown>> | null, sent: Readonly<Record<string, unknown>>): Response | null {
  if (!c.get(BRANCH_SESSION_KEY)) return null;
  const restricted = branchPolicyFor(prefix)?.restrictedFields ?? [];
  const fields = restricted.filter((field) => sent[field] !== undefined && !sameFieldValue(stored ? stored[field] : CREATED_ACTIVE[field], sent[field]));
  if (fields.length === 0) return null;
  return c.json({ ...BRANCH_REFUSALS[BranchRefusalCode.SharedFieldRestricted], fields }, 403);
}

export async function recordsInBranchGrant<Row>(c: Context, kind: BranchRecordKind, rows: readonly Row[], idOf: (row: Row) => string): Promise<readonly Row[]> {
  if (!c.get(BRANCH_SESSION_KEY)) return rows;
  const kept: Row[] = [];
  for (const row of rows) if (await recordInBranchGrant(c, kind, idOf(row))) kept.push(row);
  return kept;
}

async function rowVisible(session: Session, kind: BranchRecordKind, row: unknown, unownedIsCompanys: boolean): Promise<boolean> {
  if (row === null || typeof row !== "object") return true;
  const record = row as Record<string, unknown>;
  let branches: readonly (string | null)[] | null = typeof record["id"] === "string" ? await lookup(session, kind, record["id"]) : null;
  if (branches === null) {
    const named: (string | null)[] = [];
    for (const reference of referencesNamedIn(record)) named.push(...((await lookup(session, reference.kind, reference.id)) ?? []));
    branches = named;
  }
  const standing = standingOf(session, branches);
  if (standing === Standing.Granted || standing === Standing.PartlyForeign) return true;
  return standing === Standing.Unattributed && (unownedIsCompanys || session.seesUnattributed);
}

async function narrowRows(session: Session, kind: BranchRecordKind, rows: readonly unknown[], unownedIsCompanys: boolean): Promise<unknown[]> {
  const kept: unknown[] = [];
  for (const row of rows) if (await rowVisible(session, kind, row, unownedIsCompanys)) kept.push(row);
  return kept;
}

async function narrowListResponse(c: Context, session: Session, kind: BranchRecordKind, unownedIsCompanys: boolean): Promise<void> {
  const response = c.res;
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").includes("application/json")) return;
  const payload: unknown = await response.clone().json();
  let narrowed: unknown;
  if (Array.isArray(payload)) {
    narrowed = await narrowRows(session, kind, payload, unownedIsCompanys);
  } else if (payload !== null && typeof payload === "object") {
    const record = { ...(payload as Record<string, unknown>) };
    let sawRows = false;
    for (const [key, value] of Object.entries(record)) {
      if (!Array.isArray(value)) continue;
      sawRows = true;
      const kept = await narrowRows(session, kind, value, unownedIsCompanys);
      if (typeof record["total"] === "number" && record["total"] === value.length) record["total"] = kept.length;
      record[key] = kept;
    }
    if (!sawRows) {
      c.res = undefined as unknown as Response;
      c.res = branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
      return;
    }
    narrowed = record;
  } else {
    return;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  c.res = undefined as unknown as Response;
  c.res = new Response(JSON.stringify(narrowed), { status: 200, headers });
}

export interface BranchPolicyEnforcementOptions {
  readonly resolveAuthContext: AuthContextResolver;
  readonly directory?: BranchDirectory;
  readonly table?: readonly BranchPolicyEntry[];
}

/**
 * SECURITY INVARIANT — deny by default. Mounted once, above every route: a
 * session restricted to some branches reaches a route only through the policy
 * its family declares. The per-route permission gates run after this and know
 * nothing of it, which is the point — a route nobody wired is still closed.
 *
 * An unrestricted session is one with NO branch restriction; holding `"*"`
 * does not make a narrow grant wide.
 */
export function branchPolicyEnforcement(options: BranchPolicyEnforcementOptions): MiddlewareHandler {
  const table = options.table ?? BRANCH_POLICY_TABLE;
  return async function enforceBranchPolicy(c, next) {
    if (options.directory) c.set(BRANCH_DIRECTORY_KEY, options.directory);
    const routePath = terminalRoutePathOf(c);
    if (!routePath) return next();
    const ctx = await options.resolveAuthContext(c);
    if (!ctx.authenticated) return next();
    const directory = options.directory;
    if (ctx.branchGrant === ALL_SCOPE) {
      if (isRead(c)) return next();
      const body = await readJsonBody(c);
      const outsideWarehouses = warehouseGrantRefusal(c, ctx, body);
      if (outsideWarehouses) return outsideWarehouses;
      if (!directory) return next();
      const resolve = async (kind: BranchRecordKind, id: string) => (kind === K.Branch ? [id] : directory.branchesOf(kind, id, BranchAccess.Write));
      const mismatch = await warehouseBranchRefusal(c, resolve, branchPolicyFor(routePath, table), body);
      return mismatch ?? next();
    }

    const session: Session = {
      ctx,
      grant: ctx.branchGrant,
      seesUnattributed: can(ctx, VIEW_UNATTRIBUTED_PERMISSION),
      directory: options.directory,
      access: isRead(c) ? BranchAccess.Read : BranchAccess.Write,
      cache: new Map(),
    };
    c.set(BRANCH_SESSION_KEY, session);
    const branchByWarehouse = await c.get("warehouseBranches")?.();
    if (branchByWarehouse) {
      c.set(GRANTED_WAREHOUSES_KEY, [...branchByWarehouse].filter(([, branchId]) => session.grant.includes(branchId)).map(([id]) => id));
    }

    const entry = branchPolicyFor(routePath, table);
    if (!entry) return branchRefusal(c, BranchRefusalCode.PolicyUndeclared);
    if (entry.policy === BranchPolicy.CompanyWide || subPathListed(entry, routePath, entry.companyWide, c.req.method)) {
      return branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
    }
    if (entry.policy === BranchPolicy.Public || entry.policy === BranchPolicy.SelfOnly) return next();
    if (entry.policy === BranchPolicy.SharedReadOnly) {
      return isRead(c) || subPathListed(entry, routePath, entry.readPosts) ? next() : branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
    }

    const outsideQuery = await queryRefusal(c, session, entry);
    if (outsideQuery) return outsideQuery;
    const stored = await storedRecordRefusal(c, session, entry, routePath);
    if (stored) return stored;
    if (!isRead(c)) {
      const body = await readJsonBody(c);
      const refusal =
        warehouseGrantRefusal(c, ctx, body) ??
        companysRecordRefusal(c, entry, body) ??
        (await bodyRefusal(c, session, entry, body)) ??
        (await warehouseBranchRefusal(c, (kind, id) => lookup(session, kind, id), entry, body)) ??
        (await treasuryMismatchRefusal(c, (kind, id) => lookup(session, kind, id), RESTRICTED_TREASURY_HOLDER_KEYS, entry, routePath, body)) ??
        defaultBranchRefusal(c, session, entry, routePath, body);
      if (refusal) return refusal;
      return next();
    }
    if (entry.policy !== BranchPolicy.Scoped || paramNamesOf(routePath).length > 0) return next();

    const reads = subPathListed(entry, routePath, entry.handlerNarrowed) ? ScopedReads.HandlerNarrows : (entry.reads ?? ScopedReads.Refused);
    if (reads === ScopedReads.Refused) return branchRefusal(c, BranchRefusalCode.CompanyWideOnly);
    await next();
    if (reads === ScopedReads.Rows && entry.rows) await narrowListResponse(c, session, entry.rows, entry.unownedIsCompanys === true);
  };
}
