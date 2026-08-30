// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PriceListDTO } from "@mezan/contracts";
import { PriceListsScreen } from "./PriceListsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * `Field` renders its `<label>` as a sibling of the control, not wrapping it,
 * and never wires `htmlFor`/`id` — so `getByLabelText` cannot resolve it.
 * Locate the control by walking from the visible label text instead.
 */
function fieldInput(container: HTMLElement, label: string): HTMLElement {
  const labelEl = within(container).getByText(label);
  const control = labelEl.parentElement?.querySelector("input, textarea, select, button[role='switch']");
  if (!control) throw new Error(`no control found for label "${label}"`);
  return control as HTMLElement;
}

function priceList(overrides: Partial<PriceListDTO> = {}): PriceListDTO {
  return {
    id: "pl-1",
    code: "PL-001",
    nameAr: "قائمة الأسعار الأساسية",
    nameEn: null,
    description: null,
    isBase: true,
    active: true,
    lines: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PriceListsScreen", () => {
  it("renders the real price-list list from GET /price-lists", async () => {
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /price-lists": () => ({ body: [priceList()] }) }),
    });
    expect(await screen.findByText("قائمة الأسعار الأساسية")).toBeInTheDocument();
    expect(screen.getByText("PL-001")).toBeInTheDocument();
    expect(screen.getAllByText("قائمة أساسية").length).toBeGreaterThan(0);
  });

  it("shows the real empty state when there are no price lists", async () => {
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /price-lists": () => ({ body: [] }) }),
    });
    expect(await screen.findByText("لا توجد قوائم أسعار — أنشئ قائمة جديدة")).toBeInTheDocument();
  });

  it("creates a new price list through POST /price-lists and refreshes the list", async () => {
    const user = userEvent.setup();
    let created: unknown = null;
    renderWithProviders(<PriceListsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /price-lists": () => ({ body: created ? [priceList(), created as PriceListDTO] : [priceList()] }),
        "POST /price-lists": (init) => {
          const body = JSON.parse(String(init?.body));
          created = priceList({ id: "pl-2", code: body.code, nameAr: body.nameAr, isBase: body.isBase ?? false });
          return { status: 201, body: created };
        },
      }),
    });

    await screen.findByText("قائمة الأسعار الأساسية");
    await user.click(screen.getByRole("button", { name: "قائمة أسعار جديدة" }));

    const dialog = screen.getByRole("dialog", { name: "قائمة أسعار جديدة" });
    await user.type(fieldInput(dialog, "الاسم *"), "قائمة عملاء الجملة");
    await user.type(fieldInput(dialog, "الكود *"), "PL-002");
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "قائمة أسعار جديدة" })).not.toBeInTheDocument());
    expect(await screen.findByText("قائمة عملاء الجملة")).toBeInTheDocument();
  });
});
