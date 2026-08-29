// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { buildDataMigrationTemplate } from "@mezan/ui";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { DataMigrationPage } from "./DataMigrationPage";

/**
 * Builds a real .xlsx File matching the departments step's column order
 * (code, nameAr, nameEn) — reuses the shared template builder so the file's
 * one example data row ("SALES" / "المبيعات") comes pre-filled, exactly like
 * downloading the template from the page and filling in one row by hand.
 */
async function buildDepartmentsFile(): Promise<File> {
  const template = await buildDataMigrationTemplate({
    id: "departments",
    sheetName: "الأقسام",
    columns: [
      { key: "code", header: "الكود", example: "SALES" },
      { key: "nameAr", header: "الاسم", example: "المبيعات" },
      { key: "nameEn", header: "الاسم (إنجليزي)" },
    ],
  });
  return new File([template.data], "departments.xlsx", { type: template.mimeType });
}

describe("DataMigrationPage", () => {
  it("renders all 13 steps with their registered counts, each independently openable", async () => {
    const transport = stubTransport({
      "GET /data-migration/status": () => ({
        body: {
          departments: 1,
          employees: 0,
          treasuryAccounts: 0,
          suppliers: 0,
          customers: 0,
          items: 0,
          itemUnits: 0,
          assetCategories: 0,
          assets: 0,
          salesInvoices: 0,
          salesReturns: 0,
          purchaseInvoices: 0,
          purchaseReturns: 0,
        },
      }),
    });
    renderWithProviders(<DataMigrationPage />, { transport, initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "نقل البيانات" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("مسجّل: 1")).toBeInTheDocument());

    for (const title of [
      "١. الأقسام",
      "٢. الموظفين",
      "٣. حسابات الخزينة",
      "٤. الموردون",
      "٥. العملاء",
      "٦. الأصناف",
      "٧. وحدات الأصناف",
      "٨. تصنيفات الأصول",
      "٩. الأصول",
      "١٠. فواتير المبيعات السابقة",
      "١١. مرتجعات المبيعات السابقة",
      "١٢. فواتير المشتريات السابقة",
      "١٣. مرتجعات المشتريات السابقة",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // First step opens by default (its download/import controls are visible)...
    expect(screen.getAllByRole("button", { name: "تنزيل النموذج" })).toHaveLength(1);
    // ...opening a second step keeps only that step's controls visible (single-open accordion).
    fireEvent.click(screen.getByText("٢. الموظفين"));
    expect(screen.getAllByRole("button", { name: "تنزيل النموذج" })).toHaveLength(1);
  });

  it("previews a department file, blocks commit until the preview is clean, then commits and clears the file", async () => {
    let committed: unknown = null;
    const transport = stubTransport({
      "GET /data-migration/status": () => ({
        body: {
          departments: 0,
          employees: 0,
          treasuryAccounts: 0,
          suppliers: 0,
          customers: 0,
          items: 0,
          itemUnits: 0,
          assetCategories: 0,
          assets: 0,
          salesInvoices: 0,
          salesReturns: 0,
          purchaseInvoices: 0,
          purchaseReturns: 0,
        },
      }),
      "POST /data-migration/departments/preview": () => ({
        body: { validCount: 1, errors: [] },
      }),
      "POST /data-migration/departments/commit": (init) => {
        committed = JSON.parse(init?.body as string);
        return { status: 201, body: { validCount: 1, errors: [], createdIds: ["dept-1"] } };
      },
    });
    renderWithProviders(<DataMigrationPage />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("١. الأقسام")).toBeInTheDocument());

    const commitButton = screen.getByRole("button", { name: "تأكيد الاستيراد" });
    expect(commitButton).toBeDisabled();

    const file = await buildDepartmentsFile();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("1 صف صالح من إجمالي 1.")).toBeInTheDocument());
    expect(commitButton).not.toBeDisabled();

    fireEvent.click(commitButton);
    await waitFor(() => expect(committed).not.toBeNull());
    await waitFor(() => expect(screen.getByText("تم استيراد 1 سجل بنجاح.")).toBeInTheDocument());
  });
});
