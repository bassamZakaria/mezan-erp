import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  can,
  cardCheckoutAmount,
  createAuthContext,
  CardCheckoutUnavailableError,
  isFreePlan,
  liveTrialModules,
  moduleName,
  MODULE_TRIAL_DAYS,
  ModuleTrialAlreadyUsedError,
  ModuleTrialUnavailableError,
  PlanKind,
  recordSecurityEvent,
  startModuleTrial,
  SubscriptionNotFoundError,
  SubscriptionTransition,
  TenantNotFoundError,
  PlanNotFoundError,
  CardCheckoutStatus,
  type CardCheckout,
  type ModuleTrial,
  type Plan,
  type Tenant,
} from "@mezan/domain";
import {
  createCardCheckoutRequestSchema,
  startModuleTrialRequestSchema,
  type BillingLimitDTO,
  type BillingModuleDTO,
  type BillingQuotaDTO,
  type TenantBillingDTO,
} from "@mezan/contracts";
import { readSessionToken, type SessionGrant } from "@mezan/api";
import { resolveTenantPlan, serializeCardCheckout, type PlatformHandle } from "@mezan/backend";
import { SettlementStatus, type CardCheckoutService } from "./card-checkout.js";
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
    if (result.status === SettlementStatus.Rejected) return c.json({ error: "INVALID_SIGNATURE" }, 401);
    if (result.status === SettlementStatus.Retry) return c.json({ error: "RETRY" }, 503);
    return c.json({ received: true });
  });
  return app;
}

interface Caller {
  readonly tenant: Tenant;
  readonly grant: SessionGrant;
  /** The caller's own bearer token, so the tenant-side usage read is made AS them. */
  readonly token: string;
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

interface PlanUsage {
  readonly today: string | null;
  readonly month: string | null;
  readonly quotas: readonly BillingQuotaDTO[];
  readonly limits: readonly BillingLimitDTO[];
}

/**
 * Days left on the TENANT's calendar, not on a UTC instant: a trial ending at
 * 21:00 UTC has a day left in Cairo, and a banner that said "0" would be
 * telling the owner they are out of time while they still are not.
 */
function trialDaysLeft(trialEndsAt: string | null | undefined, today: string | null): number | null {
  if (!trialEndsAt || !today) return null;
  const end = Date.parse(`${trialEndsAt.slice(0, 10)}T00:00:00Z`);
  const from = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(from)) return null;
  return Math.max(0, Math.round((end - from) / (24 * 60 * 60 * 1000)));
}

function moduleRows(
  plan: Plan,
  trials: readonly ModuleTrial[],
  everEntitled: readonly string[],
  nowIso: string,
): BillingModuleDTO[] {
  const live = new Set(liveTrialModules(trials, nowIso));
  const tried = new Set(trials.map((t) => t.module));
  const inPlan = new Set(plan.modules);
  const readable = new Set(everEntitled);
  const ids = [...new Set([...inPlan, ...tried, ...readable])].sort();
  return ids.map((id) => {
    const name = moduleName(id);
    const state: BillingModuleDTO["state"] = inPlan.has(id)
      ? "active"
      : live.has(id)
        ? "trialing"
        : readable.has(id) || tried.has(id)
          ? "read_only"
          : "locked";
    return {
      id,
      nameAr: name.ar,
      nameEn: name.en,
      state,
      trialEndsAt: trials.find((t) => t.module === id && live.has(id))?.endsAt ?? null,
      trialUsed: tried.has(id),
      canTrial: !inPlan.has(id) && !tried.has(id),
    };
  });
}

export interface TenantBillingRoutesOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly env: CloudEnv;
  readonly service: CardCheckoutService | null;
  readonly now?: () => Date;
}

/**
 * The tenant admin's own door to renewal, under `/api/billing` in front of the
 * tenant router. The caller is resolved from the tenant backend's own session
 * registry, so the tenant is whichever one issued the token — never a header
 * naming another tenant with a borrowed token.
 */
