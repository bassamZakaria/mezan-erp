// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AllowedCurrenciesDTO,
  CurrencyBalanceGroupDTO,
  FxRevaluationDetailDTO,
  FxRevaluationPostResultDTO,
  FxRevaluationPreviewDTO,
  PartyCurrencyBalanceReportDTO,
} from "@mezan/contracts";
import { FxRevaluationScreen } from "./FxRevaluationScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { monthEndIso } from "../lib/dates";

const ALLOWED: AllowedCurrenciesDTO = { base: "EGP", multiCurrencyEnabled: true, allowed: ["USD", "SAR"] };

const DETAIL: FxRevaluationDetailDTO = {
  accountId: "1310",
  currency: "USD",
  label: "بنك مصر بالدولار",
  foreignAmount: "1000.000000",
  bookedBase: "47500.000000",
  closingRate: "50.250000",
  revaluedBase: "50250.000000",
  delta: "2750.000000",
  gainLoss: "2750.000000",
};

function preview(overrides: Partial<FxRevaluationPreviewDTO> = {}): FxRevaluationPreviewDTO {
  return {
    date: monthEndIso(),
    autoReverse: true,
    reversalDate: "2026-09-01",
    details: [DETAIL],
    totalGain: "2750.000000",
    totalLoss: "0.000000",
    hasImpact: true,
    ...overrides,
  };
}

const EMPTY_BALANCES: PartyCurrencyBalanceReportDTO = {
  baseCurrency: "EGP",
  receivables: [],
  payables: [],
  receivableTotalBase: "0",
  payableTotalBase: "0",
};

const NO_RUNS = (): StubResult => ({ body: { runs: [] } });

function balancesHandlers(body: PartyCurrencyBalanceReportDTO = EMPTY_BALANCES): Record<string, () => StubResult> {
  return {
    "GET /settings/currencies": () => ({ body: ALLOWED }),
    "GET /gl/balances-by-currency": () => ({ body }),
    "GET /revaluation/runs": NO_RUNS,
  };
}

describe("FxRevaluationScreen — preview", () => {
  it("shows the press-preview placeholder before any preview has run", async () => {
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(balancesHandlers()),
    });
    expect(await screen.findByText('اضغط "معاينة" لعرض الأرصدة المفتوحة وحساب فروق العملة.')).toBeInTheDocument();
  });

  it("sends the exact default request body and renders the formatted money columns, never the raw wire strings", async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /revaluation/runs": NO_RUNS,
        ...balancesHandlers(),
        "POST /revaluation/preview": (init) => {
          posted = JSON.parse(String(init?.body));
          return { body: preview() };
        },
      }),
    });
    await user.click(screen.getByRole("button", { name: "معاينة" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toEqual({ date: monthEndIso(), currencies: [], autoReverse: true });

    expect(await screen.findByText("بنك مصر بالدولار")).toBeInTheDocument();
    expect(screen.getByText("1,000.00")).toBeInTheDocument(); // foreign balance
    expect(screen.getByText("50.2500")).toBeInTheDocument(); // closing rate, 4dp
    expect(screen.getByText("47,500.00")).toBeInTheDocument(); // carrying value
    expect(screen.getByText("50,250.00")).toBeInTheDocument(); // after revaluation
    expect(screen.getAllByText("2,750.00").length).toBeGreaterThan(0); // gain/loss + totals stat
    expect(screen.queryByText("1000.000000")).not.toBeInTheDocument();
    expect(screen.queryByText("50.250000")).not.toBeInTheDocument();
  });

  it("restricts the preview to the toggled currency chips", async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /revaluation/runs": NO_RUNS,
        ...balancesHandlers(),
        "POST /revaluation/preview": (init) => {
          posted = JSON.parse(String(init?.body));
          return { body: preview() };
        },
      }),
    });
    await user.click(screen.getByRole("button", { name: "USD" }));
    await user.click(screen.getByRole("button", { name: "معاينة" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ currencies: ["USD"] });
  });

  it("sends autoReverse:false once the checkbox is unchecked", async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /revaluation/runs": NO_RUNS,
        ...balancesHandlers(),
        "POST /revaluation/preview": (init) => {
          posted = JSON.parse(String(init?.body));
          return { body: preview({ autoReverse: false }) };
        },
      }),
    });
    await user.click(screen.getByRole("checkbox", { name: /العكس التلقائي/ }));
    await user.click(screen.getByRole("button", { name: "معاينة" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ autoReverse: false });
  });

  it("sends the chosen as-of date", async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /revaluation/runs": NO_RUNS,
        ...balancesHandlers(),
        "POST /revaluation/preview": (init) => {
          posted = JSON.parse(String(init?.body));
          return { body: preview({ date: "2026-01-31" }) };
        },
      }),
    });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-01-31" } });
    await user.click(screen.getByRole("button", { name: "معاينة" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ date: "2026-01-31" });
  });

  it("shows the Arabic fallback message when the preview request fails without a server message", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /revaluation/runs": NO_RUNS,
        ...balancesHandlers(),
        "POST /revaluation/preview": () => ({ status: 500, body: { error: "INTERNAL" } }),
      }),
    });
    await user.click(screen.getByRole("button", { name: "معاينة" }));
    // the fallback text actually shown comes from useFxRevaluationPreview's
    // own `t("api.theRevaluationCouldNotBe")` (apps/web/src/data/hooks.ts),
    // which carries a shadda the screen's own dead local fallback (audit of
    // `t("fx.theRevaluationCouldNotBe")`) does not.
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر حساب إعادة التقييم.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });
});

