// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { bilingualName, employeeDisplayName } from "./hr-employee-name";

describe("employeeDisplayName", () => {
  it("reads the Arabic name for an ar reader when both scripts are present", () => {
    expect(
      employeeDisplayName({ firstName: "Ahmed", lastName: "Hassan", firstNameAr: "أحمد", lastNameAr: "حسن" }, "ar"),
    ).toBe("أحمد حسن");
  });

  it("reads the English name for an en reader when both scripts are present", () => {
    expect(
      employeeDisplayName({ firstName: "Ahmed", lastName: "Hassan", firstNameAr: "أحمد", lastNameAr: "حسن" }, "en"),
    ).toBe("Ahmed Hassan");
  });

  it("falls back to English for an ar reader when the Arabic name is blank", () => {
    expect(
      employeeDisplayName({ firstName: "Ahmed", lastName: "Hassan", firstNameAr: null, lastNameAr: null }, "ar"),
    ).toBe("Ahmed Hassan");
  });

  it("falls back to Arabic for an en reader when the English name is blank", () => {
    expect(
      employeeDisplayName({ firstName: "", lastName: "", firstNameAr: "أحمد", lastNameAr: "حسن" }, "en"),
    ).toBe("أحمد حسن");
  });

  it("joins only the parts that are present, trimming stray whitespace", () => {
    expect(employeeDisplayName({ firstName: "Ahmed", lastName: "", firstNameAr: null, lastNameAr: null }, "en")).toBe(
      "Ahmed",
    );
  });

  it("returns an empty string when both scripts are entirely blank", () => {
    expect(employeeDisplayName({ firstName: "", lastName: "", firstNameAr: null, lastNameAr: null }, "ar")).toBe("");
  });
});

describe("bilingualName", () => {
  it("reads the Arabic name for an ar reader", () => {
    expect(bilingualName({ name: "Sales", nameAr: "المبيعات" }, "ar")).toBe("المبيعات");
  });

  it("falls back to the English name for an ar reader when nameAr is null", () => {
    expect(bilingualName({ name: "Sales", nameAr: null }, "ar")).toBe("Sales");
  });

  it("reads the English name for an en reader", () => {
    expect(bilingualName({ name: "Sales", nameAr: "المبيعات" }, "en")).toBe("Sales");
  });

  it("falls back to the Arabic name for an en reader when name is empty", () => {
    expect(bilingualName({ name: "", nameAr: "المبيعات" }, "en")).toBe("المبيعات");
  });

  it("falls back to an empty string for an en reader when both are blank", () => {
    expect(bilingualName({ name: "", nameAr: null }, "en")).toBe("");
  });
});
