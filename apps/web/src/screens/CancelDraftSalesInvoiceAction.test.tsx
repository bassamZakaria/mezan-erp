// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SessionDTO } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { SalesInvoiceDTO } from "../data/hooks";
import { CancelDraftSalesInvoiceAction } from "./CancelDraftSalesInvoiceAction";

const invoice = (status: string) => ({ id: "INV-1", docNo: "SI-000001", status, version: 3 }) as unknown as SalesInvoiceDTO;
const viewer: SessionDTO = { ...testAdminSession, permissions: ["sales.invoice.view"] };
const trigger = () => screen.queryByRole("button", { name: "إلغاء المسودة" });

describe("CancelDraftSalesInvoiceAction", () => {
  it("is offered only on a draft to a caller who may delete drafts", () => {
    for (const [doc, session] of [
      [invoice("confirmed"), testAdminSession],
      [invoice("draft"), viewer],
    ] as const) {
      const { unmount } = renderWithProviders(<CancelDraftSalesInvoiceAction invoice={doc} />, { transport: stubTransport({}), initialSession: session });
      expect(trigger()).toBeNull();
      unmount();
    }
    const { unmount } = renderWithProviders(<CancelDraftSalesInvoiceAction invoice={invoice("draft")} />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(trigger()).not.toBeNull();
    unmount();
  });

  it("confirms, then posts the cancel with the version the screen was served", async () => {
    const sent: unknown[] = [];
    const transport = stubTransport({
      "POST /sales-invoices/*/cancel": (init) => {
        sent.push(JSON.parse((init?.body as string) ?? "{}"));
        return { body: invoice("cancelled") };
      },
    });
    renderWithProviders(<CancelDraftSalesInvoiceAction invoice={invoice("draft")} />, { transport, initialSession: testAdminSession });
    fireEvent.click(trigger()!);
    expect(sent).toEqual([]);
    fireEvent.click(screen.getAllByRole("button", { name: "إلغاء المسودة" }).at(-1)!);
    await waitFor(() => expect(sent).toEqual([{ expectedVersion: 3 }]));
  });
});
