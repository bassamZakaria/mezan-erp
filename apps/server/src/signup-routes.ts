import { Hono, type Context } from "hono";
import type { Plan } from "@mezan/domain";
import { connectionTurn } from "@mezan/api";
import type { PlatformHandle } from "@mezan/backend";
import { ownerHandOverRequestSchema, type PublicPlanDTO, type SiteStatusDTO } from "@mezan/contracts";
import { callerSource, requireCloudSource, type SourceReporter } from "./client-source.js";
import { platformRateLimiter } from "./rate-limit.js";
import type { CloudEnv } from "./env.js";
import type { TenantRouter } from "./tenant-router.js";

// CONTRACT: the path stays `/api/signup` and the page `/signup/owner-handover`, because hand-over links already mailed point there.
export const SIGNUP_BASE_PATH = "/api/signup";

function toPublicPlan(plan: Plan): PublicPlanDTO {
  return {
    id: plan.id,
    code: plan.code,
    nameAr: plan.nameAr,
    nameEn: plan.nameEn,
    kind: plan.kind,
    modules: [...plan.modules],
    seatsIncluded: plan.seatsIncluded,
    branchesIncluded: plan.branchesIncluded,
    warehousesIncluded: plan.warehousesIncluded,
    quotas: { ...plan.quotas },
    priceMonthly: plan.priceMonthly.toString(),
    priceYearly: plan.priceYearly.toString(),
    trialDays: plan.trialDays,
    soldOut: plan.soldOut ?? false,
  };
}

export interface SignupRoutesOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly env: CloudEnv;
  readonly sourceReporter?: SourceReporter;
}

export function createSignupRoutes(options: SignupRoutesOptions): Hono {
  const { platform, router, env } = options;
  const handOverIpLimit = platformRateLimiter(platform, "signup-verify-ip", 30, 60 * 60_000);

  const app = new Hono();
  app.use("*", requireCloudSource(env.clientSource, options.sourceReporter));
  app.use("*", connectionTurn(platform.audit));

  function tooManyRequests(c: Context, retryAfterSeconds: number): Response {
    c.header("retry-after", String(retryAfterSeconds));
    return c.json({ error: "TOO_MANY_REQUESTS", message: "محاولات كثيرة جدًا، حاول لاحقًا", messageEn: "Too many attempts. Try again later" }, 429);
  }

  app.get("/status", (c) => {
    const body: SiteStatusDTO = {
      contact: { email: env.supportEmail ?? null, phone: env.supportPhone ?? null, whatsapp: env.whatsappNumber ?? null },
    };
    return c.json(body);
  });

  app.get("/plans", async (c) => {
    const plans = await platform.stores.plans.list();
    const publicPlans = plans
      .filter((p) => p.isPublic && p.status === "active")
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toPublicPlan);
    return c.json(publicPlans);
  });

  // SECURITY: the token is the only credential here, and it was mailed to the
  // previously recorded owner address. Every link that confirms nothing is
  // answered the same way. A link for a company whose books are refused is
  // answered with that company's 503 instead.
  app.post("/owner-handover", async (c) => {
    const ip = callerSource(c);
    const wait = await handOverIpLimit.retryAfter(ip);
    if (wait > 0) return tooManyRequests(c, wait);
    await handOverIpLimit.consume(ip);

    const parsed = ownerHandOverRequestSchema.safeParse(await c.req.json().catch(() => null));
    const confirmed = parsed.success ? await router.confirmPendingOwnerByToken(parsed.data.token) : null;
    if (!confirmed) {
      return c.json({ error: "OWNER_HANDOVER_LINK_INVALID", message: "رابط التأكيد غير صالح أو سبق استخدامه.", messageEn: "The confirmation link is invalid or was already used." }, 400);
    }
    return c.json({ confirmed: true });
  });

  return app;
}
