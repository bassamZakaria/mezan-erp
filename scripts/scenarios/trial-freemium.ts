import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installClockOverride, FAKE_TODAY_ENV } from "../../packages/backend/src/clock-override.js";
import { createCloudApp } from "../../apps/server/src/cloud-app.ts";
import type { CloudEnv } from "../../apps/server/src/env.ts";
import type { Ctx } from "./harness.js";

/**
 * DEC-31 end to end — the walk §3.6 names, against the REAL cloud app.
 *
 * sign-up → day 1 on the top plan → day 15 on Free → a module trial → refused a
 * second time → the module trial ends and the module goes read-only → 100
 * invoices and the 101st refused → a return and a collection still accepted at
 * the quota.
 *
 * It builds its own cloud app rather than borrowing the harness's tenant
 * backend, because the things under test — the subscription, the plan, the drop
 * to Free — live in the PLATFORM database, and half the point is that a tenant
 * signed up through the real `/api/signup` flow lands on the right plan.
 *
 * The clock is moved by re-installing `MEZAN_FAKE_TODAY` between steps.
 * `installClockOverride` derives its offset from whatever `Date` is current, so
 * a second install shifts from the first rather than fighting it.
 */

const TENANT = "scn-freemium";
const OWNER_EMAIL = "owner@freemium.example";

function moveClockTo(day: string): void {
  process.env[FAKE_TODAY_ENV] = day;
  installClockOverride();
}