describe("FxRevaluationScreen — post", () => {
  function postResult(overrides: Partial<FxRevaluationPostResultDTO> = {}): FxRevaluationPostResultDTO {
    return {
      preview: preview(),
      entryId: "je-fx-1",
      entryNo: "JE-000099",
      reversalId: "je-fx-2",
      reversalNo: "JE-000100",
      ...overrides,
    };
  }

  it("posts the exact request body and refreshes the preview below it", async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /revaluation/runs": NO_RUNS,
        ...balancesHandlers(),
        "POST /revaluation/post": (init) => {
          posted = JSON.parse(String(init?.body));
          return { body: postResult() };
        },
        "POST /revaluation/preview": () => ({ body: preview() }),
      }),
    });
    await user.click(screen.getByRole("button", { name: "ترحيل التقييم" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toEqual({ date: monthEndIso(), currencies: [], autoReverse: true });

    // the post-refresh preview does render normally…
    expect(await screen.findByText("بنك مصر بالدولار")).toBeInTheDocument();

    // …but DEFECT: the "entry posted" confirmation banner never becomes
    // visible. FxRevaluationScreen.tsx's runPost (~line 71-80) does
    // `setPosted({ entryNo, reversalNo })` right after a successful post,
    // then immediately `await runPreview()` — whose very first lines
    // (~line 61-63) are `setError(null); setPosted(null);`. Both state
    // updates land in the same tick, so `posted` is wiped before React ever
    // paints it: the operator who just posted a real GL entry gets no
    // confirmation of its entry/reversal number on screen.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/JE-000099/)).not.toBeInTheDocument();
  });

  it("shows the server's Arabic refusal when posting is rejected (e.g. a closed period)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /revaluation/runs": NO_RUNS,
        ...balancesHandlers(),
        "POST /revaluation/post": () => ({
          status: 409,
          body: { error: "PERIOD_CLOSED", message: "الفترة المحاسبية مقفلة، لا يمكن ترحيل قيد إعادة التقييم." },
        }),
      }),
    });
    await user.click(screen.getByRole("button", { name: "ترحيل التقييم" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة المحاسبية مقفلة، لا يمكن ترحيل قيد إعادة التقييم.");
    await waitFor(() => expect(screen.queryByText("PERIOD_CLOSED")).not.toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("FxRevaluationScreen — party balances by currency", () => {
  function group(overrides: Partial<CurrencyBalanceGroupDTO> = {}): CurrencyBalanceGroupDTO {
    return {
      currency: "USD",
      outstandingBase: "15000.000000",
      outstandingTransaction: "300.000000",
      parties: [
        { partyId: "cust-1", partyName: "شركة الأمل", currency: "USD", outstandingBase: "15000.000000", outstandingTransaction: "300.000000", documentCount: 2 },
      ],
      ...overrides,
    };
  }

  it("renders receivable balances with money formatted, never the raw wire string", async () => {
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(
        balancesHandlers({
          baseCurrency: "EGP",
          receivables: [group()],
          payables: [],
          receivableTotalBase: "15000.000000",
          payableTotalBase: "0",
        }),
      ),
    });
    expect(await screen.findByText("شركة الأمل")).toBeInTheDocument();
    expect(screen.getAllByText("15,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("300.00").length).toBeGreaterThan(0); // group total + party row both carry this value
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("15000.000000")).not.toBeInTheDocument();
  });

  it("lists what each foreign-currency treasury account holds in its own currency, and says when lines were read at a derived rate", async () => {
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(
        balancesHandlers({
          baseCurrency: "EGP",
          receivables: [],
          payables: [],
          receivableTotalBase: "0.000000",
          payableTotalBase: "0.000000",
          treasury: [{ treasuryAccountId: "ta-usd", name: "البنك الأهلي — دولار", glAccountId: "1310-USD", currency: "USD", foreignBalance: "1100.000000", baseBalance: "53745.000000", derivedLines: 2 }],
        }),
      ),
    });
    const table = await screen.findByRole("table", { name: "أرصدة حسابات الخزينة بالعملة الأجنبية" });
    expect(within(table).getByText("البنك الأهلي — دولار")).toBeInTheDocument();
    expect(within(table).getByText("USD")).toBeInTheDocument();
    expect(table).toHaveTextContent("1,100.00");
    expect(table).toHaveTextContent("53,745.00");
    expect(table).toHaveTextContent("2 قيد قُرئ بسعر يوم ترحيله لأنه لا يحمل عملة");
  });

  it("shows the empty-balances message for a side with nothing open", async () => {
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(balancesHandlers()),
    });
    expect(await screen.findAllByText("لا توجد أرصدة مفتوحة.")).toHaveLength(2); // receivables + payables
  });

  it("shows the Arabic error state when the balances request fails", async () => {
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /revaluation/runs": NO_RUNS,
        "GET /settings/currencies": () => ({ body: ALLOWED }),
        "GET /gl/balances-by-currency": () => ({ status: 500, body: { error: "INTERNAL" } }),
      }),
    });
    // guards §4.5 #13 — the hook's message, which carries the support code.
    expect(await screen.findByText(/تعذّر تحميل الأرصدة حسب العملة\. \(رمز 500\)/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });
});

