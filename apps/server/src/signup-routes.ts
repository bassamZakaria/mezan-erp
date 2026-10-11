import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  InvalidSignupError,
  isDisposableEmailDomain,
  PlanNotFoundError,
  SignupRequestStatus,
  SignupTokenExpiredError,
  SignupTokenInvalidError,
  startSignup,
  topPublicPaidPlan,
  TenantCodeTakenError,
  verifySignup,
  type Plan,
} from "@mezan/domain";
import { connectionTurn, sendNotificationEmail } from "@mezan/api";
import type { PlatformHandle } from "@mezan/backend";
import {
  startSignupRequestSchema,
  verifySignupRequestSchema,
  type PublicPlanDTO,
  type StartSignupResultDTO,
  type VerifySignupResultDTO,
} from "@mezan/contracts";
import { provisionTenant, TenantProvisioningError } from "./provision-tenant.js";
import { forwardedOrigin } from "./billing-routes.js";
import { callerSource, requireCloudSource, type SourceReporter } from "./client-source.js";
import { createRateLimiter } from "./rate-limit.js";
import type { CloudEnv } from "./env.js";
import type { TenantRouter } from "./tenant-router.js";

const TOKEN_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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
    priceMonthly: plan.priceMonthly.toString(),
    priceYearly: plan.priceYearly.toString(),
    trialDays: plan.trialDays,
  };
}

function verificationEmail(link: string, nameAr: string): { subject: string; body: string } {
  return {
    subject: "فعّل حساب ميزان الخاص بك — Activate your Mezan account",
    body: [
      `مرحبًا،`,
      ``,
      `لإتمام تسجيل "${nameAr}" في ميزان، افتح الرابط التالي خلال 24 ساعة:`,
      link,
      ``,
      `إن لم تطلب هذا التسجيل، تجاهل هذه الرسالة.`,
      ``,
      `-----`,
      ``,
      `Hello,`,
      ``,
      `To finish setting up "${nameAr}" on Mezan, open the link below within 24 hours:`,
      link,
      ``,
      `If you did not request this, ignore this message.`,
    ].join("\n"),
  };
}

function signupErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof InvalidSignupError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 400);
  }
  if (err instanceof TenantCodeTakenError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof PlanNotFoundError) {
    return c.json({ error: "PLAN_NOT_FOUND", message: "الباقة المختارة غير متاحة" }, 404);
  }
  if (err instanceof SignupTokenInvalidError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof SignupTokenExpiredError) {
    return c.json({ error: err.code, message: err.message }, 410);
  }
  if (err instanceof TenantProvisioningError) {
    console.error(err, err.cause);
    return c.json({ error: err.code, message: err.message }, 500);
  }
  throw err;
}

export interface SignupRoutesOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly env: CloudEnv;
  readonly now?: () => Date;
  readonly sourceReporter?: SourceReporter;
}

/**
 * Public, session-free routes for self-serve signup — mounted under
 * `/api/signup` in `cloud-app.ts` only (never on the desktop LAN socket,
 * which has no concept of "the internet at large" to be rate-limited
 * against). A tenant exists as `provisioning` in the platform tenant table
 * from the moment {@link startSignup} runs, but `provisionTenant` — the only
 * thing that seeds it, creates its admin and starts its trial — runs
 * exclusively from `POST /verify`, so an unverified email can never end up
 * owning a live tenant.
 */