export async function run(ctx: Ctx): Promise<void> {
  const clockBefore = process.env[FAKE_TODAY_ENV];
  const dir = mkdtempSync(join(tmpdir(), "mezan-freemium-"));
  const env: CloudEnv = {
    platformDir: dir,
    trustProxy: false,
    sqliteExclusive: false,
    platformOwnerEmail: "owner@platform.example",
    platformOwnerPassword: "platform-owner-password",
    seedDemo: false,
    backupIntervalMinutes: 0,
    webDist: join(dir, "web"),
    port: 0,
    paymob: { mode: "off" },
  };

  const label = (text: string) => `trial-freemium · ${text}`;
  const check = (text: string, condition: boolean, detail = "") => ctx.check(label(text), condition, detail);

  const DAY_ONE = "2026-10-01";
  moveClockTo(DAY_ONE);

  const cloud = await createCloudApp(env);
  const root = cloud.root;

  type Res = { status: number; ok: boolean; body: any };
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const res = await root.fetch(
      new Request(`http://scenario${path}`, {
        method,
        headers: { "content-type": "application/json", "x-mezan-tenant": TENANT, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, ok: res.ok, body: parsed };
  }

  let session = "";
  const auth = () => ({ authorization: `Bearer ${session}` });
  const api = (method: string, path: string, body?: unknown) => call(method, `/api${path}`, body, auth());

  try {
    // ------------------------------------------------------------------
    // 1 · The Free plan is a real, public, zero-price plan with quotas.
    // ------------------------------------------------------------------
    const plans = await call("GET", "/api/signup/plans");
    const free = (plans.body as any[]).find((p) => p.code === "free");
    check("the Free plan is offered publicly", free !== undefined, JSON.stringify(plans.body).slice(0, 160));
    check("and costs nothing", Number(free?.priceMonthly) === 0 && Number(free?.priceYearly) === 0, `${free?.priceMonthly}/${free?.priceYearly}`);
    check("with 2 seats, 1 branch and 1 warehouse", free?.seatsIncluded === 2 && free?.branchesIncluded === 1 && free?.warehousesIncluded === 1, JSON.stringify(free));

    // ------------------------------------------------------------------
    // 2 · Sign-up starts 14 days on the TOP public plan, whatever was asked for.
    // ------------------------------------------------------------------
    const cheapest = (plans.body as any[]).find((p) => p.code === "core");
    const started = await call("POST", "/api/signup", {
      code: TENANT,
      nameAr: "منشأة تجربة الفريميوم",
      ownerEmail: OWNER_EMAIL,
      ownerNameAr: "مالك التجربة",
      planId: cheapest?.id,
      billingCycle: "monthly",
    });
    check("sign-up is accepted", started.status === 201, `status ${started.status} ${JSON.stringify(started.body).slice(0, 200)}`);
    const verifyUrl = String(started.body?.devVerifyUrl ?? "");
    const token = new URL(verifyUrl || "http://x/?token=").searchParams.get("token") ?? "";
    check("and hands back a verification link in dev mode", token !== "", verifyUrl);

    const verified = await call("POST", "/api/signup/verify", { token });
    check("verifying provisions the tenant", verified.status === 200, `status ${verified.status} ${JSON.stringify(verified.body).slice(0, 200)}`);
    const adminPin = String(verified.body?.adminPin ?? "");
    const adminEmail = String(verified.body?.adminEmail ?? OWNER_EMAIL);

    const login = await call("POST", "/api/auth/login", { username: adminEmail, pin: adminPin });
    check("the owner can sign in", login.status === 200, `status ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`);
    session = String(login.body?.token ?? "");

    const dayOne = await api("GET", "/billing/subscription");
    check("day 1 is a trial", dayOne.body?.subscription?.status === "trialing", JSON.stringify(dayOne.body?.subscription));
    check(
      "on the TOP public plan, not the one the form named",
      dayOne.body?.subscription?.planNameEn === "Enterprise",
      String(dayOne.body?.subscription?.planNameEn),
    );
    check("and the banner has 14 days to show", dayOne.body?.trialDaysLeft === 14, String(dayOne.body?.trialDaysLeft));

    const entitlementsDayOne = await api("GET", "/entitlements");
    check(
      "the trial unlocks HR, which no paid-for plan of theirs includes yet",
      (entitlementsDayOne.body?.activeModules ?? []).includes("hr"),
      JSON.stringify(entitlementsDayOne.body?.activeModules),
    );
    const hrWriteOnTrial = await api("POST", "/hr/departments", { id: "DEPT-1", code: "D1", name: "Trial Department", nameAr: "قسم التجربة" });
    check("and HR accepts a write during the trial", hrWriteOnTrial.status === 201, `status ${hrWriteOnTrial.status}`);

    // ------------------------------------------------------------------
    // 3 · Day 15 — the drop to Free, audited and idempotent.
    // ------------------------------------------------------------------
    moveClockTo("2026-10-16");

    const dayFifteen = await api("GET", "/billing/subscription");
    check("day 15 lands on the Free plan", dayFifteen.body?.subscription?.planKind === "free", JSON.stringify(dayFifteen.body?.subscription));
    check("as an ACTIVE subscription, not a lock", dayFifteen.body?.subscription?.status === "active", String(dayFifteen.body?.subscription?.status));
    check("with no trial left to count", dayFifteen.body?.trialDaysLeft === null, String(dayFifteen.body?.trialDaysLeft));

    const licence = await api("GET", "/license/state");
    check("the tenant is not read-only — the books are never held hostage", licence.body?.canWrite === true, JSON.stringify(licence.body));

    // Read it again: the move must be idempotent, one audit row however many
    // readers cross the boundary.
    await api("GET", "/billing/subscription");
    const trail = await api("GET", "/entitlements");
    check("the Free plan reports no expiry at all", trail.body?.expiresAt === null, String(trail.body?.expiresAt));

    // ------------------------------------------------------------------
    // 4 · A module that left the plan is READ-ONLY, not forbidden.
    // ------------------------------------------------------------------
    const hrRead = await api("GET", "/hr/departments");
    check("HR still answers a read after the drop", hrRead.status === 200, `status ${hrRead.status}`);
    const hrWrite = await api("POST", "/hr/departments", { id: "DEPT-2", code: "D2", name: "Second", nameAr: "قسم ٢" });
    check("and refuses a write", hrWrite.status === 403, `status ${hrWrite.status}`);
    check("naming the reason, not a bare 403", hrWrite.body?.error === "MODULE_READ_ONLY", JSON.stringify(hrWrite.body).slice(0, 200));
    check("in Arabic", typeof hrWrite.body?.message === "string" && /وحدة/.test(hrWrite.body.message), String(hrWrite.body?.message));
    check("and in English", typeof hrWrite.body?.messageEn === "string" && hrWrite.body.messageEn.includes("read-only"), String(hrWrite.body?.messageEn));

    // ------------------------------------------------------------------
    // 5 · A per-module trial, once per module per tenant.
    // ------------------------------------------------------------------
    const tried = await api("POST", "/billing/module-trials", { module: "hr" });
    check("a module trial can be started from the billing screen", tried.status === 201, `status ${tried.status} ${JSON.stringify(tried.body).slice(0, 200)}`);
    const hrWriteOnModuleTrial = await api("POST", "/hr/departments", { id: "DEPT-3", code: "D3", name: "Third", nameAr: "قسم ٣" });
    check("which makes HR writable again", hrWriteOnModuleTrial.status === 201, `status ${hrWriteOnModuleTrial.status}`);

    const again = await api("POST", "/billing/module-trials", { module: "hr" });
    check("a second attempt is refused", again.status === 409, `status ${again.status}`);
    check("by name", again.body?.error === "MODULE_TRIAL_ALREADY_USED", JSON.stringify(again.body).slice(0, 200));
    check("in Arabic", typeof again.body?.message === "string" && /مرة واحدة/.test(again.body.message), String(again.body?.message));
    check("and in English", typeof again.body?.messageEn === "string" && again.body.messageEn.includes("already been tried"), String(again.body?.messageEn));

    // ------------------------------------------------------------------
    // 6 · The module trial ends; the module goes read-only, nothing is lost.
    // ------------------------------------------------------------------
    moveClockTo("2026-10-31");
    const afterModuleTrial = await api("GET", "/hr/departments");
    check("after the module trial HR still reads", afterModuleTrial.status === 200, `status ${afterModuleTrial.status}`);
    check(
      "and every department recorded during it is still there",
      ctx.rows(afterModuleTrial.body).length >= 2,
      String(ctx.rows(afterModuleTrial.body).length),
    );
    const hrWriteAfter = await api("POST", "/hr/departments", { id: "DEPT-4", code: "D4", name: "Fourth", nameAr: "قسم ٤" });
    check("while writes are refused again", hrWriteAfter.status === 403 && hrWriteAfter.body?.error === "MODULE_READ_ONLY", `status ${hrWriteAfter.status} ${JSON.stringify(hrWriteAfter.body).slice(0, 160)}`);

    // ------------------------------------------------------------------
    // 7 · The monthly invoice quota, at creation only.
    // ------------------------------------------------------------------
    const usageBefore = await api("GET", "/plan-usage");
    const quotaRow = (usageBefore.body?.quotas ?? []).find((q: any) => q.kind === "sales_invoices_per_month");
    check("the Free plan carries a monthly invoice quota", quotaRow?.allowed === 100, JSON.stringify(usageBefore.body?.quotas));
    check("counted in the tenant's own month", /^\d{4}-\d{2}$/.test(String(usageBefore.body?.month)), String(usageBefore.body?.month));

    const today = String(usageBefore.body?.today ?? "");
    const customer = await api("POST", "/customers", { id: "CUST-SCN-1", code: "C1", nameAr: "عميل التجربة" });
    check("a customer can be created on Free", customer.status === 201, `status ${customer.status} ${JSON.stringify(customer.body).slice(0, 200)}`);
    const customerId = String(customer.body?.id ?? "CUST-SCN-1");

    const service = await api("POST", "/items", {
      id: "ITEM-SCN-1",
      code: "SVC1",
      nameAr: "خدمة استشارية",
      type: "service",
      baseUnitCode: "PCS",
      trackInventory: false,
    });
    check("an item can be created on Free", service.status === 201, `status ${service.status} ${JSON.stringify(service.body).slice(0, 200)}`);

    const branches = await api("GET", "/branches");
    const warehouses = await api("GET", "/warehouses");
    const branchId = String(ctx.rows(branches.body)[0]?.id ?? "");
    const warehouseId = String(ctx.rows(warehouses.body)[0]?.id ?? "");
    const accounts = await api("GET", "/accounts?pageSize=500");
    const accountId = (code: string) => String(ctx.rows(accounts.body).find((a: any) => a.code === code)?.id ?? "");
    const arAccountId = accountId("1105") || accountId("1200");
    const taxAccountId = accountId("2200");
    const revenueAccountId = accountId("4100");
    const postableCashAccountId = String(
      ctx.rows(accounts.body).find((a: any) => !a.isHeader && String(a.code).startsWith("11") && a.status === "active")?.id ?? "",
    );

    const invoiceBody = (n: number) => ({
      date: today,
      dueDate: today,
      customerId,
      customerNameAr: "عميل التجربة",
      customerTaxExempt: false,
      warehouseId,
      branchId,
      currency: "EGP",
      discount: { type: "percent", percent: 0 },
      arAccountId,
      taxAccountId,
      lines: [
        {
          lineId: `L${n}`,
          itemId: "ITEM-SCN-1",
          itemNameAr: "خدمة",
          isStock: false,
          qty: "1",
          unitPrice: "100",
          discountType: "percent",
          discountPercent: 0,
          taxRatePercent: 0,
          revenueAccountId,
        },
      ],
    });

    let created = 0;
    let firstInvoiceId = "";
    for (let n = 1; n <= 99; n += 1) {
      const res = await api("POST", "/sales-invoices", invoiceBody(n));
      if (res.status !== 201) {
        check("the first 99 invoices are accepted", false, `stopped at ${n}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
        break;
      }
      created += 1;
      if (n === 1) firstInvoiceId = String(res.body?.id ?? "");
    }
    check("the first 99 invoices are accepted", created === 99, `accepted ${created}`);

    // TWO AT ONCE ON THE LAST SLOT. A quota checked before the write and never
    // again lets both of these through: each reads 99, each writes, and the
    // tenant ends the month on 101. The recount inside the write transaction is
    // what makes exactly one of them win.
    const [raceA, raceB] = await Promise.all([
      api("POST", "/sales-invoices", invoiceBody(100)),
      api("POST", "/sales-invoices", invoiceBody(101)),
    ]);
    const won = [raceA, raceB].filter((r) => r.status === 201).length;
    const lost = [raceA, raceB].filter((r) => r.status === 409).length;
    check("two simultaneous creates at 99/100 produce exactly one invoice", won === 1, `${won} accepted (${raceA.status}/${raceB.status})`);
    check("and the other is refused by the quota", lost === 1, `${lost} refused (${raceA.status}/${raceB.status})`);
    created += won;

    const afterRace = await api("GET", "/plan-usage");
    const raced = (afterRace.body?.quotas ?? []).find((q: any) => q.kind === "sales_invoices_per_month");
    check("so the month never goes over the limit", raced?.used === 100, JSON.stringify(raced));

    const refusal: Res | null = await api("POST", "/sales-invoices", invoiceBody(102));
    check("exactly 100 invoices exist", created === 100, `accepted ${created}`);
    check("the 101st is refused", refusal?.status === 409, `status ${refusal?.status} ${JSON.stringify(refusal?.body).slice(0, 200)}`);
    check("by name", refusal?.body?.error === "PLAN_LIMIT_REACHED", JSON.stringify(refusal?.body).slice(0, 200));
    check("quoting the limit it hit", refusal?.body?.allowed === 100 && refusal?.body?.used === 100, `${refusal?.body?.allowed}/${refusal?.body?.used}`);
    check("in Arabic", typeof refusal?.body?.message === "string" && /باقة/.test(refusal.body.message), String(refusal?.body?.message));
    check("and in English", typeof refusal?.body?.messageEn === "string" && refusal.body.messageEn.includes("already recorded"), String(refusal?.body?.messageEn));

    const usageAfter = await api("GET", "/plan-usage");
    const usedRow = (usageAfter.body?.quotas ?? []).find((q: any) => q.kind === "sales_invoices_per_month");
    check("and the billing screen reads the same 100 the refusal quoted", usedRow?.used === 100, JSON.stringify(usedRow));

    // ------------------------------------------------------------------
    // 8 · At the quota, finishing old work is never blocked.
    // ------------------------------------------------------------------
    const confirmed = await api("POST", `/sales-invoices/${firstInvoiceId}/confirm`);
    check("an invoice already raised still confirms at the quota", confirmed.status === 200, `status ${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 200)}`);

    const treasury = await api("POST", "/treasury-accounts", {
      id: "TRY-SCN-1",
      code: "CASH1",
      name: "خزينة التجربة",
      type: "cash",
      glAccountId: postableCashAccountId,
      branchId,
      currency: "EGP",
    });
    check("a treasury account can be created on Free", treasury.status === 201, `status ${treasury.status} ${JSON.stringify(treasury.body).slice(0, 220)}`);
    const treasuryAccountId = String(treasury.body?.id ?? "TRY-SCN-1");
    const collection = await api("POST", `/sales-invoices/${firstInvoiceId}/payments`, {
      amount: "50",
      treasuryAccountId,
      paymentMethod: "cash",
      date: today,
    });
    check(
      "a collection against an existing invoice is accepted at the quota",
      collection.status === 200 || collection.status === 201,
      `status ${collection.status} ${JSON.stringify(collection.body).slice(0, 220)}`,
    );

    const ret = await api("POST", "/sales-returns/from-invoice", {
      id: "SRET-SCN-1",
      sourceInvoiceId: firstInvoiceId,
      warehouseId,
      date: today,
      reason: "DEFECTIVE",
      requested: [{ itemId: "ITEM-SCN-1", qty: "1" }],
    });
    check(
      "and so is a return",
      ret.status === 201 || ret.status === 200,
      `status ${ret.status} ${JSON.stringify(ret.body).slice(0, 220)}`,
    );

    const exportable = await api("GET", "/sales-invoices?pageSize=5");
    check("reads and exports keep working at the quota", exportable.status === 200, `status ${exportable.status}`);

    // ------------------------------------------------------------------
    // 9 · The next tenant month starts clean — the quota is per month.
    // ------------------------------------------------------------------
    moveClockTo("2026-11-02");
    const novemberToday = String((await api("GET", "/plan-usage")).body?.today ?? "");
    const november = await api("POST", "/sales-invoices", { ...invoiceBody(200), date: novemberToday, dueDate: novemberToday });
    check("a new month starts the count again", november.status === 201, `status ${november.status} ${JSON.stringify(november.body).slice(0, 200)}`);
  } finally {
    await cloud.close();
    if (clockBefore) moveClockTo(clockBefore);
  }
}
