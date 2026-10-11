import { describe, expect, it } from "vitest";
import { COMPANY_NAME_MAX_LENGTH as DOMAIN_MAX, companyNameProblem } from "@mezan/domain";
import { COMPANY_NAME_MAX_LENGTH as WIRE_MAX, companyNameSchema } from "@mezan/contracts";

const FORBIDDEN = [
  ...Array.from({ length: 0x20 }, (_, code) => code),
  ...Array.from({ length: 0xa0 - 0x7f }, (_, offset) => 0x7f + offset),
  0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
].map((code) => String.fromCharCode(code));

const KEPT = ["\u200C", "\u200D", "\u200E", "\u200F", "\u061C", "\u00A0", "ـ", "’", "&"];

const SAMPLES = [
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

  it("refuses every forbidden character and keeps every joiner and mark", () => {
    expect(FORBIDDEN.filter((character) => companyNameSchema.safeParse(`a${character}b`).success)).toEqual([]);
    expect(KEPT.filter((character) => !companyNameSchema.safeParse(`a${character}b`).success)).toEqual([]);
  });
});