export function createSignupRoutes(options: SignupRoutesOptions): Hono {
  const { platform, router, env } = options;
  const now = options.now ?? (() => new Date());

  // Deliberately generous per-IP, tighter per-email — an office behind one
  // NAT address signing up several trials in an hour is normal; the same
  // inbox doing it is not.
  const startIpLimit = createRateLimiter(8, 60 * 60_000);
  const startEmailLimit = createRateLimiter(3, 60 * 60_000);
  const checkCodeLimit = createRateLimiter(40, 60 * 60_000);
  const verifyIpLimit = createRateLimiter(30, 60 * 60_000);

  const app = new Hono();
  app.use("*", requireCloudSource(env.clientSource, options.sourceReporter));
  app.use("*", connectionTurn(platform.audit));

  function tooManyRequests(c: Context, retryAfterSeconds: number): Response {
    c.header("retry-after", String(retryAfterSeconds));
    return c.json({ error: "TOO_MANY_REQUESTS", message: "محاولات كثيرة جدًا، حاول لاحقًا" }, 429);
  }

  app.get("/plans", async (c) => {
    const plans = await platform.stores.plans.list();
    const publicPlans = plans
      .filter((p) => p.isPublic && p.status === "active")
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toPublicPlan);
    return c.json(publicPlans);
  });

  /**
   * Never answers a tenant's name — only whether the code is free — the same
   * shape as `/platform/resolve`'s fix (see `tenant-router.ts`).
   */
  app.get("/check-code", async (c) => {
    const ip = callerSource(c);
    const wait = checkCodeLimit.retryAfter(ip);
    if (wait > 0) return tooManyRequests(c, wait);
    checkCodeLimit.consume(ip);

    const code = (c.req.query("code") ?? "").trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(code)) {
      return c.json({ error: "VALIDATION_ERROR", message: "صيغة الرمز غير صالحة" }, 400);
    }
    const nowIso = now().toISOString();
    const taken = (await platform.stores.tenants.findByCode(code)) || (await platform.stores.signupRequests.findActiveByCode(code, nowIso));
    return c.json({ available: !taken });
  });

  app.post("/", async (c) => {
    const ip = callerSource(c);
    const ipWait = startIpLimit.retryAfter(ip);
    if (ipWait > 0) return tooManyRequests(c, ipWait);
    // Consumed BEFORE parsing, not after: a flood of malformed bodies must
    // still cost the sender rate-limit budget, or the limiter only ever
    // throttles requests that were already well-formed.
    startIpLimit.consume(ip);

    const raw = await c.req.json().catch(() => null);
    const parsed = startSignupRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const body = parsed.data;

    // Honeypot: a real visitor never fills this hidden field in. Answer
    // exactly like a real success so a bot never learns it was caught, but
    // do nothing — no row, no mail.
    if (body.website && body.website.trim() !== "") {
      const result: StartSignupResultDTO = { devVerifyUrl: null };
      return c.json(result, 201);
    }

    const emailWait = startEmailLimit.retryAfter(body.ownerEmail);
    if (emailWait > 0) return tooManyRequests(c, emailWait);
    startEmailLimit.consume(body.ownerEmail);

    if (isDisposableEmailDomain(body.ownerEmail)) {
      return c.json({ error: "DISPOSABLE_EMAIL", message: "لا يمكن استخدام بريد إلكتروني مؤقّت للتسجيل" }, 400);
    }

    // DEC-31 rule 1 — every sign-up is a reverse trial on the TOP public paid
    // plan, whatever plan the form named. The plan the visitor browsed is a
    // shop window; the 14 days are always on everything, and day 15 lands on
    // Free. Resolved here rather than trusted from the request so a crafted
    // body cannot pick its own trial plan.
    const trialPlan = topPublicPaidPlan(await platform.stores.plans.list());
    const token = randomBytes(32).toString("base64url");
    try {
      await startSignup(
        {
          id: randomUUID(),
          code: body.code,
          nameAr: body.nameAr,
          nameEn: body.nameEn,
          ownerEmail: body.ownerEmail,
          ownerNameAr: body.ownerNameAr,
          planId: trialPlan?.id ?? body.planId,
          billingCycle: body.billingCycle,
          tokenHash: hashToken(token),
          now: now().toISOString(),
          expiresInMs: TOKEN_EXPIRES_IN_MS,
        },
        platform.stores.signupRequests,
        platform.stores.tenants,
        platform.stores.plans,
      );
    } catch (err) {
      return signupErrorResponse(c, err);
    }

    const origin = forwardedOrigin(c.req.raw, env.trustProxy);
    const verifyUrl = `${origin}/signup/verify?token=${encodeURIComponent(token)}`;

    let devVerifyUrl: string | null = null;
    if (!env.platformSmtp) {
      // No platform SMTP configured at all — dev mode, by deployment choice.
      // Showing the link back to whoever just submitted this form is safe
      // ONLY because that is true; the moment SMTP is configured this branch
      // never runs, so a delivery hiccup below can never leak a link for an
      // email address the caller does not control.
      devVerifyUrl = verifyUrl;
    } else {
      const mail = verificationEmail(verifyUrl, body.nameAr);
      const smtp = env.platformSmtp;
      const result = await platform.outsideTheTurn(() => sendNotificationEmail(smtp, body.ownerEmail, mail));
      if (result.outcome !== "sent") {
        console.error(`[signup] verification email to a pending tenant could not be delivered (${result.outcome}): ${result.detail}`);
      }
    }

    const responseBody: StartSignupResultDTO = { devVerifyUrl };
    return c.json(responseBody, 201);
  });

  app.post("/verify", async (c) => {
    const ip = callerSource(c);
    const wait = verifyIpLimit.retryAfter(ip);
    if (wait > 0) return tooManyRequests(c, wait);
    verifyIpLimit.consume(ip);

    const parsed = verifySignupRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);

    const tokenHash = hashToken(parsed.data.token);
    const nowIso = now().toISOString();
    try {
      const before = await platform.stores.signupRequests.findByTokenHash(tokenHash);
      const alreadyVerified = before?.status === SignupRequestStatus.Verified;
      const request = await verifySignup(tokenHash, platform.stores.signupRequests, nowIso);

      const provisioned = await provisionTenant(
        {
          code: request.code,
          nameAr: request.nameAr,
          nameEn: request.nameEn,
          ownerEmail: request.ownerEmail,
          ownerNameAr: request.ownerNameAr,
          planId: request.planId,
          billingCycle: request.billingCycle,
          trial: true,
        },
        { platform, router, now },
      );
      router.invalidate(provisioned.tenant.code);

      const responseBody: VerifySignupResultDTO = { ...provisioned, alreadyVerified };
      return c.json(responseBody);
    } catch (err) {
      return signupErrorResponse(c, err);
    }
  });

  return app;
}
