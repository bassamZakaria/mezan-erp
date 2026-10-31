import { describe, expect, it } from "vitest";
import { filterPickerOptions, type PickerOption } from "./picker-options";

const options: PickerOption[] = [
  { id: "1", label: "الفرع الرئيسي", sublabel: "BR-MAIN" },
  { id: "2", label: "فرع الإسكندرية", sublabel: "BR-ALX" },
];

describe("filterPickerOptions", () => {
  it("returns every option for a blank query", () => {
    expect(filterPickerOptions(options, "  ")).toHaveLength(2);
  });

  it("matches on the label", () => {
    expect(filterPickerOptions(options, "الإسكندرية")).toEqual([options[1]]);
  });

  it("matches on the sublabel, case-insensitively", () => {
    expect(filterPickerOptions(options, "br-main")).toEqual([options[0]]);
  });

  it("returns nothing for a query that matches neither", () => {
    expect(filterPickerOptions(options, "قاهرة")).toEqual([]);
  });
});
