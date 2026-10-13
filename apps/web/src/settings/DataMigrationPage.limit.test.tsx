// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { IMPORT_ROW_LIMIT, importTooLargeMessage } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { DataMigrationPage } from "./DataMigrationPage";

const parsedRows = vi.hoisted(() => ({ count: 0 }));

vi.mock("@mezan/ui", async (original) => ({
  ...(await original<typeof import("@mezan/ui")>()),
  parseDataMigrationFile: async () => ({
    rows: Array.from({ length: parsedRows.count }, (_, i) => ({ code: `D${i}`, nameAr: `قسم ${i}` })),
    errors: [],
  }),
}));

const STATUS = {
  departments: 0, employees: 0, treasuryAccounts: 0, suppliers: 0, customers: 0, items: 0, itemUnits: 0,
  assetCategories: 0, assets: 0, salesInvoices: 0, salesReturns: 0, purchaseInvoices: 0, purchaseReturns: 0,
};

function mount() {
  const previews: number[] = [];
  const transport = stubTransport({
    "GET /data-migration/status": () => ({ body: STATUS }),
    "POST /data-migration/departments/preview": (init) => {
      const rows = (JSON.parse(String(init?.body)) as { rows: unknown[] }).rows.length;
      previews.push(rows);
      return { body: { validCount: rows, errors: [] } };
    },
  });
  renderWithProviders(<DataMigrationPage />, { transport, initialSession: testAdminSession });
  return previews;
}

async function choose(rows: number) {
  parsedRows.count = rows;
  await waitFor(() => expect(screen.getByText("1. الأقسام")).toBeInTheDocument());
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "departments.xlsx")] } });
}

beforeEach(() => {
  parsedRows.count = 0;
});

describe("the import steps and the row limit", () => {
  it("state the limit, from the shared constant, before any file is chosen", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("1. الأقسام")).toBeInTheDocument());

    expect(screen.getByText(new RegExp(`الحد الأقصى للاستيراد في المرة الواحدة ${IMPORT_ROW_LIMIT} صف`))).toBeInTheDocument();
  });

  it("refuse a file one row over the limit on this machine, in the server's sentence, and send nothing", async () => {
    const previews = mount();
    await choose(IMPORT_ROW_LIMIT + 1);

    expect(await screen.findByRole("alert")).toHaveTextContent(importTooLargeMessage(IMPORT_ROW_LIMIT + 1).ar);
    expect(previews).toEqual([]);
    expect(screen.getByRole("button", { name: "تأكيد الاستيراد" })).toBeDisabled();
  });

  it("send a file exactly at the limit for preview", async () => {
    const previews = mount();
    await choose(IMPORT_ROW_LIMIT);

    await waitFor(() => expect(previews).toEqual([IMPORT_ROW_LIMIT]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
