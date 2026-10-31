import { describe, it, expect } from "vitest";
import {
  platformLoginRequestSchema,
  platformSessionSchema,
  platformUserSchema,
  createPlatformUserRequestSchema,
  tenantSchema,
  createTenantRequestSchema,
  provisionResultSchema,
  startSubscriptionRequestSchema,
  changePlanRequestSchema,
  recordPaymentRequestSchema,
  subscriptionSchema,
  planSchema,
  planCreateRequestSchema,
  planUpdateRequestSchema,
  paymentSchema,
  licenseStateReasonSchema,
  licenseStateViewSchema,
  tenantSummarySchema,
} from "./platform.js";

describe("platformLoginRequestSchema", () => {
  const login = { email: "owner@mezan.test", password: "s3cret-password" };

  it("accepts a valid login and lower-cases/trims the email", () => {
    const result = platformLoginRequestSchema.safeParse({ ...login, email: " Owner@Mezan.test " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("owner@mezan.test");
  });

  it("rejects a malformed email", () => {
    expect(platformLoginRequestSchema.safeParse({ ...login, email: "not-an-email" }).success).toBe(false);
  });
});

describe("platformSessionSchema", () => {
  const session = { token: "tok-1", user: { id: "u1", email: "owner@mezan.test", role: "owner" as const } };

  it("accepts a valid session", () => {
    expect(platformSessionSchema.safeParse(session).success).toBe(true);
  });

  it("rejects an unknown role", () => {
    const result = platformSessionSchema.safeParse({ ...session, user: { ...session.user, role: "admin" } });
    expect(result.success).toBe(false);
  });
});

describe("platformUserSchema", () => {
  const user = { id: "u1", email: "support@mezan.test", role: "support" as const, status: "active" as const, createdAt: "2026-09-14T00:00:00.000Z" };

  it("accepts a valid platform user", () => {
    expect(platformUserSchema.safeParse(user).success).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(platformUserSchema.safeParse({ ...user, status: "banned" }).success).toBe(false);
  });
});

describe("createPlatformUserRequestSchema", () => {
  const req = { email: "new-op@mezan.test", password: "a-long-enough-password", role: "support" as const };

  it("accepts a valid request", () => {
    expect(createPlatformUserRequestSchema.safeParse(req).success).toBe(true);
  });

  it("rejects a password shorter than 12 characters", () => {
    expect(createPlatformUserRequestSchema.safeParse({ ...req, password: "short" }).success).toBe(false);
  });
});

describe("tenantSchema", () => {
  const tenant = {
    id: "t1", code: "acme", nameAr: "شركة أكمي", nameEn: "Acme Co", ownerEmail: "owner@acme.test",
    ownerContactVerified: true, ownerNeeded: false, pendingOwner: null, status: "active" as const, dbFile: "tenants/acme.db",
    createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:00.000Z",
  };

  it("accepts a valid tenant and preserves it verbatim", () => {
    const result = tenantSchema.safeParse(tenant);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(tenant);
  });

  it("rejects an unknown status", () => {
    expect(tenantSchema.safeParse({ ...tenant, status: "deleted" }).success).toBe(false);
  });
});

describe("createTenantRequestSchema", () => {
  const req = {
    code: "acme", nameAr: "شركة أكمي", ownerEmail: "owner@acme.test", ownerNameAr: "محمد",
    planId: "plan-core", billingCycle: "monthly" as const, trial: true,
  };

  it("accepts a valid request", () => {
    expect(createTenantRequestSchema.safeParse(req).success).toBe(true);
  });

  it("rejects a code that fails the slug regex", () => {
    expect(createTenantRequestSchema.safeParse({ ...req, code: "AC" }).success).toBe(false);
  });
});

describe("provisionResultSchema", () => {
  const tenant = {
    id: "t1", code: "acme", nameAr: "شركة أكمي", nameEn: null, ownerEmail: "owner@acme.test",
    ownerContactVerified: true, ownerNeeded: false, pendingOwner: null, status: "provisioning" as const, dbFile: "tenants/acme.db",
    createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:00.000Z",
  };
  const result = { tenant, adminEmail: "owner@acme.test", adminPassword: "Temp-Pass-123" };

  it("accepts a valid provisioning result", () => {
    expect(provisionResultSchema.safeParse(result).success).toBe(true);
  });

  it("rejects a temporary password shorter than 8 characters", () => {
    expect(provisionResultSchema.safeParse({ ...result, adminPassword: "1234567" }).success).toBe(false);
  });

  it("accepts a null password for a resumed provision", () => {
    expect(provisionResultSchema.safeParse({ ...result, adminPassword: null }).success).toBe(true);
  });
});

describe("startSubscriptionRequestSchema", () => {
  const req = { planId: "plan-core", billingCycle: "yearly" as const, trial: false };

  it("accepts a minimal valid request", () => {
    expect(startSubscriptionRequestSchema.safeParse(req).success).toBe(true);
  });

  it("rejects a negative extraSeats", () => {
    expect(startSubscriptionRequestSchema.safeParse({ ...req, extraSeats: -1 }).success).toBe(false);
  });
});

describe("changePlanRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(changePlanRequestSchema.safeParse({ planId: "plan-pro" }).success).toBe(true);
  });

  it("rejects an empty planId", () => {
    expect(changePlanRequestSchema.safeParse({ planId: "" }).success).toBe(false);
  });
});

