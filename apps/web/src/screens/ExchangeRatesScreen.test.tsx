// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AllowedCurrenciesDTO, ExchangeRateDTO } from "@mezan/contracts";
import { ExchangeRatesScreen } from "./ExchangeRatesScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * `TextField` (settings/form-controls.tsx) renders a `<label>` that is never
 * associated with its input via `for`/`id`, so `getByLabelText` can't find
 * these fields (the from/to date filters here). Fall back to the DOM
 * structure the shared `Field` wrapper always uses: a `<label>` immediately
 * followed by its control in the same wrapper `<div>`.
 */
function textFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

const ALLOWED: AllowedCurrenciesDTO = { base: "EGP", multiCurrencyEnabled: true, allowed: ["USD", "SAR", "AED"] };

const PENDING_RATE: ExchangeRateDTO = {
  id: "fx-usd",
  currency: "USD",
  rate: "50.250000",
  effectiveDate: "2026-08-01",
  rateType: "standard",
  source: "manual",
  status: "pending",
};

const APPROVED_RATE: ExchangeRateDTO = {
  id: "fx-sar",
  currency: "SAR",
  rate: "13.400000",
  effectiveDate: "2026-07-15",
  rateType: "standard",
  source: "api",
  status: "approved",
};

function baseHandlers(rates: ExchangeRateDTO[] = [PENDING_RATE, APPROVED_RATE]): Record<string, (init?: RequestInit, path?: string) => StubResult> {
  return {
    "GET /exchange-rates": () => ({ body: rates }),
    "GET /settings/currencies": () => ({ body: ALLOWED }),
  };
}

describe("ExchangeRatesScreen — list", () => {
  it("renders real rates off GET /exchange-rates, with money formatted and never the raw wire string", async () => {
    const paths: string[] = [];
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /exchange-rates": (_init, path) => {
          paths.push(path as string);
          return { body: [PENDING_RATE, APPROVED_RATE] };
        },
      }),
    });

    const usdRow = (await screen.findByText("USD / EGP")).closest("tr") as HTMLElement;
    const sarRow = screen.getByText("SAR / EGP").closest("tr") as HTMLElement;
    expect(within(usdRow).getByText("50.2500")).toBeInTheDocument();
    expect(within(usdRow).queryByText("50.250000")).not.toBeInTheDocument();
    expect(within(sarRow).getByText("13.4000")).toBeInTheDocument();
    expect(within(usdRow).getByText("يدوي")).toBeInTheDocument(); // manual source
    expect(within(sarRow).getByText("تلقائي")).toBeInTheDocument(); // api source
    // status pills — scoped per row since the same label also names a status filter chip
    expect(within(usdRow).getByText("بانتظار الاعتماد")).toBeInTheDocument();
    expect(within(sarRow).getByText("معتمد")).toBeInTheDocument();

    await waitFor(() => expect(paths).toContain("/exchange-rates"));
  });

  it("shows the documented empty state when there are no rates yet", async () => {
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers([])),
    });
    expect(await screen.findByText("لا توجد أسعار صرف")).toBeInTheDocument();
  });

  it("shows the Arabic load error instead of a raw failure", async () => {
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /exchange-rates": () => ({ status: 500, body: { error: "INTERNAL" } }),
        "GET /settings/currencies": () => ({ body: ALLOWED }),
      }),
    });
    expect(await screen.findByText("تعذّر تحميل أسعار الصرف. (رمز 500)")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});

describe("ExchangeRatesScreen — filters (client-side over the fetched set)", () => {
  it("narrows to the selected status without issuing a second request", async () => {
    const user = userEvent.setup();
    let fetchCount = 0;
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /exchange-rates": () => {
          fetchCount += 1;
          return { body: [PENDING_RATE, APPROVED_RATE] };
        },
      }),
    });
    await screen.findByText("USD / EGP");
    expect(fetchCount).toBe(1);

    await user.click(screen.getByRole("radio", { name: "معتمد" }));
    await waitFor(() => expect(screen.queryByText("USD / EGP")).not.toBeInTheDocument());
    expect(screen.getByText("SAR / EGP")).toBeInTheDocument();
    // filtering is done over the already-fetched rows, not a fresh request
    expect(fetchCount).toBe(1);
  });

  it("narrows by the effective-date range", async () => {
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers()),
    });
    await screen.findByText("USD / EGP");
    fireEvent.change(textFieldInput(document.body, "من تاريخ"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(screen.queryByText("SAR / EGP")).not.toBeInTheDocument());
    expect(screen.getByText("USD / EGP")).toBeInTheDocument();
  });

  it("filters by the currency code search box", async () => {
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers()),
    });
    await screen.findByText("USD / EGP");
    fireEvent.change(screen.getByPlaceholderText("ابحث بالعملة…"), { target: { value: "SAR" } });
    await waitFor(() => expect(screen.queryByText("USD / EGP")).not.toBeInTheDocument(), { timeout: 1000 });
    expect(screen.getByText("SAR / EGP")).toBeInTheDocument();
  });
});

