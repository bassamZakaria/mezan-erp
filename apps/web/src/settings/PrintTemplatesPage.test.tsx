// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { DEFAULT_PRINT_TEMPLATE_CONFIG } from "@mezan/ui";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { PrintTemplatesPage } from "./PrintTemplatesPage";

describe("PrintTemplatesPage", () => {
  it("loads the saved config, renders the live preview with a real amount-in-words, and shows every one of the 9 tabs", async () => {
    const transport = stubTransport({
      "GET /print-template-config": () => ({ body: DEFAULT_PRINT_TEMPLATE_CONFIG }),
    });
    renderWithProviders(<PrintTemplatesPage />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByText("فاتورة مبيعات")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "قوالب الطباعة" })).toBeInTheDocument();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
    expect(
      screen.getByText("ألف ومائة وتسعة وخمسون جنيه مصري وخمسة وتسعون قرش فقط لا غير"),
    ).toBeInTheDocument();

    for (const label of ["الهوية", "الترويسة", "المحتوى", "أعمدة الأصناف", "الإجماليات", "التذييل", "العلامة المائية", "إيصال نقطة البيع", "تخصيص حسب الوثيقة"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("toggling a field marks the page dirty and PUTs the full config on save", async () => {
    let saved: unknown = null;
    const transport = stubTransport({
      "GET /print-template-config": () => ({ body: DEFAULT_PRINT_TEMPLATE_CONFIG }),
      "PUT /print-template-config": (init) => {
        saved = JSON.parse(init?.body as string);
        return { body: saved };
      },
    });
    renderWithProviders(<PrintTemplatesPage />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("فاتورة مبيعات")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "الترويسة" }));
    fireEvent.click(screen.getByRole("switch", { name: "العنوان" }));
    expect(screen.getByText("تغييرات غير محفوظة")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حفظ القالب" }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect((saved as { header: { showAddress: boolean } }).header.showAddress).toBe(false);
    await waitFor(() => expect(screen.queryByText("تغييرات غير محفوظة")).not.toBeInTheDocument());
  });
});