describe("FxRevaluationScreen — posted runs", () => {
  const run = (overrides: Record<string, unknown> = {}) => ({
    entryId: "je-fx-1", entryNo: "JE-000410", date: "2026-07-31", memo: "إعادة تقييم يوليو", status: "posted", reversible: true, reversalEntryId: null, reversalEntryNo: null, reversalDate: null, ...overrides,
  });

  it("lists each posted run and reverses a standing one through its own route with the stated reason", async () => {
    const bodies: unknown[] = [];
    let reversed = false;
    renderWithProviders(<FxRevaluationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...balancesHandlers(),
        "GET /revaluation/runs": () => ({ body: { runs: [reversed ? run({ status: "reversed", reversible: false, reversalEntryId: "je-fx-2", reversalEntryNo: "JE-000455", reversalDate: "2026-08-02" }) : run()] } }),
        "POST /revaluation/runs/je-fx-1/reverse": (init) => {
          bodies.push(JSON.parse((init?.body as string) ?? "{}"));
          reversed = true;
          return { body: {} };
        },
      }),
    });
    expect(await screen.findByText("JE-000410")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "عكس إعادة التقييم" }));
    const dialog = screen.getByRole("dialog", { name: "عكس تشغيل إعادة تقييم العملات؟" });
    fireEvent.change(within(dialog).getByLabelText("سبب العكس"), { target: { value: "سعر الإقفال أُدخل خطأ" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "عكس إعادة التقييم" }));
    await waitFor(() => expect(bodies).toEqual([{ memo: "سعر الإقفال أُدخل خطأ" }]));
    expect(await screen.findByText("عُكس بالقيد JE-000455 بتاريخ 2026-08-02")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "عكس إعادة التقييم" })).not.toBeInTheDocument();
  });

  it("says so when nothing has been posted", async () => {
    renderWithProviders(<FxRevaluationScreen />, { initialSession: testAdminSession, transport: stubTransport(balancesHandlers()) });
    expect(await screen.findByText("لم يُرحَّل أي تشغيل إعادة تقييم بعد.")).toBeInTheDocument();
  });
});