export function createTenantBillingRoutes(options: TenantBillingRoutesOptions): Hono {
  const { platform, router, env, service } = options;
  const now = options.now ?? (() => new Date());
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
    return { tenant, grant, token };
  }

  const forbidden = (c: Context) => c.json({ error: "FORBIDDEN", message: "ليست لديك صلاحية إدارة الاشتراك" }, 403);

  /** What this tenant's own backend counts against its plan, on its own day. Forwarded with the caller's token, so it is the caller's own read. */
  async function planUsage(code: string, token: string): Promise<PlanUsage> {
    const backend = await router.backendFor(code);
    const res = await backend.app.fetch(
      new Request("http://tenant/plan-usage", { headers: { authorization: `Bearer ${token}` } }),
    );
    if (!res.ok) return { today: null, month: null, quotas: [], limits: [] };
    return (await res.json()) as PlanUsage;
  }

  app.get("/subscription", async (c) => {
    const caller = await resolveCaller(c);
    if (caller instanceof Response) return caller;
    if (!allowed(caller.grant, "admin.settings.view")) return forbidden(c);
    const nowIso = now().toISOString();
    const view = await resolveTenantPlan(platform, caller.tenant.id, nowIso);
    const { subscription, plan } = view;
    let renewable = false;
    let amountDue: string | null = null;
    if (subscription && plan) {
      try {
        amountDue = cardCheckoutAmount(plan, subscription).toString();
        renewable = !isFreePlan(plan);
      } catch {
        amountDue = (subscription.billingCycle === "yearly" ? plan.priceYearly : plan.priceMonthly).toString();
      }
    }
    const usage = await planUsage(caller.tenant.code, caller.token);
    const plans = (await platform.stores.plans.list()).filter((p) => p.status === "active" && p.isPublic);
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
              planKind: plan.kind === PlanKind.Free ? "free" : "paid",
            }
          : null,
      today: usage.today,
      month: usage.month,
      trialEndsAt: subscription?.status === "trialing" ? subscription.trialEndsAt : null,
      trialDaysLeft: trialDaysLeft(subscription?.status === "trialing" ? subscription.trialEndsAt : null, usage.today),
      moduleTrialDays: MODULE_TRIAL_DAYS,
      quotas: usage.quotas as BillingQuotaDTO[],
      limits: usage.limits as BillingLimitDTO[],
      modules: plan ? moduleRows(plan, view.moduleTrials, view.everEntitled, nowIso) : [],
      plans: plans
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({
          id: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn,
          kind: p.kind === PlanKind.Free ? ("free" as const) : ("paid" as const),
          modules: [...p.modules], seatsIncluded: p.seatsIncluded, branchesIncluded: p.branchesIncluded,
          warehousesIncluded: p.warehousesIncluded, quotas: { ...p.quotas },
          priceMonthly: p.priceMonthly.toString(), priceYearly: p.priceYearly.toString(),
          trialDays: p.trialDays, current: p.id === plan?.id,
        })),
      checkouts: checkouts.map(serializeCardCheckout),
    };
    return c.json(body);
  });

  /**
   * «جرّب هذه الوحدة» — 14 days, once per module per tenant (DEC-31 rule 4).
   * The second attempt is refused bilingually by the domain, on the unique
   * (tenant, module) key rather than on a prior read, so two simultaneous
   * clicks cannot both open a trial.
   */
  app.post("/module-trials", async (c) => {
    const caller = await resolveCaller(c);
    if (caller instanceof Response) return caller;
    if (!allowed(caller.grant, "admin.settings.edit")) return forbidden(c);
    const parsed = startModuleTrialRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const nowIso = now().toISOString();
    const view = await resolveTenantPlan(platform, caller.tenant.id, nowIso);
    if (!view.plan) return c.json({ error: "SUBSCRIPTION_NOT_FOUND", message: "لا يوجد اشتراك فعّال لهذه المنشأة" }, 404);
    const entitled = [
      ...view.plan.modules,
      ...(view.subscription?.addOnModules ?? []),
      ...liveTrialModules(view.moduleTrials, nowIso),
    ];
    try {
      const trial = await startModuleTrial(
        {
          id: randomUUID(),
          tenantId: caller.tenant.id,
          module: parsed.data.module,
          startedBy: `tenant:${caller.tenant.code}:${caller.grant.userId}`,
          entitledModules: entitled,
          now: nowIso,
        },
        platform.stores.moduleTrials,
      );
      await recordSecurityEvent(platform.audit, {
        module: "platform",
        entityType: "MODULE_TRIAL",
        entityId: trial.id,
        action: SubscriptionTransition.ModuleTrialStarted,
        actor: trial.startedBy,
        severity: "INFO",
        timestamp: nowIso,
        details: { tenantId: caller.tenant.id, module: trial.module, endsAt: trial.endsAt },
      });
      router.invalidate(caller.tenant.code);
      return c.json({ module: trial.module, startedAt: trial.startedAt, endsAt: trial.endsAt }, 201);
    } catch (err) {
      if (err instanceof ModuleTrialAlreadyUsedError) {
        return c.json({ error: err.code, module: err.module, message: err.message, messageEn: err.messageEn }, 409);
      }
      if (err instanceof ModuleTrialUnavailableError) {
        return c.json({ error: err.code, module: err.module, message: err.message, messageEn: err.messageEn }, 409);
      }
      throw err;
    }
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
  const open = checkout.status === CardCheckoutStatus.Pending || checkout.status === CardCheckoutStatus.Failed;
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
    if (checkout.status === CardCheckoutStatus.Pending || checkout.status === CardCheckoutStatus.Failed) {
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
