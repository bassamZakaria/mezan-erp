// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { ProductTemplateDTO, ProductTemplateVariantDTO } from "@mezan/contracts";
import { ProductTemplatesScreen } from "./ProductTemplatesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function template(overrides: Partial<ProductTemplateDTO> = {}): ProductTemplateDTO {
  return {
    id: "t1",
    code: "TSHIRT",
    nameAr: "تيشيرت",
    nameEn: null,
    baseUnitCode: "PCS",
    categoryId: null,
    brand: null,
    costingMethod: "WAC",
    defaultSalePrice: "150.000000",
    defaultCost: "80.000000",
    taxRatePercent: 14,
    attributes: [],
    status: "active",
    ...overrides,
  };
}

function renderScreen(initial: ProductTemplateDTO[] = [template()]) {
  let templates = [...initial];
  const variantsByTemplate: Record<string, ProductTemplateVariantDTO[]> = {};

  const transport = stubTransport({
    "GET /inventory/product-templates": () => ({ body: templates }),
    "POST /inventory/product-templates": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created = template({ id: `t${templates.length + 1}`, ...body, defaultSalePrice: body.defaultSalePrice ?? null, defaultCost: body.defaultCost ?? null });
      templates = [...templates, created];
      return { status: 201, body: created };
    },
    "GET /inventory/product-templates/t1/variants": () => ({ body: variantsByTemplate["t1"] ?? [] }),
    "POST /inventory/product-templates/t1/attributes": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const attribute = { id: "color", nameAr: body.nameAr, nameEn: null, values: body.values };
      templates = templates.map((t) => (t.id === "t1" ? { ...t, attributes: [...t.attributes, attribute] } : t));
      return { status: 201, body: templates.find((t) => t.id === "t1") };
    },
    "POST /inventory/product-templates/t1/variants/generate": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: ProductTemplateVariantDTO[] = body.selections.map((s: { values: Record<string, string> }, i: number) => ({
        id: `v${i + 1}`,
        templateId: "t1",
        itemId: `item-${i + 1}`,
        itemCode: `TSHIRT-${Object.values(s.values).join("-")}`,
        values: s.values,
        createdAt: "2026-07-01T00:00:00.000Z",
      }));
      variantsByTemplate["t1"] = [...(variantsByTemplate["t1"] ?? []), ...created];
      return { status: 201, body: { created, skippedExisting: 0 } };
    },
  });
  return renderWithProviders(<ProductTemplatesScreen />, { transport, initialSession: testAdminSession });
}

describe("ProductTemplatesScreen", () => {
  it("lists product templates from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "قوالب المنتجات" })).toBeInTheDocument();
    expect(await screen.findByText("تيشيرت")).toBeInTheDocument();
  });

  it("shows an empty state when there are no templates yet", async () => {
    renderScreen([]);
    expect(await screen.findByText(/لا توجد قوالب منتجات/)).toBeInTheDocument();
  });

  it("creates a new template through the side panel", async () => {
    renderScreen();
    await screen.findByText("تيشيرت");
    fireEvent.click(screen.getByRole("button", { name: "قالب جديد" }));

    const dialog = screen.getByRole("dialog", { name: "قالب منتج جديد" });
    fireEvent.change(within(dialog).getByLabelText("اسم المنتج *"), { target: { value: "بنطلون" } });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "PANTS" } });
    fireEvent.change(within(dialog).getByLabelText("وحدة القياس الأساسية *"), { target: { value: "PCS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إنشاء" }));

    expect((await screen.findAllByText("بنطلون")).length).toBeGreaterThan(0);
  });

  it("opens a template, adds an attribute, and generates a variant end to end", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("تيشيرت"));

    const detail = screen.getByRole("dialog", { name: "تيشيرت" });
    fireEvent.change(within(detail).getByLabelText("اسم الخاصية"), { target: { value: "اللون" } });
    fireEvent.change(within(detail).getByLabelText("القيم مفصولة بفواصل"), { target: { value: "أحمر, أزرق" } });
    fireEvent.click(within(detail).getByRole("button", { name: "إضافة خاصية" }));

    expect(await within(detail).findByText(/اللون/)).toBeInTheDocument();
    expect(within(detail).getAllByText("أحمر").length).toBeGreaterThan(0);

    // 2 possible combinations, select one and generate.
    const checkboxes = within(detail).getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(within(detail).getByRole("button", { name: /^توليد/ }));

    expect(await within(detail).findByText("TSHIRT-أحمر")).toBeInTheDocument();
  });
});
