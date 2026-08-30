import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeForSearch } from "./search";

/**
 * The samples that matter: each one is a spelling an Egyptian operator
 * actually types for a name stored the other way. If any of these stops
 * folding, a picker goes back to finding nothing (D114).
 */
const FOLDS: [input: string, expected: string][] = [
  ["الأمل", "الامل"],
  ["إبراهيم", "ابراهيم"],
  ["آمال", "امال"],
  ["فاطمة", "فاطمه"],
  ["ليلى", "ليلي"],
  ["مؤسسة", "موسسه"],
  ["شئون", "شيون"],
  ["أحـــمد", "احمد"],
  ["مُحَمَّد", "محمد"],
  ["٢٠٢٦", "2026"],
  ["۲۰۲۶", "2026"],
  ["  CUST-003  ", "cust-003"],
  ["شركة   الأمل", "شركه الامل"],
];

describe("normalizeForSearch", () => {
  it.each(FOLDS)("folds %s to %s", (input, expected) => {
    expect(normalizeForSearch(input)).toBe(expected);
  });

  it("is idempotent — normalising a normalised string changes nothing", () => {
    for (const [input] of FOLDS) {
      const once = normalizeForSearch(input);
      expect(normalizeForSearch(once)).toBe(once);
    }
  });

  it("keeps distinct words distinct — it folds spelling variance, not meaning", () => {
    expect(normalizeForSearch("الاسكندرية")).not.toBe(normalizeForSearch("القاهرة"));
    expect(normalizeForSearch("حسن")).not.toBe(normalizeForSearch("حسين"));
  });
});

describe("matchesSearch", () => {
  it("matches a hamza-less query against a hamza-spelled haystack", () => {
    expect(matchesSearch("الامل", "شركة الأمل للتجارة")).toBe(true);
  });

  it("searches every haystack it is given, and skips the empty ones", () => {
    expect(matchesSearch("cust-002", "مؤسسة النور", "CUST-002")).toBe(true);
    expect(matchesSearch("cust-002", "مؤسسة النور", null, undefined)).toBe(false);
  });

  it("treats a blank query as no filter at all, rather than as a filter matching nothing", () => {
    expect(matchesSearch("   ", "أي شيء")).toBe(true);
    expect(matchesSearch(null, "أي شيء")).toBe(true);
  });

  it("returns false for a query that is genuinely absent", () => {
    expect(matchesSearch("الاسكندرية", "شركة الأمل للتجارة", "CUST-001")).toBe(false);
  });
});
