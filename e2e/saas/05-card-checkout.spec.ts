import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { PlanId, SAAS_API_URL, uniqueCode } from "./support/env";
import { openTenantDetail, platformSignIn, platformToken, provisionTenant, tenantApiLogin, tenantCall, tenantSignIn, type TenantLogin } from "./support/saas";

interface Subscription {
  readonly status: string;
  readonly currentPeriodEnd: string;
}

async function subscriptionOf(request: APIRequestContext, tenant: TenantLogin): Promise<Subscription> {
  const api = await tenantApiLogin(request, tenant);
  const answer = await tenantCall(request, api, "GET", "/billing/subscription");
  expect(answer.status).toBe(200);
  return (answer.body as { subscription: Subscription }).subscription;
}

async function paymentCount(request: APIRequestContext, tenant: TenantLogin): Promise<number> {
  const token = await platformToken(request);
  const response = await request.get(`${SAAS_API_URL}/api/platform/tenants/${tenant.id}/payments`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as unknown[]).length;
}

async function openTenantCheckout(page: Page, tenant: TenantLogin): Promise<void> {
  await tenantSignIn(page, tenant);
  await page.goto("/setup/settings-billing");
  await expect(page.getByText("وضع الاختبار", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "تجديد الاشتراك" }).click();
  await expect(page).toHaveURL(/\/billing\/test-checkout\/[^/]+$/);
  await expect(page.getByText(/TEST MODE/)).toBeVisible();
  await expect(page.getByText("980.00 EGP")).toBeVisible();
}

test.describe("Card checkout in test mode — only a signed callback renews", () => {
  test("a successful card payment renews the subscription and records the payment", async ({ page, request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode("paid"), nameAr: "شركة الدفع", ownerNameAr: "ماجد الدفع", planId: PlanId.Business, trial: true });
    const before = await subscriptionOf(request, tenant);
    expect(before.status).toBe("trialing");
    expect(await paymentCount(request, tenant)).toBe(0);

    await openTenantCheckout(page, tenant);
    await page.getByRole("button", { name: /Simulate success/ }).click();
    await expect(page).toHaveURL(/\/setup\/settings-billing/);
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*نشط/);

    const after = await subscriptionOf(request, tenant);
    expect(after.status).toBe("active");
    expect(Date.parse(after.currentPeriodEnd)).toBeGreaterThan(Date.parse(before.currentPeriodEnd));
    expect(await paymentCount(request, tenant)).toBe(1);

    await page.reload();
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*نشط/);
  });

  test("a declined card renews nothing and records no payment", async ({ page, request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode("declined"), nameAr: "شركة الرفض", ownerNameAr: "رنا الرفض", planId: PlanId.Business, trial: true });
    const before = await subscriptionOf(request, tenant);

    await openTenantCheckout(page, tenant);
    await page.getByRole("button", { name: /Simulate decline/ }).click();
    await expect(page).toHaveURL(/\/setup\/settings-billing/);
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*تجريبي/);

    const after = await subscriptionOf(request, tenant);
    expect(after.status).toBe("trialing");
    expect(after.currentPeriodEnd).toBe(before.currentPeriodEnd);
    expect(await paymentCount(request, tenant)).toBe(0);
  });

  test("returning from checkout with forged query parameters renews nothing", async ({ page, request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode("forged"), nameAr: "شركة التزوير", ownerNameAr: "فادي", planId: PlanId.Business, trial: true });
    const before = await subscriptionOf(request, tenant);
    await tenantSignIn(page, tenant);
    await page.goto("/setup/settings-billing?checkout=00000000-0000-4000-8000-000000000000&success=true&txn_response_code=APPROVED");
    await expect(page.getByRole("heading", { name: "الباقة والاستخدام", level: 1 })).toBeVisible();
    await expect(page.locator("main")).toContainText(/حالة الاشتراك\s*تجريبي/);
    const after = await subscriptionOf(request, tenant);
    expect(after).toEqual(before);
    expect(await paymentCount(request, tenant)).toBe(0);
  });

  test("an unsigned webhook is refused", async ({ request }) => {
    const response = await request.post(`${SAAS_API_URL}/api/billing/paymob/webhook?hmac=deadbeef`, {
      data: { type: "TRANSACTION", obj: { id: 1, success: true, amount_cents: 98000, order: { id: 1, merchant_order_id: "x" } } },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test("the operator's payment link renews the tenant the same way", async ({ page, request }) => {
    const tenant = await provisionTenant(request, { code: uniqueCode("link"), nameAr: "شركة الرابط", ownerNameAr: "لمى", planId: PlanId.Business, trial: true });
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
    expect((await subscriptionOf(request, tenant)).status).toBe("active");
  });
});
