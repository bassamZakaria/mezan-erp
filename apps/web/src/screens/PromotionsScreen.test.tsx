// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PromotionDTO } from "@mezan/contracts";
import { PromotionsScreen } from "./PromotionsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function promotion(overrides: Partial<PromotionDTO> = {}): PromotionDTO {
  return {
    id: "promo-1",
    code: "SUMMER25",
    priority: 1,
    nameAr: "خصم الصيف",
    nameEn: null,
    description: null,
    type: "percentage",
    percentValue: 25,
    amountValue: null,
    minInvoiceValue: null,
    minQty: null,
    maxDiscountAmount: null,
    buyQty: null,
    getQty: null,
    bundleComponents: [],
    requiresCoupon: false,
    dayHourRestriction: null,
    scope: { type: "all", ids: [] },
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PromotionsScreen", () => {
  it("renders the real promotions list from GET /promotions", async () => {
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /promotions": () => ({ body: [promotion()] }) }),
    });
    expect(await screen.findByText("SUMMER25")).toBeInTheDocument();
    expect(screen.getByText("خصم الصيف")).toBeInTheDocument();
    expect(screen.getAllByText("نسبة خصم").length).toBeGreaterThan(0);
  });

  it("shows the real empty state when there are no promotions", async () => {
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /promotions": () => ({ body: [] }) }),
    });
    expect(await screen.findByText("لا توجد عروض")).toBeInTheDocument();
  });

  it("creates a new promotion through POST /promotions and refreshes the list", async () => {
    const user = userEvent.setup();
    let created: unknown = null;
    renderWithProviders(<PromotionsScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /promotions": () => ({ body: created ? [promotion(), created as PromotionDTO] : [promotion()] }),
        "POST /promotions": (init) => {
          const body = JSON.parse(String(init?.body));
          created = promotion({ id: "promo-2", code: body.code, nameAr: body.nameAr, percentValue: body.percentValue });
          return { status: 201, body: created };
        },
      }),
    });

    await screen.findByText("SUMMER25");
    await user.click(screen.getByRole("button", { name: "إضافة عرض" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة عرض" });
    await user.type(within(dialog).getByLabelText("الرمز *"), "WINTER10");
    await user.type(within(dialog).getByLabelText("الاسم *"), "خصم الشتاء");
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "إضافة عرض" })).not.toBeInTheDocument());
    expect(await screen.findByText("WINTER10")).toBeInTheDocument();
  });
});
