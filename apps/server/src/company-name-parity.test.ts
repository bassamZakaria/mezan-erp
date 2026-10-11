import { describe, expect, it } from "vitest";
import { COMPANY_NAME_MAX_LENGTH as DOMAIN_MAX, companyNameProblem, SubscriptionStatusKind, TenantStatusCode } from "@mezan/domain";
import { COMPANY_NAME_MAX_LENGTH as WIRE_MAX, companyNameSchema, SubscriptionStatusCode, TenantWireStatus, updateTenantSettingsSchema } from "@mezan/contracts";

const FORBIDDEN = [
  ...Array.from({ length: 0x20 }, (_, code) => code),
  ...Array.from({ length: 0xa0 - 0x7f }, (_, offset) => 0x7f + offset),
  0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
].map((code) => String.fromCharCode(code));

const KEPT = ["\u200C", "\u200D", "\u200E", "\u200F", "\u061C", "\u00A0", "ـ", "’", "&"];

const WRITTEN_AS_EGYPTIANS_WRITE = ["مخبز ٢٤ ساعة", "شَرِكَةُ النِّيلِ", "مطعم «الأصيل»", "مكتبة \"الشروق\" — فرع ٣", "صيدلية د. منى (المعادي)"];

const SAMPLES = [
  ...WRITTEN_AS_EGYPTIANS_WRITE,
  "",
  "   ",
  "شركة النيل",
  "  شركة النيل  ",
  "ش".repeat(WIRE_MAX),
  "ش".repeat(WIRE_MAX + 1),
  ` ${"ش".repeat(WIRE_MAX)} `,
  ...FORBIDDEN.map((character) => `شركة${character}النيل`),
  ...KEPT.map((character) => `شركة${character}النيل`),
];

describe("the company-name rule is the same on the wire and in the domain", () => {
  it("caps the name at the same length", () => {
    expect(WIRE_MAX).toBe(DOMAIN_MAX);
  });

  it.each(SAMPLES.map((sample) => [JSON.stringify(sample).slice(0, 40), sample]))("agrees on %s", (_shown, sample) => {
    expect(companyNameSchema.safeParse(sample).success).toBe(companyNameProblem(sample) === null);
  });

  it.each(WRITTEN_AS_EGYPTIANS_WRITE)("accepts %s on the wire and in the domain, unchanged", (name) => {
    expect(companyNameProblem(name)).toBeNull();
    expect(companyNameSchema.parse(name)).toBe(name);
  });

  it.each(SAMPLES.map((sample) => [JSON.stringify(sample).slice(0, 40), sample]))("the settings screen's save agrees on %s", (_shown, sample) => {
    expect(updateTenantSettingsSchema.safeParse({ companyName: sample }).success).toBe(companyNameProblem(sample) === null);
  });

  it("still accepts a settings save that does not touch the company name", () => {
    expect(updateTenantSettingsSchema.safeParse({ phone: "0100" }).success).toBe(true);
  });

  it("refuses every forbidden character and keeps every joiner and mark", () => {
    expect(FORBIDDEN.filter((character) => companyNameSchema.safeParse(`a${character}b`).success)).toEqual([]);
    expect(KEPT.filter((character) => !companyNameSchema.safeParse(`a${character}b`).success)).toEqual([]);
  });
});

describe("the closed status sets are the same on the wire and in the domain", () => {
  const storable = (codes: Record<string, string>) => Object.values(codes).filter((code) => code !== "unknown").sort();

  it("names every tenant status the domain can store, plus the read-only unknown", () => {
    expect(storable(TenantWireStatus)).toEqual(Object.values(TenantStatusCode).sort());
    expect(Object.values(TenantStatusCode)).not.toContain(TenantWireStatus.Unknown);
  });

  it("names every subscription status the domain can store, plus the read-only unknown", () => {
    expect(storable(SubscriptionStatusCode)).toEqual(storable(SubscriptionStatusKind));
    expect(Object.values(SubscriptionStatusKind)).not.toContain(SubscriptionStatusCode.Unknown);
  });
});
