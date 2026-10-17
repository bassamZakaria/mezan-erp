import { type APIRequestContext, type Page } from "@playwright/test";
import { test, expect } from "./support/test";
import { ApiError, CodePrefix, HttpMethod, PlanId, SAAS_API_URL, SubscriptionStatus, uniqueCode } from "./support/env";
import { bearer, openTenantDetail, platformSignIn, platformToken, provisionTenant, tenantApiLogin, tenantCall, tenantSignIn, type TenantLogin } from "./support/saas";

const BILLING_PATH = "/setup/settings-billing";
const WEBHOOK_URL = `${SAAS_API_URL}/api/billing/paymob/webhook`;
const PLAN_PRICE_CENTS = 98_000;
const FORGED_SIGNATURES = ["deadbeef", "0".repeat(128), ""];

enum CheckoutStatus {
  Pending = "pending",
}

interface PendingCheckout {
  readonly id: string;
  readonly status: string;
  readonly paymentId: string | null;
  readonly providerRef: string | null;
}

interface Subscription {
  readonly status: string;
  readonly currentPeriodEnd: string;
}

async function subscriptionOf(request: APIRequestContext, tenant: TenantLogin): Promise<Subscription> {
  const api = await tenantApiLogin(request, tenant);
  const answer = await tenantCall(request, api, HttpMethod.Get, "/billing/subscription");
  expect(answer.status).toBe(200);
  return (answer.body as { subscription: Subscription }).subscription;
}