describe("recordPaymentRequestSchema", () => {
  const req = { amount: "1250.50", reference: "REF-1", paidAt: "2026-09-14T00:00:00.000Z", idempotencyKey: "0b0f5c1e-6d1b-4a55-9a43-6f0c1d2e3f40" };

  it("accepts a valid request", () => {
    expect(recordPaymentRequestSchema.safeParse(req).success).toBe(true);
  });

  it("refuses a request that carries no idempotency key, so a retry can never be mistaken for a second payment", () => {
    const { idempotencyKey: _omitted, ...withoutKey } = req;
    expect(recordPaymentRequestSchema.safeParse(withoutKey).success).toBe(false);
    expect(recordPaymentRequestSchema.safeParse({ ...req, idempotencyKey: "short" }).success).toBe(false);
  });

  it("carries an explicit confirmation of a duplicate reference, and only as a boolean", () => {
    expect(recordPaymentRequestSchema.safeParse({ ...req, confirmDuplicateReference: true }).success).toBe(true);
    expect(recordPaymentRequestSchema.safeParse({ ...req, confirmDuplicateReference: "yes" }).success).toBe(false);
  });

  it("rejects a non-decimal amount", () => {
    expect(recordPaymentRequestSchema.safeParse({ ...req, amount: "abc" }).success).toBe(false);
  });

  it("accepts an omitted note", () => {
    const result = recordPaymentRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
  });

  it("rejects an amount of zero", () => {
    expect(recordPaymentRequestSchema.safeParse({ ...req, amount: "0" }).success).toBe(false);
  });

  it("rejects an amount of zero with decimals", () => {
    expect(recordPaymentRequestSchema.safeParse({ ...req, amount: "0.00" }).success).toBe(false);
  });

  it("rejects an amount with more than 6 decimal places", () => {
    expect(recordPaymentRequestSchema.safeParse({ ...req, amount: "1.1234567" }).success).toBe(false);
  });

  it("accepts an amount with exactly 6 decimal places", () => {
    expect(recordPaymentRequestSchema.safeParse({ ...req, amount: "1.123456" }).success).toBe(true);
  });

  it("rejects a non-ISO paidAt", () => {
    expect(recordPaymentRequestSchema.safeParse({ ...req, paidAt: "2026-09-14" }).success).toBe(false);
  });
});

describe("subscriptionSchema", () => {
  const subscription = {
    id: "s1", tenantId: "t1", planId: "plan-core", status: "active" as const, billingCycle: "monthly" as const,
    addOnModules: ["hr"], extraSeats: 0, extraBranches: 0, extraWarehouses: 0,
    currentPeriodStart: "2026-09-01T00:00:00.000Z", currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    billingAnchorDay: 1, billingAnchorNeedsReview: false,
    trialEndsAt: null, graceDays: 7, cancelledAt: null,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  };

  it("accepts a valid subscription and preserves it verbatim", () => {
    const result = subscriptionSchema.safeParse(subscription);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(subscription);
  });

  it("rejects a non-integer extraSeats", () => {
    expect(subscriptionSchema.safeParse({ ...subscription, extraSeats: 1.5 }).success).toBe(false);
  });
});

describe("planSchema", () => {
  const plan = {
    id: "p1", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: ["accounting", "sales"],
    features: { "reports.export": true }, seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
    kind: "paid" as const, quotas: { sales_invoices_per_month: 100 },
    priceMonthly: "490.00", priceYearly: "4900.00", trialDays: 14, isPublic: true, sortOrder: 1,
    status: "active" as const, createdAt: "2026-09-01T00:00:00.000Z",
  };

  it("accepts a valid plan and preserves it verbatim", () => {
    const result = planSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(plan);
  });

  it("rejects a negative priceMonthly", () => {
    expect(planSchema.safeParse({ ...plan, priceMonthly: "-1" }).success).toBe(false);
  });
});

describe("planCreateRequestSchema", () => {
  const req = {
    code: "core", nameAr: "الأساسية", nameEn: "Core", modules: ["accounting", "sales"],
    seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
    priceMonthly: "490.00", priceYearly: "4900.00", trialDays: 14, isPublic: true, sortOrder: 1,
  };

  it("accepts a valid request", () => {
    expect(planCreateRequestSchema.safeParse(req).success).toBe(true);
  });

  it("rejects an empty modules list", () => {
    expect(planCreateRequestSchema.safeParse({ ...req, modules: [] }).success).toBe(false);
  });

  it("rejects a price with more than 6 decimal places", () => {
    expect(planCreateRequestSchema.safeParse({ ...req, priceMonthly: "1.1234567" }).success).toBe(false);
  });

  it("accepts a price with exactly 6 decimal places", () => {
    expect(planCreateRequestSchema.safeParse({ ...req, priceMonthly: "1.123456" }).success).toBe(true);
  });

  it("rejects a request missing code", () => {
    const { code, ...rest } = req;
    expect(planCreateRequestSchema.safeParse(rest).success).toBe(false);
  });
});

