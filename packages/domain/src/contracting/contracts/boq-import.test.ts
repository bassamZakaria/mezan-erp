import { describe, it, expect } from "vitest";
import { reviewBoqImport } from "./boq-import.js";

describe("BOQ Excel import review", () => {
  it("accepts a clean row and reads the Arabic unit label the sheet actually carries", () => {
    const review = reviewBoqImport(
      [{ code: "1.1", descriptionAr: "أعمال الحفر", unit: "م٣", qty: "12,000", unitRate: "185.00", estimatedUnitCost: "120" }],
      [],
    );
    expect(review.acceptedCount).toBe(1);
    expect(review.rows[0]?.value?.unit).toBe("m3");
    expect(review.rows[0]?.value?.qty.toString()).toBe("12000.000000");
    expect(review.rows[0]?.value?.unitRate.toString()).toBe("185.000000");
  });

  it("flags a code the contract already holds, and a code repeated inside the sheet", () => {
    const review = reviewBoqImport(
      [
        { code: "1", descriptionAr: "حفر", unit: "m3", qty: "10", unitRate: "5" },
        { code: "2", descriptionAr: "مباني", unit: "m2", qty: "10", unitRate: "5" },
        { code: "2", descriptionAr: "مباني مكررة", unit: "m2", qty: "10", unitRate: "5" },
      ],
      ["1"],
    );
    expect(review.rows[0]?.accepted).toBe(false);
    expect(review.rows[0]?.problems).toContain('كود البند "1" مكرر');
    expect(review.rows[1]?.accepted).toBe(true);
    expect(review.rows[2]?.accepted).toBe(false);
    expect(review.rows[2]?.problems).toContain('كود البند "2" مكرر');
    expect(review.acceptedCount).toBe(1);
    expect(review.rejectedCount).toBe(2);
  });

  it("flags an unknown unit and a non-numeric quantity rather than inventing one", () => {
    const review = reviewBoqImport(
      [{ code: "3", descriptionAr: "خرسانة", unit: "متر مكعب", qty: "اثنا عشر", unitRate: "1980" }],
      [],
    );
    expect(review.rows[0]?.accepted).toBe(false);
    expect(review.rows[0]?.problems).toContain('وحدة غير معروفة: "متر مكعب"');
    expect(review.rows[0]?.problems).toContain("الكمية غير رقمية");
    expect(review.rows[0]?.value).toBeNull();
  });

  it("refuses a negative quantity or rate, and an unknown cost category", () => {
    const review = reviewBoqImport(
      [{ code: "4", descriptionAr: "بياض", unit: "m2", qty: "-5", unitRate: "-1", costCategory: "مواد" }],
      [],
    );
    expect(review.rows[0]?.problems).toContain("الكمية لا يمكن أن تكون سالبة");
    expect(review.rows[0]?.problems).toContain("الفئة لا يمكن أن تكون سالبة");
    expect(review.rows[0]?.problems).toContain('فئة تكلفة غير معروفة: "مواد"');
  });
});