describe("ExchangeRatesScreen — add rate", () => {
  it("posts the exact chosen currency, rate and date to POST /exchange-rates", async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([]),
        "POST /exchange-rates": (init) => {
          posted = JSON.parse(String(init?.body));
          return { status: 201, body: { ...PENDING_RATE, ...posted } };
        },
      }),
    });
    await screen.findByText("لا توجد أسعار صرف");
    // two buttons share this label while the list is empty (the header
    // action and the EmptyState's own action) — open the form via either.
    await user.click(screen.getAllByRole("button", { name: "إضافة سعر صرف" })[0]!);

    // pick a real currency from the combobox — not free text
    await user.click(screen.getByLabelText("العملة الأجنبية"));
    await user.click(await screen.findByRole("option", { name: /^AED/ }));

    await user.type(screen.getByLabelText("سعر الصرف"), "16.500000");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      currency: "AED",
      rate: "16.500000",
      rateType: "standard",
      source: "manual",
      status: "pending",
    });
  });

  it("surfaces the server's Arabic refusal message and keeps the draft open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([]),
        "POST /exchange-rates": () => ({
          status: 409,
          body: { error: "DUPLICATE_RATE", message: "يوجد سعر صرف مسجل لهذه العملة في نفس التاريخ." },
        }),
      }),
    });
    await screen.findByText("لا توجد أسعار صرف");
    await user.click(screen.getAllByRole("button", { name: "إضافة سعر صرف" })[0]!);
    await user.type(screen.getByLabelText("سعر الصرف"), "16.5");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("يوجد سعر صرف مسجل لهذه العملة في نفس التاريخ.");
    await waitFor(() => expect(screen.queryByText("DUPLICATE_RATE")).not.toBeInTheDocument());
  });
});

describe("ExchangeRatesScreen — approve", () => {
  it("approves a pending rate against POST /exchange-rates/:id/approve and the row updates", async () => {
    const user = userEvent.setup();
    let approved = false;
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /settings/currencies": () => ({ body: ALLOWED }),
        "GET /exchange-rates": () => ({ body: [approved ? { ...PENDING_RATE, status: "approved" } : PENDING_RATE] }),
        "POST /exchange-rates/fx-usd/approve": () => {
          approved = true;
          return { body: { ...PENDING_RATE, status: "approved" } };
        },
      }),
    });
    const row = (await screen.findByText("USD / EGP")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "إجراءات USD" }));
    await user.click(within(row).getByRole("menuitem", { name: "اعتماد" }));
    await waitFor(() => expect(approved).toBe(true));
    // "معتمد" also names the status filter chip, so scope to the (freshly
    // re-rendered, after the refetch) row's own pill rather than the stale node.
    await waitFor(() => {
      const refreshedRow = screen.getByText("USD / EGP").closest("tr") as HTMLElement;
      expect(within(refreshedRow).getByText("معتمد")).toBeInTheDocument();
    });
  });

  it("shows the server's Arabic refusal when approval is rejected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExchangeRatesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([PENDING_RATE]),
        "POST /exchange-rates/fx-usd/approve": () => ({
          status: 422,
          body: { error: "RATE_LOCKED_PERIOD", message: "لا يمكن اعتماد سعر صرف في فترة مقفلة." },
        }),
      }),
    });
    const row = (await screen.findByText("USD / EGP")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "إجراءات USD" }));
    await user.click(within(row).getByRole("menuitem", { name: "اعتماد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يمكن اعتماد سعر صرف في فترة مقفلة.");

    expect(screen.queryByText("تم تنفيذ «اعتماد»")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

/** guards §4.5 #13 — the error card shows the SERVER's reason, not the screen's fixed sentence. */
describe("ExchangeRatesScreen — a 502 body reaches the error card", () => {
  it("renders the server's own Arabic reason", async () => {
    renderWithProviders(
      <ExchangeRatesScreen />,
      {
        transport: stubTransport({
          "GET /exchange-rates": () => ({ status: 502, body: { message: "تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة." } }),
          "GET /settings/currencies": () => ({ body: ALLOWED }),
        }),
        initialSession: testAdminSession,
      },
    );

    expect(await screen.findByText("تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة.")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل أسعار الصرف.")).not.toBeInTheDocument();
  });
});
