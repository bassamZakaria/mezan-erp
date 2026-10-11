import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  InvalidSignupError,
  isDisposableEmailDomain,
  PlanNotFoundError,
  SignupTokenExpiredError,
  SignupTokenInvalidError,
  startSignup,
  topPublicPaidPlan,
  TenantCodeTakenError,
  TenantStatusCode,
  verifySignup,
  type Plan,
  type SignupRequest,
  type Tenant,
} from "@mezan/domain";
import { requestOrigin, sendNotificationEmail } from "@mezan/api";
import type { PlatformHandle } from "@mezan/backend";
import {
  startSignupRequestSchema,
  tenantDTOOf,
  verifySignupRequestSchema,
  type PublicPlanDTO,
  type StartSignupResultDTO,
  type VerifySignupResultDTO,
} from "@mezan/contracts";
import { provisionResultDTOOf, provisionTenant, ProvisioningSupersededError, TenantProvisioningError } from "./provision-tenant.js";
import { forwardedOrigin } from "./billing-routes.js";
import { createRateLimiter } from "./rate-limit.js";
import type { CloudEnv } from "./env.js";
import type { TenantRouter } from "./tenant-router.js";

export const SIGNUP_BASE_PATH = "/api/signup";

const TOKEN_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
const PROVISION_CLAIM_STALE_MS = 2 * 60_000;
const PROVISION_HEARTBEAT_MS = 30_000;
const PROVISION_WAIT_MS = 30_000;
const PROVISION_POLL_FIRST_MS = 50;
const PROVISION_POLL_MAX_MS = 1_000;
const PROVISION_RETRY_AFTER_SECONDS = 5;

export class SignupVerificationBusyError extends Error {
  readonly code = "SIGNUP_VERIFICATION_IN_PROGRESS";

  constructor() {
    super("جارٍ تفعيل الحساب الآن. أعد فتح الرابط بعد لحظات.");
    this.name = "SignupVerificationBusyError";
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The IP a signup attempt is counted against — `x-forwarded-for` only when this deployment is known to sit behind a trusted proxy, never taken on a caller's word alone (same gate `forwardedOrigin` uses). */
function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return requestOrigin(c) ?? "unknown";
}

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
  if (err instanceof SignupVerificationBusyError) {
    c.header("retry-after", String(PROVISION_RETRY_AFTER_SECONDS));
    return c.json({ error: err.code, message: err.message }, 503);
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
  readonly provisionWaitMs?: number;
  readonly provisionHeartbeatMs?: number;
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
  const provisionWaitMs = options.provisionWaitMs ?? PROVISION_WAIT_MS;
  const provisionHeartbeatMs = options.provisionHeartbeatMs ?? PROVISION_HEARTBEAT_MS;

  // Deliberately generous per-IP, tighter per-email — an office behind one
  // NAT address signing up several trials in an hour is normal; the same
  // inbox doing it is not.
  const startIpLimit = createRateLimiter(8, 60 * 60_000);
  const startEmailLimit = createRateLimiter(3, 60 * 60_000);
  const checkCodeLimit = createRateLimiter(40, 60 * 60_000);
  const verifyIpLimit = createRateLimiter(30, 60 * 60_000);

  const app = new Hono();

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
    const ip = clientIp(c, env.trustProxy);
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
    const ip = clientIp(c, env.trustProxy);
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
      const result = await sendNotificationEmail(env.platformSmtp, body.ownerEmail, mail);
      if (result.outcome !== "sent") {
        console.error(`[signup] verification email to a pending tenant could not be delivered (${result.outcome}): ${result.detail}`);
      }
    }

