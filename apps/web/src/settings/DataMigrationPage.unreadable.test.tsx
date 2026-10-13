// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { DataMigrationPage } from "./DataMigrationPage";

const STATUS = {
  departments: 0, employees: 0, treasuryAccounts: 0, suppliers: 0, customers: 0, items: 0, itemUnits: 0,
  assetCategories: 0, assets: 0, salesInvoices: 0, salesReturns: 0, purchaseInvoices: 0, purchaseReturns: 0,
};

const unhandled: unknown[] = [];
const noteUnhandled = (reason: unknown) => void unhandled.push(reason);
process.on("unhandledRejection", noteUnhandled);
afterEach(() => {
  unhandled.length = 0;
});

function mount() {
  const previews: unknown[] = [];
  const transport = stubTransport({
    "GET /data-migration/status": () => ({ body: STATUS }),
    "POST /data-migration/departments/preview": (init) => {
      previews.push(JSON.parse(String(init?.body)));
      return { body: { validCount: 0, errors: [] } };
    },
  });
  renderWithProviders(<DataMigrationPage />, { transport, initialSession: testAdminSession });
  return previews;
}

describe("a file the import step cannot read", () => {
  it("is refused in Arabic when it is not an Excel workbook, sends nothing, and leaves no failure unhandled", async () => {
    const previews = mount();
    await waitFor(() => expect(screen.getByText("1. الأقسام")).toBeInTheDocument());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(["code,nameAr\nD1,قسم"], "departments.csv", { type: "text/csv" })] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّرت قراءة الملف. ارفع ملف Excel بصيغة ‎.xlsx مبنياً على النموذج الذي تنزّله من هنا.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(previews).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(screen.getByRole("button", { name: "تأكيد الاستيراد" })).toBeDisabled();
  });
});
