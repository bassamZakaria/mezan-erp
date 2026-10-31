import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { PlanKind, PlanStatusCode, topPublicPaidPlan, type Plan } from "./plan.js";
import { BillingCycleKind } from "./subscription.js";
import { TenantStatusCode } from "./tenant.js";
import { SignupDecision, SignupRequestStatus, VERIFIED_LINK_VALID_MS, verifySignup, type SignupRequest, type SignupRequestRepository } from "./signup.js";
import { SignupAlreadyActivatedError, SignupTokenExpiredError } from "./errors.js";
import type { Tenant } from "./tenant.js";

const VERIFIED_AT = "2026-01-01T00:00:00.000Z";
const AFTER_HOLD = new Date(new Date(VERIFIED_AT).getTime() + VERIFIED_LINK_VALID_MS + 1000).toISOString();

function repoWith(request: SignupRequest): SignupRequestRepository {
  return { findByTokenHash: async () => request } as unknown as SignupRequestRepository;
}

const request = (decision: SignupDecision | null): SignupRequest => ({
  id: "R1", code: "late", nameAr: "منشأة", nameEn: null, ownerEmail: "o@late.example", ownerNameAr: "سارة", planId: "P1",
  billingCycle: BillingCycleKind.Monthly, tokenHash: "h", status: SignupRequestStatus.Verified, expiresAt: VERIFIED_AT, createdAt: VERIFIED_AT, verifiedAt: VERIFIED_AT, decision,
});

const noCompany = { findByCode: async () => null };
const aCompany = { findByCode: async () => ({ code: "late", status: TenantStatusCode.Active }) as unknown as Tenant };

describe("a verified sign-up link opened after its hold", () => {
  it("reports a lapsed request, not an account, when nobody approved it", async () => {
    await expect(verifySignup("h", repoWith(request(null)), AFTER_HOLD, noCompany)).rejects.toThrow(SignupTokenExpiredError);
  });

  it("still points an approved one to signing in", async () => {
    await expect(verifySignup("h", repoWith(request(SignupDecision.Approved)), AFTER_HOLD, aCompany)).rejects.toThrow(SignupAlreadyActivatedError);
  });
});

describe("the package a self-serve trial runs on", () => {
  const plan = (id: string, sortOrder: number, soldOut = false): Plan => ({
    id, code: id.toLowerCase(), nameAr: id, nameEn: id, kind: PlanKind.Paid, modules: ["sales"], features: {}, quotas: {},
    seatsIncluded: 1, branchesIncluded: 1, warehousesIncluded: 1, priceMonthly: Money.fromMajor("100"), priceYearly: Money.fromMajor("1000"),
    trialDays: 14, isPublic: true, soldOut, sortOrder, status: PlanStatusCode.Active, createdAt: VERIFIED_AT,
  });

  it("skips a sold-out top package for the next one down", () => {
    expect(topPublicPaidPlan([plan("CORE", 1), plan("TOP", 3, true), plan("MID", 2)])?.id).toBe("MID");
  });
});
