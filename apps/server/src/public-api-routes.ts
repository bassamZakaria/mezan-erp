import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { IDEMPOTENT_REPLAY_HEADER, IdempotencyRefusal, readSessionToken } from "@mezan/api";
import type { ApiKeyAuthentication, PlatformHandle } from "@mezan/backend";
import {
  ApiKeyScopeDTO,
  IDEMPOTENCY_KEY_MAX,
  PUBLIC_API_BASE_PATH,
  PUBLIC_API_IDEMPOTENCY_HEADER,
  PublicApiRefusal,
  createCustomerSchema,
} from "@mezan/contracts";
import { PUBLIC_API_RATE_LIMIT_PER_MINUTE, hasModule, looksLikeApiKeyToken, parseApiKeyToken, tenantIsServed, type Tenant } from "@mezan/domain";
import { callerSource, type CloudSource } from "./client-source.js";
import { platformRateLimiter, type RateLimiter } from "./rate-limit.js";
import type { TenantDoor, TenantRouter } from "./tenant-router.js";
import { publicApiOpenApiDocument } from "./public-api-openapi.js";
import { annotateRequest, createLogger } from "@mezan/api";

const log = createLogger("api-v1");

const INTEGRATIONS_MODULE = "integrations";
const MINUTE_MS = 60_000;
const REFUSED_PER_MINUTE = 30;
const INTERNAL_ORIGIN = "http://tenant.internal";
const JSON_TYPE = "application/json; charset=UTF-8";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const RECEIPT_TYPE = "customer_collection";
const PAYMENT_TYPE = "supplier_payment";

const MESSAGES: Readonly<Record<PublicApiRefusal, string>> = {
  [PublicApiRefusal.Unauthenticated]: "مفتاح API مفقود أو غير صالح أو منتهٍ أو مُلغى.",
  [PublicApiRefusal.KeyNotAcceptedHere]: "مفاتيح API تُقبل على مسارات /api/v1 فقط.",
  [PublicApiRefusal.InsufficientScope]: "نطاق هذا المفتاح لا يشمل هذا الطلب.",
  [PublicApiRefusal.ModuleNotLicensed]: "وحدة التكامل وواجهة البرمجة غير مفعّلة في اشتراك المنشأة.",
  [PublicApiRefusal.RateLimited]: "تجاوزت حد الطلبات المسموح لهذا المفتاح؛ أعد المحاولة لاحقاً.",
  [PublicApiRefusal.NotFound]: "المسار أو السجل غير موجود.",
  [PublicApiRefusal.IdempotencyKeyInvalid]: "مفتاح عدم التكرار غير صالح.",
  [PublicApiRefusal.IdempotencyInFlight]: "طلب آخر بنفس مفتاح عدم التكرار ما زال قيد التنفيذ.",
  [PublicApiRefusal.ValidationError]: "البيانات المرسلة غير صالحة.",
};

const EN_MESSAGES: Readonly<Record<PublicApiRefusal, string>> = {
  [PublicApiRefusal.Unauthenticated]: "The API key is missing, malformed, unknown, expired or revoked.",
  [PublicApiRefusal.KeyNotAcceptedHere]: "API keys are accepted on /api/v1 only.",
  [PublicApiRefusal.InsufficientScope]: "This key's scopes do not cover this request.",
  [PublicApiRefusal.ModuleNotLicensed]: "The integrations module is not part of this company's subscription.",
  [PublicApiRefusal.RateLimited]: "Too many requests on this key; retry later.",
  [PublicApiRefusal.NotFound]: "No such route or record.",
  [PublicApiRefusal.IdempotencyKeyInvalid]: "The Idempotency-Key header is not valid.",
  [PublicApiRefusal.IdempotencyInFlight]: "A request with this Idempotency-Key is still in flight.",
  [PublicApiRefusal.ValidationError]: "The request body is not valid.",
};

function refuse(c: Context, error: PublicApiRefusal, status: 400 | 401 | 403 | 404 | 409 | 422 | 429, extra: Record<string, unknown> = {}) {
  return c.json({ error, message: MESSAGES[error], messageEn: EN_MESSAGES[error], ...extra }, status);
}

interface Caller {
  readonly tenant: Tenant;
  readonly door: TenantDoor;
  readonly auth: ApiKeyAuthentication;
  readonly source: CloudSource;
}

