import { Hono, type Context } from "hono";
import {
  can,
  cardCheckoutAmount,
  createAuthContext,
  CardCheckoutUnavailableError,
  SubscriptionNotFoundError,
  TenantNotFoundError,
  PlanNotFoundError,
  type CardCheckout,
  type Tenant,
} from "@mezan/domain";
import { createCardCheckoutRequestSchema, type TenantBillingDTO } from "@mezan/contracts";
import { readSessionToken, type SessionGrant } from "@mezan/api";
import { serializeCardCheckout, type PlatformHandle } from "@mezan/backend";
import type { CardCheckoutService } from "./card-checkout.js";
import type { PaymobTestProvider } from "./paymob-provider.js";
import type { CloudEnv } from "./env.js";
import type { TenantRouter } from "./tenant-router.js";
import { resolveTenantCode } from "./tenant-resolver.js";

export const PAYMOB_WEBHOOK_PATH = "/api/billing/paymob/webhook";
const MAX_WEBHOOK_BYTES = 256 * 1024;

export function forwardedOrigin(request: Request, trustProxy: boolean): string {
  const url = new URL(request.url);
  if (!trustProxy) return url.origin;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (!host) return url.origin;
  return `${proto === "https" || proto === "http" ? proto : url.protocol.replace(":", "")}://${host}`;
}

/**
 * The origin a browser is sent back to after the hosted checkout. Only the
 * configured public URL or one of this deployment's own tenant subdomains —
 * never a host the caller merely claims.
 */
export function trustedReturnOrigin(request: Request, env: CloudEnv): string {
  const publicUrl = env.paymob.mode === "off" ? undefined : env.paymob.publicUrl;
  if (env.tenantDomain && publicUrl) {
    const raw = (env.trustProxy ? request.headers.get("x-forwarded-host") : null) ?? request.headers.get("host") ?? "";
    const host = raw.split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
    const domain = env.tenantDomain.toLowerCase();
    if (host.endsWith(`.${domain}`) && !host.slice(0, -(domain.length + 1)).includes(".")) {
      return `${new URL(publicUrl).protocol}//${host}`;
    }
  }
  return publicUrl ?? forwardedOrigin(request, env.trustProxy);
}

export function notificationUrl(request: Request, env: CloudEnv): string {
  const publicUrl = env.paymob.mode === "off" ? undefined : env.paymob.publicUrl;
  return `${publicUrl ?? forwardedOrigin(request, env.trustProxy)}${PAYMOB_WEBHOOK_PATH}`;
}

/** Mounted ABOVE the demo basic-auth and the origin-secret gate: Paymob carries neither. The HMAC is the only credential. */
export function createPaymobWebhookRoutes(service: CardCheckoutService): Hono {
  const app = new Hono();
  app.post("/", async (c) => {
    const declared = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return c.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    const raw = await c.req.text();
    if (raw.length > MAX_WEBHOOK_BYTES) return c.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    const result = await service.handleWebhook(raw, c.req.query("hmac") ?? "");
    if (result.status === "rejected") return c.json({ error: "INVALID_SIGNATURE" }, 401);
    if (result.status === "retry") return c.json({ error: "RETRY" }, 503);
    return c.json({ received: true });
  });
  return app;
}

interface Caller {
  readonly tenant: Tenant;
  readonly grant: SessionGrant;
}

function allowed(grant: SessionGrant, permission: string): boolean {
  return can(
    createAuthContext({
      userId: grant.userId,
      permissions: [...grant.permissions],
      branchScope: grant.branchScope,
      warehouseScope: grant.warehouseScope,
    }),
    permission,
  );
}

function unavailable(c: Context, err: unknown): Response {
  if (err instanceof CardCheckoutUnavailableError) return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  if (err instanceof SubscriptionNotFoundError || err instanceof TenantNotFoundError || err instanceof PlanNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof Error && (err as { code?: unknown }).code === "PAYMENT_PROVIDER_ERROR") {
    console.error(err);
    return c.json({ error: "PAYMENT_PROVIDER_ERROR", message: "تعذّر الاتصال بمزوّد الدفع، حاول مرة أخرى", messageEn: "The payment provider could not be reached; try again" }, 502);
  }
  throw err;
}

export interface TenantBillingRoutesOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly env: CloudEnv;
  readonly service: CardCheckoutService | null;
}

/**
 * The tenant admin's own door to renewal, under `/api/billing` in front of the
 * tenant router. The caller is resolved from the tenant backend's own session
 * registry, so the tenant is whichever one issued the token — never a header
 * naming another tenant with a borrowed token.
 */
