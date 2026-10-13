import { describe, expect, it } from "vitest";
import { printIdentityConfigSchema } from "@mezan/contracts";
import { BodyLimitBytes, bodyLimitFor } from "./body-limit.js";

describe("how large a body each route may send", () => {
  it.each([
    "/attachments",
    "/sales-invoices/INV-1/attachments",
    "/data-migration/items/preview",
    "/data-migration/items/commit",
    "/bank-statements/import",
    "/bank-statements/import-file",
    "/hr/attendance/import/preview",
    "/hr/attendance/import/commit",
    "/hr/self/clock",
    "/contracting/contracts/C-1/boq/import",
    "/contracting/contracts/C-1/boq/import/commit",
  ])("gives a signed-in caller room for a file on %s", (path) => {
    expect(bodyLimitFor(path, true)).toBe(BodyLimitBytes.Upload);
  });

  it.each(["/sales/historical-import", "/purchases/historical-import"])(
    "gives the preview of %s the same room as its commit",
    (mount) => {
      expect(bodyLimitFor(`${mount}/preview`, true)).toBe(BodyLimitBytes.Upload);
      expect(bodyLimitFor(`${mount}/commit`, true)).toBe(bodyLimitFor(`${mount}/preview`, true));
    },
  );

  it.each(["/users", "/users/u-1", "/profile", "/profile/change-pin", "/settings", "/pos/settings", "/label-layouts", "/print-templates", "/print-templates/sales_invoice", "/sales-invoices", "/vouchers"])(
    "holds a signed-in caller to a document's size on %s",
    (path) => {
      expect(bodyLimitFor(path, true)).toBe(BodyLimitBytes.Document);
    },
  );

  it("holds an anonymous caller to 64 KiB on every route, files included", () => {
    for (const path of ["/auth/login", "/attachments", "/data-migration/items/commit", "/sales/historical-import/preview"]) {
      expect(bodyLimitFor(path, false)).toBe(BodyLimitBytes.Anonymous);
    }
  });

  it("caps a print template's logo well inside a document's size", () => {
    const identity = { logoPosition: "center", logoSize: "medium", primaryColor: "#0f766e" };

    expect(printIdentityConfigSchema.safeParse({ ...identity, logoUrl: `data:image/png;base64,${"A".repeat(200_000)}` }).success).toBe(true);
    expect(printIdentityConfigSchema.safeParse({ ...identity, logoUrl: `data:image/png;base64,${"A".repeat(300_000)}` }).success).toBe(false);
  });
});