    const responseBody: StartSignupResultDTO = { devVerifyUrl };
    return c.json(responseBody, 201);
  });

  async function tenantSettledBy(request: SignupRequest): Promise<Tenant | null> {
    const tenant = await platform.stores.tenants.findByCode(request.code);
    if (!tenant || tenant.ownerEmail !== request.ownerEmail) return null;
    if (tenant.status === TenantStatusCode.Archived) throw new SignupTokenInvalidError();
    return tenant.status === TenantStatusCode.Active || tenant.status === TenantStatusCode.Suspended ? tenant : null;
  }

  function alreadyVerifiedAnswer(tenant: Tenant, request: SignupRequest): VerifySignupResultDTO {
    return { tenant: tenantDTOOf(tenant), adminEmail: request.ownerEmail, adminPin: null, alreadyVerified: true };
  }

  async function settleVerification(request: SignupRequest, stillOurs: () => Promise<boolean>): Promise<VerifySignupResultDTO> {
    const settled = await tenantSettledBy(request);
    if (settled) return alreadyVerifiedAnswer(settled, request);

    try {
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
        { platform, router, now, stillOurs },
      );
      router.invalidate(provisioned.tenant.code);
      return { ...provisionResultDTOOf(provisioned), alreadyVerified: provisioned.adminPin === null };
    } catch (err) {
      if (err instanceof ProvisioningSupersededError) throw err;
      const settledMeanwhile = await tenantSettledBy(request).catch(() => null);
      if (settledMeanwhile) return alreadyVerifiedAnswer(settledMeanwhile, request);
      throw err;
    }
  }

  const claims = platform.stores.signupRequests;

  function claimIsLive(claimedAt: string | null): boolean {
    return claimedAt !== null && new Date(claimedAt).getTime() >= now().getTime() - PROVISION_CLAIM_STALE_MS;
  }

  // Waiting only reads: a write transaction per poll would queue every waiter behind the platform database's single writer.
  async function waitWhileClaimed(tokenHash: string, giveUpAt: number): Promise<boolean> {
    let delay = PROVISION_POLL_FIRST_MS;
    for (;;) {
      if (!claimIsLive(await claims.provisioningClaimedAt(tokenHash))) return true;
      const left = giveUpAt - Date.now();
      if (left <= 0) return false;
      await pause(Math.min(delay, left));
      delay = Math.min(delay * 2, PROVISION_POLL_MAX_MS);
    }
  }

  async function answerOfTheWinner(request: SignupRequest, tokenHash: string, giveUpAt: number): Promise<VerifySignupResultDTO> {
    const released = (await waitWhileClaimed(tokenHash, giveUpAt)) && (await claims.provisioningClaimedAt(tokenHash)) === null;
    const settled = released ? await tenantSettledBy(request) : null;
    if (!settled) throw new SignupVerificationBusyError();
    return alreadyVerifiedAnswer(settled, request);
  }

  async function verifyInTurn(tokenHash: string): Promise<VerifySignupResultDTO> {
    const request = await verifySignup(tokenHash, claims, now().toISOString());
    const claimId = randomUUID();
    const giveUpAt = Date.now() + provisionWaitMs;
    for (;;) {
      if (!(await waitWhileClaimed(tokenHash, giveUpAt))) throw new SignupVerificationBusyError();
      const at = now().getTime();
      if (await claims.tryClaimProvisioning(tokenHash, claimId, new Date(at).toISOString(), new Date(at - PROVISION_CLAIM_STALE_MS).toISOString())) break;
      if (Date.now() >= giveUpAt) throw new SignupVerificationBusyError();
    }
    const stillOurs = () => claims.renewProvisioning(tokenHash, claimId, now().toISOString());
    const heartbeat = setInterval(() => void stillOurs().catch((err: unknown) => console.error("[signup] provisioning claim heartbeat failed", err)), provisionHeartbeatMs);
    heartbeat.unref();
    try {
      return await settleVerification(request, stillOurs);
    } catch (err) {
      if (err instanceof ProvisioningSupersededError) return await answerOfTheWinner(request, tokenHash, giveUpAt);
      throw err;
    } finally {
      clearInterval(heartbeat);
      await claims.releaseProvisioning(tokenHash, claimId);
    }
  }

  app.post("/verify", async (c) => {
    const ip = clientIp(c, env.trustProxy);
    const wait = verifyIpLimit.retryAfter(ip);
    if (wait > 0) return tooManyRequests(c, wait);
    verifyIpLimit.consume(ip);

    const parsed = verifySignupRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return signupErrorResponse(c, new SignupTokenInvalidError());

    try {
      return c.json(await verifyInTurn(hashToken(parsed.data.token)));
    } catch (err) {
      return signupErrorResponse(c, err);
    }
  });

  return app;
}