declare module "hono" {
  interface ContextVariableMap {
    publicApiCaller?: Caller;
  }
}

function callerOf(c: Context): Caller {
  const caller = c.get("publicApiCaller");
  if (!caller) throw new Error("publicApiCaller read on a route that is not behind the API-key gate");
  return caller;
}

/** SECURITY: a key is a credential for `/api/v1` and nothing else — never a session elsewhere. */
export function refuseApiKeysOutsidePublicApi(): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === PUBLIC_API_BASE_PATH || path.startsWith(`${PUBLIC_API_BASE_PATH}/`)) return next();
    const token = readSessionToken(c);
    if (token !== null && looksLikeApiKeyToken(token)) return refuse(c, PublicApiRefusal.KeyNotAcceptedHere, 401);
    return next();
  };
}

export interface PublicApiDeps {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly publicUrl: string | null;
  readonly now?: () => Date;
  readonly keyLimiter?: RateLimiter;
  readonly refusedLimiter?: RateLimiter;
}

interface Forward {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: URLSearchParams;
  readonly body?: unknown;
}

const CUSTOMER_FIELDS = createCustomerSchema
  .pick({
    id: true,
    code: true,
    branchId: true,
    nameAr: true,
    nameEn: true,
    phone: true,
    email: true,
    contactPerson: true,
    taxNumber: true,
    category: true,
    notes: true,
    paymentTermsDays: true,
    currency: true,
    etaBuyerType: true,
    commercialRegistrationNumber: true,
    address: true,
    nationalId: true,
  })
  .partial({ id: true })
  .strict();