export function createTenantBillingRoutes(options: TenantBillingRoutesOptions): Hono {
  const { platform, router, env, service } = options;
  const app = new Hono();

  async function resolveCaller(c: Context): Promise<Caller | Response> {
    const code = resolveTenantCode(c.req.raw, { tenantDomain: env.tenantDomain, trustForwardedHost: env.trustProxy, allowTenantHeader: true });
    if (!code) return c.json({ error: "TENANT_REQUIRED", message: "حدّد رمز المنشأة" }, 400);
    const tenant = await platform.stores.tenants.findByCode(code);
    if (!tenant || tenant.status === "archived" || tenant.status === "provisioning") {
      return c.json({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" }, 404);
    }
    const token = readSessionToken(c);
    if (!token) return c.json({ error: "UNAUTHENTICATED", message: "سجّل الدخول أولًا" }, 401);
    const backend = await router.backendFor(code);
    // Must look the token up with the same origin the tenant backend saw at
    // login. The tenant router forwards `backend.app.fetch(request)` without
    // the socket env, so every tenant session is bound to the null origin; a
    // mismatched lookup here would not just fail, it would REVOKE the session.
    const grant = backend.sessions.find(token, null);
    if (!grant) return c.json({ error: "UNAUTHENTICATED", message: "انتهت الجلسة، سجّل الدخول مرة أخرى" }, 401);
    return { tenant, grant };
  }

  const forbidden = (c: Context) => c.json({ error: "FORBIDDEN", message: "ليست لديك صلاحية إدارة الاشتراك" }, 403);

  app.get("/subscription", async (c) => {
    const caller = await resolveCaller(c);
    if (caller instanceof Response) return caller;
    if (!allowed(caller.grant, "admin.settings.view")) return forbidden(c);
    const subscription = await platform.stores.subscriptions.findLiveByTenant(caller.tenant.id);
    const plan = subscription ? await platform.stores.plans.findById(subscription.planId) : null;
    let renewable = false;
    let amountDue: string | null = null;
    if (subscription && plan) {
      try {
        amountDue = cardCheckoutAmount(plan, subscription).toString();
        renewable = true;
      } catch {
        amountDue = (subscription.billingCycle === "yearly" ? plan.priceYearly : plan.priceMonthly).toString();
      }
    }
    const checkouts: CardCheckout[] = service ? (await service.listByTenant(caller.tenant.id)).slice(0, 10) : [];
    const body: TenantBillingDTO = {
      cardCheckout: service !== null,
      testMode: service?.provider.testMode ?? false,
      canRenew: service !== null && renewable && allowed(caller.grant, "admin.settings.edit"),
      subscription:
        subscription && plan && amountDue !== null
          ? {
              status: subscription.status,
              billingCycle: subscription.billingCycle,
              currentPeriodEnd: subscription.currentPeriodEnd,
              planNameAr: plan.nameAr,
              planNameEn: plan.nameEn,
              amountDue,
            }
          : null,
      checkouts: checkouts.map(serializeCardCheckout),
    };
    return c.json(body);
  });

  app.post("/checkout", async (c) => {
    const caller = await resolveCaller(c);
    if (caller instanceof Response) return caller;
    if (!allowed(caller.grant, "admin.settings.edit")) return forbidden(c);
    if (!service) {
      return c.json({ error: "CARD_CHECKOUT_NOT_CONFIGURED", message: "الدفع بالبطاقة غير مُفعّل على هذا الخادم", messageEn: "Card checkout is not configured on this server" }, 503);
    }
    const parsed = createCardCheckoutRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const origin = trustedReturnOrigin(c.req.raw, env);
    try {
      const checkout = await service.open({
        tenantId: caller.tenant.id,
        requestedBy: `tenant:${caller.tenant.code}:${caller.grant.userId}`,
        returnUrl: (id) => `${origin}${parsed.data.returnPath}?checkout=${encodeURIComponent(id)}`,
        notificationUrl: notificationUrl(c.req.raw, env),
      });
      return c.json(serializeCardCheckout(checkout), 201);
    } catch (err) {
      return unavailable(c, err);
    }
  });

  app.get("/checkouts/:id", async (c) => {
    const caller = await resolveCaller(c);
    if (caller instanceof Response) return caller;
    if (!allowed(caller.grant, "admin.settings.view")) return forbidden(c);
    const checkout = service ? await service.find(c.req.param("id")) : null;
    if (!checkout || checkout.tenantId !== caller.tenant.id) return c.json({ error: "NOT_FOUND", message: "عملية الدفع غير موجودة" }, 404);
    return c.json(serializeCardCheckout(checkout));
  });

  return app;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function testCheckoutPage(checkout: CardCheckout, tenantCode: string): string {
  const id = escapeHtml(checkout.id);
  const amount = escapeHtml(checkout.amount.toString().replace(/0{1,4}$/, ""));
  const open = checkout.status === "pending" || checkout.status === "failed";
  const statusLine = open ? "" : `<p class="state">الحالة: ${escapeHtml(checkout.status)} — Status: ${escapeHtml(checkout.status)}</p>`;
  const actions = open
    ? `<form method="post" action="/billing/test-checkout/${id}/complete">
        <input type="hidden" name="outcome" value="success">
        <button class="ok" type="submit">محاكاة دفع ناجح — Simulate success</button>
      </form>
      <form method="post" action="/billing/test-checkout/${id}/complete">
        <input type="hidden" name="outcome" value="failure">
        <button class="bad" type="submit">محاكاة رفض البطاقة — Simulate decline</button>
      </form>`
    : "";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>وضع الاختبار — Test checkout</title>
<style>
  :root { color-scheme: light dark; --bg:#f8fafc; --card:#ffffff; --ink:#1e293b; --muted:#64748b; --warn:#b45309; --warn-bg:#fef3c7; --brand:#003ce1; --bad:#b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f172a; --card:#1e293b; --ink:#e2e8f0; --muted:#94a3b8; --warn:#fcd34d; --warn-bg:#451a03; --bad:#f87171; } }
  body { margin:0; background:var(--bg); color:var(--ink); font-family: system-ui, "Segoe UI", Tahoma, sans-serif; }
  main { max-width:460px; margin:40px auto; padding:0 16px; }
  .banner { background:var(--warn-bg); color:var(--warn); border:2px dashed var(--warn); border-radius:10px; padding:12px 14px; font-weight:700; text-align:center; }
  .card { background:var(--card); border-radius:12px; padding:20px; margin-top:16px; box-shadow:0 1px 3px rgba(0,0,0,.12); }
  .amount { font-size:28px; font-weight:800; direction:ltr; text-align:center; margin:10px 0; }
  .meta { color:var(--muted); font-size:13px; text-align:center; direction:ltr; }
  .state { text-align:center; font-weight:700; }
  form { margin-top:12px; }
  button { width:100%; min-height:44px; border:0; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer; color:#fff; }
  .ok { background:var(--brand); } .bad { background:var(--bad); }
</style>
</head>
<body>
<main>
  <div class="banner">وضع الاختبار — لن تُخصم أي أموال<br>TEST MODE — no card is charged</div>
  <div class="card">
    <h1 style="font-size:17px;margin:0;text-align:center">دفع اشتراك مزان — Mezan subscription</h1>
    <div class="amount">${amount} EGP</div>
    <div class="meta">${escapeHtml(tenantCode)} · ${id}</div>
    ${statusLine}
    ${actions}
  </div>
</main>
</body>
</html>`;
}

/**
 * The fake hosted checkout, mounted only when the test double is active. Its
 * buttons do not mark anything paid themselves: they sign a Paymob-shaped
 * callback with the test secret and run it through the same webhook handler.
 */
export function createTestCheckoutRoutes(options: {
  readonly platform: PlatformHandle;
  readonly service: CardCheckoutService;
  readonly provider: PaymobTestProvider;
}): Hono {
  const { platform, service, provider } = options;
  const app = new Hono();

  app.get("/:id", async (c) => {
    const checkout = await service.find(c.req.param("id"));
    if (!checkout || checkout.provider !== provider.id) return c.text("Not found", 404);
    const tenant = await platform.stores.tenants.findById(checkout.tenantId);
    return c.html(testCheckoutPage(checkout, tenant?.code ?? ""));
  });

  app.post("/:id/complete", async (c) => {
    const checkout = await service.find(c.req.param("id"));
    if (!checkout || checkout.provider !== provider.id) return c.text("Not found", 404);
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const outcome = form["outcome"] === "success" ? "success" : "failure";
    if (checkout.status === "pending" || checkout.status === "failed") {
      const { rawBody, signature } = provider.simulateCallback(checkout, outcome);
      await service.handleWebhook(rawBody, signature);
    }
    const back = provider.returnUrlFor(checkout.id);
    if (!back) return c.redirect(`/billing/test-checkout/${encodeURIComponent(checkout.id)}`, 303);
    const sep = back.includes("?") ? "&" : "?";
    return c.redirect(`${back}${sep}success=${outcome === "success" ? "true" : "false"}&pending=false`, 303);
  });

  return app;
}
