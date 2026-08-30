// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import type { ProductTemplateDTO, ProductTemplateVariantDTO } from "@mezan/contracts";
import { ProductTemplatesScreen } from "./ProductTemplatesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * `Field` renders its `<label>` as a sibling of the control, not wrapping it,
 * and never wires `htmlFor`/`id` — so `getByLabelText` cannot resolve a
 * `TextField`. Locate the control by walking from the visible label text.
 */
function fieldInput(container: HTMLElement, label: string): HTMLElement {
  const labelEl = within(container).getByText(label);
  const control = labelEl.parentElement?.querySelector("input, textarea, select");
  if (!control) throw new Error(`no control found for label "${label}"`);
  return control as HTMLElement;
}

/**
 * The create/detail forms are sub-pages addressed via `useSubPage()`, which
 * reads from `NavigationContext` — there is no router wired up outside
 * `AppLayout`, so a test that opens one needs its own stateful provider.
 */
function WithSubPageNav({ children }: { children: ReactElement }) {
  const [segments, setSegments] = useState<string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: (next) => setSegments([...next]),
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

function template(overrides: Partial<ProductTemplateDTO> = {}): ProductTemplateDTO {
  return {
    id: "t1",
    code: "TSHIRT",
    nameAr: "تيشيرت",
    nameEn: null,
    baseUnitCode: "PCS",
    categoryId: null,
    brandId: null,
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
  return renderWithProviders(
    <WithSubPageNav>
      <ProductTemplatesScreen />
    </WithSubPageNav>,
    { transport, initialSession: testAdminSession },
  );
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

  it("creates a new template through the create sub-page", async () => {
    renderScreen();
    await screen.findByText("تيشيرت");
    fireEvent.click(screen.getByRole("button", { name: "قالب جديد" }));

    expect(screen.getByRole("heading", { name: "قالب منتج جديد" })).toBeInTheDocument();
    const body = screen.getByRole("heading", { name: "قالب منتج جديد" }).closest("div.w-full") as HTMLElement;
    fireEvent.change(fieldInput(body, "اسم المنتج *"), { target: { value: "بنطلون" } });
    fireEvent.change(fieldInput(body, "الكود *"), { target: { value: "PANTS" } });
    fireEvent.change(fieldInput(body, "وحدة القياس الأساسية *"), { target: { value: "PCS" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء" }));

    expect(await screen.findByRole("heading", { name: "بنطلون" })).toBeInTheDocument();
  });

  it("opens a template, adds an attribute, and generates a variant end to end", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("تيشيرت"));

    expect(screen.getByRole("heading", { name: "تيشيرت" })).toBeInTheDocument();
    const detail = screen.getByRole("heading", { name: "تيشيرت" }).closest("div.w-full") as HTMLElement;
    fireEvent.change(fieldInput(detail, "اسم الخاصية"), { target: { value: "اللون" } });
    fireEvent.change(fieldInput(detail, "القيم مفصولة بفواصل"), { target: { value: "أحمر, أزرق" } });
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