describe("planUpdateRequestSchema", () => {
  const req = {
    nameAr: "الأساسية", nameEn: "Core", modules: ["accounting", "sales"],
    seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
    priceMonthly: "490.00", priceYearly: "4900.00", trialDays: 14, isPublic: true, sortOrder: 1,
  };

  it("accepts a valid request with no code", () => {
    expect(planUpdateRequestSchema.safeParse(req).success).toBe(true);
  });

  it("rejects an empty modules list", () => {
    expect(planUpdateRequestSchema.safeParse({ ...req, modules: [] }).success).toBe(false);
  });
});

describe("paymentSchema", () => {
  const payment = {
    id: "pay1", tenantId: "t1", subscriptionId: "s1", amount: "490.00", currency: "EGP" as const,
    reference: "REF-1", paidAt: "2026-09-14T00:00:00.000Z", recordedBy: "u1", note: null,
    createdAt: "2026-09-14T00:00:00.000Z",
  };

  it("accepts a valid payment and preserves it verbatim", () => {
    const result = paymentSchema.safeParse(payment);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payment);
  });

  it("rejects a currency other than EGP", () => {
    expect(paymentSchema.safeParse({ ...payment, currency: "USD" }).success).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(paymentSchema.safeParse({ ...payment, amount: "-1" }).success).toBe(false);
  });

  it("rejects a non-ISO paidAt", () => {
    expect(paymentSchema.safeParse({ ...payment, paidAt: "2026-09-14" }).success).toBe(false);
  });
});

describe("licenseStateViewSchema", () => {
  const state = { state: "ACTIVE" as const, canWrite: true, usable: true };

  it("accepts a minimal valid license state", () => {
    expect(licenseStateViewSchema.safeParse(state).success).toBe(true);
  });

  it("accepts the full optional field set", () => {
    const full = {
      state: "GRACE" as const, canWrite: true, usable: true, licensee: "شركة أكمي",
      expiresAt: "2026-09-01T00:00:00.000Z", graceEndsAt: "2026-09-08T00:00:00.000Z", reason: "GRACE_ENDED" as const,
    };
    expect(licenseStateViewSchema.safeParse(full).success).toBe(true);
  });

  it("rejects an unknown state name", () => {
    expect(licenseStateViewSchema.safeParse({ ...state, state: "EXPIRED" }).success).toBe(false);
  });

  it("accepts a TENANT_NOT_FOUND reason, as emitted by apps/server/src/tenant-entitlements.ts", () => {
    const result = licenseStateReasonSchema.safeParse("TENANT_NOT_FOUND");
    expect(result.success).toBe(true);
  });
});

describe("tenantSummarySchema", () => {
  const tenant = {
    id: "t1", code: "acme", nameAr: "شركة أكمي", nameEn: null, ownerEmail: "owner@acme.test",
    ownerContactVerified: true, ownerNeeded: false, pendingOwner: null, status: "active" as const, dbFile: "tenants/acme.db",
    createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:00.000Z",
  };
  const payment = {
    id: "pay1", tenantId: "t1", subscriptionId: "s1", amount: "490.00", currency: "EGP" as const,
    reference: "REF-1", paidAt: "2026-09-14T00:00:00.000Z", recordedBy: "u1", note: null,
    createdAt: "2026-09-14T00:00:00.000Z",
  };
  const summary = {
    tenant, subscription: null, plan: null,
    licenseState: { state: "UNLICENSED" as const, canWrite: false, usable: true },
    entitlements: null,
    payments: [payment],
    books: "bound" as const,
    handOverMailConfigured: false,
  };

  it("accepts a valid tenant summary with null subscription, plan and entitlements", () => {
    expect(tenantSummarySchema.safeParse(summary).success).toBe(true);
  });

  it("accepts an empty payments list, as a list response would send", () => {
    expect(tenantSummarySchema.safeParse({ ...summary, payments: [] }).success).toBe(true);
  });

  it("rejects a summary missing licenseState", () => {
    const { licenseState, ...rest } = summary;
    expect(tenantSummarySchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a summary missing payments", () => {
    const { payments, ...rest } = summary;
    expect(tenantSummarySchema.safeParse(rest).success).toBe(false);
  });
});

describe("the contracts slug regex", () => {
  /**
   * Pinned against `isValidSlug` in packages/domain/src/platform/slug.ts
   * (`^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$`) — contracts cannot import
   * domain, so this table is the cross-package contract.
   */
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ["acme", true],
    ["acme-corp", true],
    ["a1b", true],
    ["a-b-c", true],
    ["a".repeat(32), true],
    ["a", false],
    ["a1", false],
    ["Acme", false],
    ["-acme", false],
    ["acme-", false],
    ["acme_corp", false],
    ["", false],
    ["a".repeat(33), false],
  ];

  it.each(cases)("code %j → valid: %s", (code, expected) => {
    expect(createTenantRequestSchema.shape.code.safeParse(code).success).toBe(expected);
  });
});