function hashBody(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// REQUIRED: the record id is derived from the Idempotency-Key, so two server instances racing the
// same key forward the same id and the backend's own duplicate-id refusal keeps one record.
function recordIdFor(seed: string): string {
  const hex = hashBody(seed);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export function createPublicApiRoutes(deps: PublicApiDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());
  const keyLimiter = deps.keyLimiter ?? platformRateLimiter(deps.platform, "api-v1-key", PUBLIC_API_RATE_LIMIT_PER_MINUTE, MINUTE_MS);
  const refusedLimiter = deps.refusedLimiter ?? platformRateLimiter(deps.platform, "api-v1-refused", REFUSED_PER_MINUTE, MINUTE_MS);
  const inFlight = new Set<string>();
  const onPlatform = <T>(work: () => T): Promise<T> => deps.platform.inTheTurn("public api", async () => work());

  app.get("/openapi.json", (c) => c.body(JSON.stringify(publicApiOpenApiDocument(deps.publicUrl)), 200, { "content-type": JSON_TYPE }));

  app.use("*", async (c, next) => {
    const source = callerSource(c);
    const wait = await onPlatform(() => refusedLimiter.retryAfter(source));
    if (wait > 0) {
      c.header("retry-after", String(wait));
      return refuse(c, PublicApiRefusal.RateLimited, 429);
    }
    const unauthenticated = async () => {
      await onPlatform(() => refusedLimiter.consume(source));
      c.header("www-authenticate", 'Bearer realm="mezan-api"');
      return refuse(c, PublicApiRefusal.Unauthenticated, 401);
    };
    const authorization = c.req.header("authorization") ?? "";
    const [scheme, raw] = authorization.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !raw) return unauthenticated();
    const parsed = parseApiKeyToken(raw);
    if (!parsed) return unauthenticated();
    const tenant = await deps.platform.stores.tenants.findByCode(parsed.tenantCode);
    if (!tenant || !tenantIsServed(tenant)) return unauthenticated();
    const door = await deps.router.callerDoor(tenant.code);
    const auth = door.integrations ? await door.integrations.authenticate(parsed, raw) : null;
    if (!auth) return unauthenticated();
    if (!hasModule(await deps.router.resolversFor(tenant.code).resolveEntitlements(), INTEGRATIONS_MODULE)) {
      return refuse(c, PublicApiRefusal.ModuleNotLicensed, 403);
    }
    const bucket = `${tenant.id}:${auth.keyId}`;
    const retry = await onPlatform(() => {
      const after = keyLimiter.retryAfter(bucket);
      if (after === 0) keyLimiter.consume(bucket);
      return after;
    });
    if (retry > 0) {
      c.header("retry-after", String(retry));
      return refuse(c, PublicApiRefusal.RateLimited, 429);
    }
    annotateRequest({ tenantId: tenant.id });
    c.set("publicApiCaller", { tenant, door, auth, source });
    await next();
  });

  function requireScope(scope: ApiKeyScopeDTO): MiddlewareHandler {
    return async (c, next) => {
      if (!callerOf(c).auth.scopes.includes(scope)) return refuse(c, PublicApiRefusal.InsufficientScope, 403, { scope });
      await next();
    };
  }

  async function forward(c: Context, target: Forward): Promise<{ status: number; body: unknown; text: string }> {
    const caller = callerOf(c);
    const url = new URL(target.path, INTERNAL_ORIGIN);
    if (target.query) url.search = target.query.toString();
    const body = target.body === undefined ? undefined : JSON.stringify(target.body);
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(body));
    }
    const answer = await caller.door.fetchAs(new Request(url, { method: target.method, headers, body }), caller.source, caller.auth.grant);
    const text = await answer.text();
    let parsed: unknown = null;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      parsed = { error: "INTERNAL", message: text };
    }
    return { status: answer.status, body: parsed, text };
  }

  function answer(c: Context, status: number, body: unknown, created = false): Response {
    const ok = status >= 200 && status < 300;
    const payload = ok ? { data: body } : body;
    return new Response(JSON.stringify(payload), { status: ok && created ? 201 : status, headers: { "content-type": JSON_TYPE } });
  }

  function queryOf(c: Context, forced: Record<string, string> = {}): URLSearchParams {
    const query = new URLSearchParams(new URL(c.req.url).search);
    for (const [key, value] of Object.entries(forced)) query.set(key, value);
    return query;
  }

  const read =
    (scope: ApiKeyScopeDTO, path: (c: Context) => string, forced: Record<string, string> = {}) =>
    [
      requireScope(scope),
      async (c: Context) => {
        const result = await forward(c, { method: "GET", path: path(c), query: queryOf(c, forced) });
        return answer(c, result.status, result.body);
      },
    ] as const;

  const byId = (base: string) => (c: Context) => `${base}/${encodeURIComponent(c.req.param("id") ?? "")}`;

  function voucherOfType(scope: ApiKeyScopeDTO, voucherType: string) {
    return [
      requireScope(scope),
      async (c: Context) => {
        const result = await forward(c, { method: "GET", path: byId("/vouchers")(c) });
        const matches = result.status === 200 && (result.body as { voucherType?: unknown } | null)?.voucherType === voucherType;
        if (result.status === 200 && !matches) return refuse(c, PublicApiRefusal.NotFound, 404);
        return answer(c, result.status, result.body);
      },
    ] as const;
  }

  async function idempotentWrite(c: Context, route: string, body: unknown, target: (body: unknown, id: string) => Forward): Promise<Response> {
    const caller = callerOf(c);
    const gateway = caller.door.integrations!;
    const key = c.req.header(PUBLIC_API_IDEMPOTENCY_HEADER) ?? null;
    if (key !== null && (key.length === 0 || key.length > IDEMPOTENCY_KEY_MAX || !IDEMPOTENCY_KEY_PATTERN.test(key))) {
      return refuse(c, PublicApiRefusal.IdempotencyKeyInvalid, 400);
    }
    const record = (status: number, replayed: boolean) =>
      gateway
        .recordWrite({ keyId: caller.auth.keyId, keyName: caller.auth.keyName, actor: caller.auth.grant.userId, method: c.req.method, path: `${PUBLIC_API_BASE_PATH}${route}`, status, idempotencyKey: key, replayed })
        .catch((err: unknown) => log.error({ err: err }, "the write could not be audited"));
    const run = async () => {
      const result = await forward(c, target(body, key === null ? randomUUID() : recordIdFor(`${caller.tenant.id}:${caller.auth.keyId}:${route}:${key}`)));
      await record(result.status, false);
      return result;
    };
    if (key === null) {
      const result = await run();
      return answer(c, result.status, result.body, true);
    }
    const scope = `api_v1:${caller.auth.keyId}:${route}`;
    const lockKey = `${caller.tenant.id}:${scope}:${key}`;
    if (inFlight.has(lockKey)) return refuse(c, PublicApiRefusal.IdempotencyInFlight, 409);
    inFlight.add(lockKey);
    try {
      const requestHash = hashBody(JSON.stringify(body));
      const earlier = await gateway.findIdempotent(scope, key);
      if (earlier) {
        if (earlier.requestHash !== requestHash) {
          return c.json({ error: IdempotencyRefusal.KeyReused, message: "استُخدم مفتاح عدم التكرار هذا مع طلب مختلف.", messageEn: "This Idempotency-Key was used with a different request body." }, 422);
        }
        await record(earlier.status, true);
        const replay = answer(c, earlier.status, JSON.parse(earlier.body), true);
        replay.headers.set(IDEMPOTENT_REPLAY_HEADER, "true");
        return replay;
      }
      const result = await run();
      if (result.status < 500) await gateway.recordIdempotent(scope, key, { requestHash, status: result.status, body: JSON.stringify(result.body) });
      return answer(c, result.status, result.body, true);
    } finally {
      inFlight.delete(lockKey);
    }
  }

  async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
    const parsed: unknown = await c.req.json().catch(() => null);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  }

  app.get("/customers", ...read(ApiKeyScopeDTO.CustomersRead, () => "/customers"));
  app.get("/customers/:id", ...read(ApiKeyScopeDTO.CustomersRead, byId("/customers")));
  app.post("/customers", requireScope(ApiKeyScopeDTO.CustomersWrite), async (c) => {
    const raw = await jsonBody(c);
    const parsed = CUSTOMER_FIELDS.safeParse(raw);
    if (!parsed.success) return refuse(c, PublicApiRefusal.ValidationError, 400, { details: parsed.error.flatten() });
    return idempotentWrite(c, "/customers", parsed.data, (body, id) => ({ method: "POST", path: "/customers", body: { id, ...(body as object) } }));
  });

  app.get("/suppliers", ...read(ApiKeyScopeDTO.SuppliersRead, () => "/suppliers"));
  app.get("/suppliers/:id", ...read(ApiKeyScopeDTO.SuppliersRead, byId("/suppliers")));
  app.get("/items", ...read(ApiKeyScopeDTO.ItemsRead, () => "/items"));
  app.get("/items/:id", ...read(ApiKeyScopeDTO.ItemsRead, byId("/items")));
  app.get("/stock", ...read(ApiKeyScopeDTO.StockRead, () => "/inventory/stock-balance"));

  app.get("/sales-invoices", ...read(ApiKeyScopeDTO.SalesInvoicesRead, () => "/sales-invoices"));
  app.get("/sales-invoices/:id", ...read(ApiKeyScopeDTO.SalesInvoicesRead, byId("/sales-invoices")));
  app.post("/sales-invoices", requireScope(ApiKeyScopeDTO.SalesInvoicesWrite), async (c) => {
    const raw = await jsonBody(c);
    if (!raw) return refuse(c, PublicApiRefusal.ValidationError, 400);
    return idempotentWrite(c, "/sales-invoices", raw, (body, id) => ({ method: "POST", path: "/sales-invoices", body: { id, ...(body as object) } }));
  });

  app.get("/receipts", ...read(ApiKeyScopeDTO.ReceiptsRead, () => "/vouchers", { type: RECEIPT_TYPE }));
  app.get("/receipts/:id", ...voucherOfType(ApiKeyScopeDTO.ReceiptsRead, RECEIPT_TYPE));
  app.post("/receipts", requireScope(ApiKeyScopeDTO.ReceiptsWrite), async (c) => {
    const raw = await jsonBody(c);
    if (!raw || typeof raw.customerId !== "string" || raw.customerId === "") {
      return refuse(c, PublicApiRefusal.ValidationError, 400, { field: "customerId" });
    }
    const { voucherType: _ignored, supplierId: _supplier, counterTreasuryAccountId: _counter, counterTreasuryGlAccountId: _counterGl, ...rest } = raw;
    return idempotentWrite(c, "/receipts", rest, (body, id) => ({ method: "POST", path: "/vouchers", body: { id, ...(body as object), voucherType: RECEIPT_TYPE } }));
  });

  app.get("/payments", ...read(ApiKeyScopeDTO.PaymentsRead, () => "/vouchers", { type: PAYMENT_TYPE }));
  app.get("/payments/:id", ...voucherOfType(ApiKeyScopeDTO.PaymentsRead, PAYMENT_TYPE));

  app.get("/trial-balance", ...read(ApiKeyScopeDTO.TrialBalanceRead, () => "/financial-reports/trial-balance"));

  app.all("*", (c) => refuse(c, PublicApiRefusal.NotFound, 404));

  return app;
}
