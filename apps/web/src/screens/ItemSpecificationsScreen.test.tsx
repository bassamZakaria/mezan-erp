// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactElement } from "react";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { ItemSpecificationDTO } from "@mezan/contracts";
import { ItemSpecificationsScreen } from "./ItemSpecificationsScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * The create/edit form is a sub-page addressed via `useSubPage()`, which
 * reads from `NavigationContext` — there is no router wired up outside
 * `AppLayout`, so a test that opens it needs its own stateful provider (the
 * same pattern BomsScreen.test.tsx and ItemsScreen.test.tsx use).
 */
function WithSubPageNav({ children }: { children: ReactElement }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

/**
 * `TextField` (settings/form-controls.tsx) renders a `<label>` that is never
 * associated with its input via `for`/`id`, so `getByLabelText` can't find
 * these fields. Fall back to the DOM structure the shared `Field` wrapper
 * always uses: a `<label>` immediately followed by its control in the same
 * wrapper `<div>`.
 */
function textFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

function selectOption(trigger: HTMLElement, optionLabel: string) {
  fireEvent.click(trigger);
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

function specification(overrides: Partial<ItemSpecificationDTO> = {}): ItemSpecificationDTO {
  return {
    code: "COLOR",
    nameAr: "اللون",
    nameEn: "Color",
    type: "select",
    values: ["أحمر", "أخضر", "أزرق"],
    unit: null,
    filterable: true,
    status: "active",
    usageCount: 0,
    ...overrides,
  };
}

function trackedTransport(handlers: Record<string, (init: RequestInit | undefined, path: string) => StubResult>) {
  const calls: string[] = [];
  const wrapped: typeof handlers = {};
  for (const [key, fn] of Object.entries(handlers)) {
    wrapped[key] = (init, path) => {
      calls.push(`${key.split(" ")[0]} ${path}`);
      return fn(init, path);
    };
  }
  return { transport: stubTransport(wrapped), calls };
}

function renderScreen(specifications: ItemSpecificationDTO[] = [specification()]) {
  let current = [...specifications];
  const { transport, calls } = trackedTransport({
    "GET /item-specifications": () => ({ body: current }),
    "POST /item-specifications": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((s) => s.code === body.code)) {
        return { status: 409, body: { error: "DUPLICATE_CODE", message: `الكود "${body.code}" مستخدم بالفعل.` } };
      }
      const created: ItemSpecificationDTO = {
        code: body.code,
        nameAr: body.nameAr,
        nameEn: body.nameEn ?? null,
        type: body.type,
        values: body.values ?? [],
        unit: body.unit ?? null,
        filterable: body.filterable ?? false,
        status: "active",
        usageCount: 0,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /item-specifications/COLOR": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      current = current.map((s) => (s.code === "COLOR" ? { ...s, ...patch } : s));
      return { body: current.find((s) => s.code === "COLOR") };
    },
    "DELETE /item-specifications/COLOR": () => {
      current = current.filter((s) => s.code !== "COLOR");
      return { status: 204, body: null };
    },
    "DELETE /item-specifications/USED": () => ({
      status: 409,
      body: { error: "SPECIFICATION_IN_USE", message: "لا يمكن حذف مواصفة مستخدمة في قوالب منتجات." },
    }),
  });
  const result = renderWithProviders(
    <WithSubPageNav>
      <ItemSpecificationsScreen />
    </WithSubPageNav>,
    { transport, initialSession: testAdminSession },
  );
  return { ...result, calls };
}

describe("ItemSpecificationsScreen", () => {
  it("lists specifications from the real GET /item-specifications route", async () => {
    const { calls } = renderScreen([
      specification(),
      specification({ code: "SIZE", nameAr: "المقاس", nameEn: "Size", type: "number", values: [], unit: "سم" }),
    ]);
    expect(screen.getByRole("heading", { name: "المواصفات" })).toBeInTheDocument();
    expect(await screen.findByText("اللون")).toBeInTheDocument();
    expect(screen.getByText("المقاس")).toBeInTheDocument();
    expect(screen.getByText("سم")).toBeInTheDocument();
    expect(calls).toEqual(["GET /item-specifications"]);
  });

  it("shows an honest empty state with no specifications yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد مواصفات — أضف مواصفة جديدة")).toBeInTheDocument();
  });

  it("shows a retry banner when the list fails to load, never a raw error code", async () => {
    const transport = stubTransport({
      "GET /item-specifications": () => ({ status: 500, body: { error: "INTERNAL" } }),
    });
    renderWithProviders(
      <WithSubPageNav>
        <ItemSpecificationsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("تعذّر تحميل المواصفات.")).toBeInTheDocument();
    expect(screen.queryByText(/INTERNAL/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("filters the already-loaded rows by type and search text without a second request", async () => {
    const { calls } = renderScreen([
      specification(),
      specification({ code: "SIZE", nameAr: "المقاس", nameEn: "Size", type: "number", values: [], unit: "سم" }),
    ]);
    await screen.findByText("اللون");

    fireEvent.click(screen.getByRole("tab", { name: /رقم/ }));
    await waitFor(() => expect(screen.queryByText("اللون")).not.toBeInTheDocument());
    expect(screen.getByText("المقاس")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /الكل/ }));
    await screen.findByText("اللون");
    fireEvent.change(screen.getByPlaceholderText("بحث بالكود أو الاسم…"), { target: { value: "اللون" } });
    await waitFor(() => {
      expect(screen.queryByText("المقاس")).not.toBeInTheDocument();
      expect(screen.getByText("اللون")).toBeInTheDocument();
    });

    // Both the type chips and the search box filter the array already in
    // hand — the specification list is small and fully loaded up front.
    expect(calls).toEqual(["GET /item-specifications"]);
  });

  it("creates a new select-type specification with parsed values via POST /item-specifications", async () => {
    let saved: unknown = null;
    let current: ItemSpecificationDTO[] = [];
    const transport = stubTransport({
      "GET /item-specifications": () => ({ body: current }),
      "POST /item-specifications": (init) => {
        saved = JSON.parse((init?.body as string) ?? "{}");
        const created = { ...(saved as object), status: "active", usageCount: 0 } as ItemSpecificationDTO;
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(
      <WithSubPageNav>
        <ItemSpecificationsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مواصفات — أضف مواصفة جديدة");
    // Two "مواصفة جديدة" buttons exist with no rows yet — the header action
    // and the empty state's own — either opens the same create page.
    fireEvent.click(screen.getAllByRole("button", { name: "مواصفة جديدة" })[0]!);

    const page = (await screen.findByRole("heading", { name: "مواصفة جديدة" })).closest("div.w-full") as HTMLElement;
    fireEvent.change(textFieldInput(page, "الكود *"), { target: { value: "color" } });
    fireEvent.change(textFieldInput(page, "الاسم بالعربية *"), { target: { value: "اللون" } });
    fireEvent.change(textFieldInput(page, "الاسم بالإنجليزية"), { target: { value: "Color" } });
    fireEvent.change(textFieldInput(page, "القيم المسموح بها *"), { target: { value: "أحمر، أخضر، أزرق" } });
    fireEvent.click(within(page).getByRole("switch", { name: "قابلة للتصفية في الكتالوج" }));

    fireEvent.click(within(page).getByRole("button", { name: "حفظ" }));

    await waitFor(() =>
      expect(saved).toEqual({
        code: "COLOR",
        nameAr: "اللون",
        nameEn: "Color",
        type: "select",
        values: ["أحمر", "أخضر", "أزرق"],
        unit: null,
        filterable: true,
      }),
    );
    expect(await screen.findByText("اللون")).toBeInTheDocument();
  });

  it("edits an existing specification via PATCH /item-specifications/:code", async () => {
    let saved: unknown = null;
    const transport = stubTransport({
      "GET /item-specifications": () => ({ body: [specification()] }),
      "PATCH /item-specifications/COLOR": (init) => {
        saved = JSON.parse((init?.body as string) ?? "{}");
        return { body: { ...specification(), ...(saved as object) } };
      },
    });
    renderWithProviders(
      <WithSubPageNav>
        <ItemSpecificationsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByRole("button", { name: "تعديل" }));
    const page = (await screen.findByRole("heading", { name: "تعديل المواصفة" })).closest("div.w-full") as HTMLElement;
    const codeInput = textFieldInput(page, "الكود *");
    expect(codeInput).toBeDisabled(); // the code and type are fixed once product templates may bind to them

    fireEvent.change(textFieldInput(page, "الاسم بالعربية *"), { target: { value: "لون المنتج" } });
    fireEvent.click(within(page).getByRole("switch", { name: "نشطة" })); // toggle to inactive
    fireEvent.click(within(page).getByRole("button", { name: "حفظ" }));

    await waitFor(() =>
      expect(saved).toEqual({
        nameAr: "لون المنتج",
        nameEn: "Color",
        values: ["أحمر", "أخضر", "أزرق"],
        unit: null,
        filterable: true,
        status: "inactive",
      }),
    );
  });

  it("rejects an invalid draft locally, in Arabic, without calling the server", async () => {
    const { calls } = renderScreen([]);
    await screen.findByText("لا توجد مواصفات — أضف مواصفة جديدة");
    fireEvent.click(screen.getAllByRole("button", { name: "مواصفة جديدة" })[0]!);
    const page = (await screen.findByRole("heading", { name: "مواصفة جديدة" })).closest("div.w-full") as HTMLElement;

    fireEvent.click(within(page).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "الكود مطلوب — حروف إنجليزية كبيرة أو أرقام أو - أو _ (20 حرفاً كحد أقصى).",
    );
    expect(calls).toEqual(["GET /item-specifications"]);
  });

  it("renders the server's Arabic refusal when creating a duplicate code", async () => {
    renderScreen([specification()]);
    await screen.findByText("اللون");
    fireEvent.click(screen.getByRole("button", { name: "مواصفة جديدة" }));
    const page = (await screen.findByRole("heading", { name: "مواصفة جديدة" })).closest("div.w-full") as HTMLElement;

    fireEvent.change(textFieldInput(page, "الكود *"), { target: { value: "COLOR" } });
    fireEvent.change(textFieldInput(page, "الاسم بالعربية *"), { target: { value: "لون آخر" } });
    fireEvent.change(textFieldInput(page, "القيم المسموح بها *"), { target: { value: "أبيض" } });
    fireEvent.click(within(page).getByRole("button", { name: "حفظ" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('الكود "COLOR" مستخدم بالفعل.');
    expect(alert).not.toHaveTextContent("DUPLICATE_CODE");
  });

  it("deletes an unused specification via DELETE /item-specifications/:code", async () => {
    renderScreen([specification()]);
    await screen.findByText("اللون");
    fireEvent.click(screen.getByRole("button", { name: "حذف اللون" }));
    await waitFor(() => expect(screen.queryByText("اللون")).not.toBeInTheDocument());
  });

  it("disables deletion for a specification still used by a product template", async () => {
    renderScreen([specification({ code: "USED", nameAr: "مواصفة مستخدمة", usageCount: 3 })]);
    await screen.findByText("مواصفة مستخدمة");
    expect(screen.getByRole("button", { name: "حذف مواصفة مستخدمة" })).toBeDisabled();
  });
});