async function paymentCount(request: APIRequestContext, tenant: TenantLogin): Promise<number> {
  const token = await platformToken(request);
  const response = await request.get(`${SAAS_API_URL}/api/platform/tenants/${tenant.id}/payments`, { headers: { ...bearer(token) } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as unknown[]).length;
}

async function openTenantCheckout(page: Page, tenant: TenantLogin): Promise<void> {
  await tenantSignIn(page, tenant);
  await page.goto(BILLING_PATH);
  await expect(page.getByText("وضع الاختبار", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "تجديد الاشتراك" }).click();
  await expect(page).toHaveURL(/\/billing\/test-checkout\/[^/]+$/);
  await expect(page.getByText(/TEST MODE/)).toBeVisible();
  await expect(page.getByText("980.00 EGP")).toBeVisible();
}

test.describe("Card checkout in test mode — only a signed callback renews", () => {
  test("a successful card payment renews the subscription and records the payment", async ({ page, request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode(CodePrefix.Paid), nameAr: "شركة الدفع", ownerNameAr: "ماجد الدفع", planId: PlanId.Business, trial: true });
    const before = await subscriptionOf(request, tenant);
    expect(before.status).toBe(SubscriptionStatus.Trialing);
    expect(await paymentCount(request, tenant)).toBe(0);

    await openTenantCheckout(page, tenant);
    await page.getByRole("button", { name: /Simulate success/ }).click();
    await expect(page).toHaveURL(/\/setup\/settings-billing/);
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*نشط/);

    const after = await subscriptionOf(request, tenant);
    expect(after.status).toBe(SubscriptionStatus.Active);
    expect(Date.parse(after.currentPeriodEnd)).toBeGreaterThan(Date.parse(before.currentPeriodEnd));
    expect(await paymentCount(request, tenant)).toBe(1);

    await page.reload();
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*نشط/);
  });

  test("a declined card renews nothing and records no payment", async ({ page, request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode(CodePrefix.Declined), nameAr: "شركة الرفض", ownerNameAr: "رنا الرفض", planId: PlanId.Business, trial: true });
    const before = await subscriptionOf(request, tenant);

    await openTenantCheckout(page, tenant);
    await page.getByRole("button", { name: /Simulate decline/ }).click();
    await expect(page).toHaveURL(/\/setup\/settings-billing/);
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*تجريبي/);

    const after = await subscriptionOf(request, tenant);
    expect(after.status).toBe(SubscriptionStatus.Trialing);
    expect(after.currentPeriodEnd).toBe(before.currentPeriodEnd);
    expect(await paymentCount(request, tenant)).toBe(0);
  });

  test("returning from checkout with forged query parameters renews nothing", async ({ page, request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode(CodePrefix.Forged), nameAr: "شركة التزوير", ownerNameAr: "فادي", planId: PlanId.Business, trial: true });
    const before = await subscriptionOf(request, tenant);
    await tenantSignIn(page, tenant);
    await page.goto(`${BILLING_PATH}?checkout=00000000-0000-4000-8000-000000000000&success=true&txn_response_code=APPROVED`);
    await expect(page.getByRole("heading", { name: "الباقة والاستخدام", level: 1 })).toBeVisible();
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*تجريبي/);
    const after = await subscriptionOf(request, tenant);
    expect(after).toEqual(before);
    expect(await paymentCount(request, tenant)).toBe(0);
  });

  test("a forged success callback for a real pending checkout is refused, pays nothing and renews nothing", async ({ request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode(CodePrefix.Unsigned), nameAr: "شركة التوقيع", ownerNameAr: "وفاء", planId: PlanId.Business, trial: true });
    const api = await tenantApiLogin(request, tenant);
    const before = await subscriptionOf(request, tenant);
    const opened = await tenantCall(request, api, HttpMethod.Post, "/billing/checkout", { returnPath: BILLING_PATH });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    const checkout = opened.body as PendingCheckout;
    expect(checkout.status).toBe(CheckoutStatus.Pending);

    const forgedSuccess = {
      type: "TRANSACTION",
      obj: {
        id: 424_242,
        pending: false,
        success: true,
        amount_cents: PLAN_PRICE_CENTS,
        currency: "EGP",
        is_auth: false,
        is_capture: false,
        is_standalone_payment: true,
        is_voided: false,
        is_refunded: false,
        is_3d_secure: true,
        has_parent_transaction: false,
        error_occured: false,
        owner: 1,
        order: { id: 1, merchant_order_id: checkout.id },
        source_data: { pan: "2346", type: "card", sub_type: "MasterCard" },
      },
    };
    const posts = [
      ...FORGED_SIGNATURES.map((signature) => request.post(`${WEBHOOK_URL}?hmac=${signature}`, { data: forgedSuccess })),
      request.post(WEBHOOK_URL, { data: forgedSuccess }),
    ];
    for (const response of await Promise.all(posts)) {
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: ApiError.InvalidSignature });
    }

    expect(await paymentCount(request, tenant)).toBe(0);
    expect(await subscriptionOf(request, tenant)).toEqual(before);
    const stillPending = await tenantCall(request, api, HttpMethod.Get, `/billing/checkouts/${checkout.id}`);
    expect(stillPending.body).toMatchObject({ id: checkout.id, status: CheckoutStatus.Pending, paymentId: null });
  });

  test("the operator's payment link renews the tenant the same way", async ({ page, request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode(CodePrefix.PaymentLink), nameAr: "شركة الرابط", ownerNameAr: "لمى", planId: PlanId.Business, trial: true });
    await platformSignIn(page);
    await openTenantDetail(page, tenant.code);
    await page.getByRole("button", { name: "ادفع بالبطاقة" }).click();
    await expect(page.getByText("رابط الدفع جاهز")).toBeVisible();
    const link = (await page.locator("main code").first().innerText()).trim();
    expect(link).toMatch(/\/billing\/test-checkout\/[^/]+$/);

    await page.goto(link);
    await page.getByRole("button", { name: /Simulate success/ }).click();
    await expect(page).toHaveURL(new RegExp(`/platform/tenants/${tenant.id}`));
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*نشط/);
    expect(await paymentCount(request, tenant)).toBe(1);
    expect((await subscriptionOf(request, tenant)).status).toBe(SubscriptionStatus.Active);
  });
});
