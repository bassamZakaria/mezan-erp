// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  PeriodCloseCheckCodeDTO,
  PeriodCloseCheckStatusDTO,
  PeriodCloseErrorCodeDTO,
  PeriodCloseFindingKindDTO,
  PeriodCloseFindingStateDTO,
  PeriodCloseFixTargetDTO,
  PeriodStatusDTO,
  type FiscalPeriodDTO,
  type PeriodCloseCheckDTO,
  type PeriodCloseChecklistDTO,
  type PeriodCloseFindingDTO,
  type PeriodCloseSummaryDTO,
} from "@mezan/contracts";
import { PeriodCloseScreen } from "./PeriodCloseScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";

const JUNE: FiscalPeriodDTO = { id: "fp-2026-06", year: 2026, periodNumber: 6, startDate: "2026-06-01", endDate: "2026-06-30", status: PeriodStatusDTO.Open };
const REASON = "إقفال يونيو باعتماد المدير المالي";

function finding(over: Partial<PeriodCloseFindingDTO> & Pick<PeriodCloseFindingDTO, "kind" | "ref">): PeriodCloseFindingDTO {
  return { label: null, state: PeriodCloseFindingStateDTO.Ok, passed: true, fix: null, count: null, amount: null, asOfDate: null, items: [], ...over };
}

function check(code: PeriodCloseCheckCodeDTO, status: PeriodCloseCheckStatusDTO, findings: PeriodCloseFindingDTO[] = []): PeriodCloseCheckDTO {
  return { code, status, fix: null, findings };
}

const DRAFTS_FAILING = check(PeriodCloseCheckCodeDTO.Drafts, PeriodCloseCheckStatusDTO.Fail, [
  finding({
    kind: PeriodCloseFindingKindDTO.Drafts,
    ref: "journal_entry",
    state: PeriodCloseFindingStateDTO.Draft,
    passed: false,
    fix: PeriodCloseFixTargetDTO.Journals,
    count: 3,
  }),
]);

const OTHER_CHECKS: PeriodCloseCheckDTO[] = [
  check(PeriodCloseCheckCodeDTO.SubledgerTies, PeriodCloseCheckStatusDTO.Pass, [
    finding({ kind: PeriodCloseFindingKindDTO.Tie, ref: "ar", label: "نص الخادم", amount: "0.000000", items: ["1105"] }),
  ]),
  check(PeriodCloseCheckCodeDTO.BankStatements, PeriodCloseCheckStatusDTO.NotApplicable),
  check(PeriodCloseCheckCodeDTO.TrialBalance, PeriodCloseCheckStatusDTO.Unavailable),
];

function checklist(over: Partial<PeriodCloseChecklistDTO> = {}): PeriodCloseChecklistDTO {
  const checks = over.checks ?? [DRAFTS_FAILING, ...OTHER_CHECKS];
  return {
    periodId: JUNE.id,
    year: JUNE.year,
    periodNumber: JUNE.periodNumber,
    startDate: JUNE.startDate,
    endDate: JUNE.endDate,
    periodStatus: PeriodStatusDTO.Open,
    evaluatedAt: "2026-07-02T08:00:00.000Z",
    checks,
    blocking: checks.filter((c) => c.status === PeriodCloseCheckStatusDTO.Fail || c.status === PeriodCloseCheckStatusDTO.Unavailable).map((c) => c.code),
    canOverride: true,
    ...over,
  };
}

function summary(over: Partial<PeriodCloseSummaryDTO> = {}): PeriodCloseSummaryDTO {
  return {
    id: "SUM-1",
    periodId: JUNE.id,
    closedBy: "USER-ADMIN",
    closedAt: "2026-07-02T08:05:00.000Z",
    overrideReason: null,
    failedChecks: [],
    closingDebit: "1000.000000",
    closingCredit: "1000.000000",
    accountCount: 4,
    sha256: "a".repeat(64),
    sealValid: true,
    ...over,
  };
}

type StubReply = { status?: number; body: unknown };

interface Setup {
  readonly periods?: () => StubReply | Promise<never>;
  readonly summariesReply?: () => StubReply | Promise<never>;
  readonly checklist?: PeriodCloseChecklistDTO;
  readonly summaries?: PeriodCloseSummaryDTO[];
  readonly closeResult?: { status: number; body: unknown };
  readonly locale?: "ar" | "en";
}

function renderScreen(setup: Setup = {}) {
  const closeBodies: unknown[] = [];
  if (setup.locale) window.localStorage.setItem("mezan.locale", setup.locale);
  else window.localStorage.removeItem("mezan.locale");
  const stub = stubTransport({
    "GET /fiscal-periods": () => ({ body: [JUNE] }),
    "GET /period-close/fp-2026-06/checks": () => ({ body: setup.checklist ?? checklist() }),
    "GET /period-close/fp-2026-06/summaries": () => ({ body: setup.summaries ?? [] }),
    "GET /users": () => ({ body: [] }),
    "GET /branches": () => ({ body: [] }),
    "POST /fiscal-periods/fp-2026-06/close": (init) => {
      closeBodies.push(JSON.parse((init?.body as string) ?? "{}"));
      return setup.closeResult ?? { status: 200, body: { ...JUNE, status: PeriodStatusDTO.Closed } };
    },
  });
  const overrides: Record<string, Setup["periods"]> = { "/fiscal-periods": setup.periods, "/period-close/fp-2026-06/summaries": setup.summariesReply };
  const transport: typeof stub = (path, init) => {
    const override = (init?.method ?? "GET") === "GET" ? overrides[path.split("?")[0] ?? ""] : undefined;
    if (!override) return stub(path, init);
    return Promise.resolve(override()).then((reply) => {
      const status = reply.status ?? 200;
      return { status, ok: status < 400, json: <T,>() => Promise.resolve(reply.body as T), text: () => Promise.resolve(JSON.stringify(reply.body)) };
    });
  };
  renderWithProviders(<PeriodCloseScreen />, { transport, initialSession: testAdminSession, route: "/money/period-close?period=fp-2026-06" });
  return { closeBodies };
}

function checkRow(code: PeriodCloseCheckCodeDTO): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-check="${code}"]`);
  if (!row) throw new Error(`check row ${code} is not on screen`);
  return row;
}

describe("PeriodCloseScreen", () => {
  it("shows each check with its state, its figure and a jump to the screen that fixes it", async () => {
    renderScreen();
    expect(await screen.findByRole("heading", { level: 1, name: "مساحة إقفال الفترة" })).toBeInTheDocument();
    await waitFor(() => expect(checkRow(PeriodCloseCheckCodeDTO.Drafts)).toBeInTheDocument());

    const drafts = within(checkRow(PeriodCloseCheckCodeDTO.Drafts));
    expect(drafts.getByText("يحتاج معالجة")).toBeInTheDocument();
    expect(drafts.getByText("قيود يومية")).toBeInTheDocument();
    expect(drafts.getByText("3")).toBeInTheDocument();
    expect(drafts.getByRole("button", { name: /^فتح / })).toBeInTheDocument();

    const ties = within(checkRow(PeriodCloseCheckCodeDTO.SubledgerTies));
    expect(ties.getByText("مكتمل")).toBeInTheDocument();
    expect(ties.getByText("ذمم العملاء مقابل دفتر الأستاذ (1105)")).toBeInTheDocument();
    expect(ties.queryByRole("button")).not.toBeInTheDocument();

    expect(within(checkRow(PeriodCloseCheckCodeDTO.BankStatements)).getByText("لا ينطبق")).toBeInTheDocument();
    expect(within(checkRow(PeriodCloseCheckCodeDTO.TrialBalance)).getByText("تعذّر الفحص")).toBeInTheDocument();
    expect(screen.getByText("2 من 4 فحوص مكتملة")).toBeInTheDocument();
  });

  it("names a sub-ledger tie from the catalog in English too, never from the server's Arabic label", async () => {
    renderScreen({ locale: "en" });
    await waitFor(() => expect(checkRow(PeriodCloseCheckCodeDTO.SubledgerTies)).toBeInTheDocument());
    const ties = within(checkRow(PeriodCloseCheckCodeDTO.SubledgerTies));
    expect(ties.getByText("Customer receivables vs general ledger (1105)")).toBeInTheDocument();
    expect(ties.queryByText(/نص الخادم/)).not.toBeInTheDocument();
    window.localStorage.removeItem("mezan.locale");
  });

  it("with failing checks, the override dialog will not confirm until a real reason is typed, and sends only that reason", async () => {
    const { closeBodies } = renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "إقفال مع تجاوز الفحوص" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "إقفال مع تجاوز الفحوص" });
    expect(confirm).toBeDisabled();

    const reason = within(dialog).getByLabelText("سبب التجاوز");
    fireEvent.change(reason, { target: { value: "قصير" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: `  ${REASON}  ` } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(closeBodies).toEqual([{ overrideReason: REASON }]));
    expect(await screen.findByRole("status")).toHaveTextContent("تم إقفال يونيو 2026.");
  });

  it("a user who may not override gets a disabled close button and is told why, with no dialog to open", async () => {
    renderScreen({ checklist: checklist({ canOverride: false }) });
    const close = await screen.findByRole("button", { name: "إقفال الفترة" });
    expect(close).toBeDisabled();
    expect(screen.getByText(/تجاوزها يتطلب صلاحية «تجاوز فحوص الإقفال»/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إقفال مع تجاوز الفحوص" })).not.toBeInTheDocument();
  });

  it("a clear month closes after a plain confirmation and sends no reason", async () => {
    const clear = checklist({ checks: [check(PeriodCloseCheckCodeDTO.Drafts, PeriodCloseCheckStatusDTO.Pass), ...OTHER_CHECKS.slice(0, 2)] });
    const { closeBodies } = renderScreen({ checklist: clear });
    fireEvent.click(await screen.findByRole("button", { name: "إقفال الفترة" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("سبب التجاوز")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "إقفال الفترة" }));
    await waitFor(() => expect(closeBodies).toEqual([{}]));
  });

  it("shows the server's refusal in the reader's language", async () => {
    const refusal = {
      status: 403,
      body: { error: PeriodCloseErrorCodeDTO.LockOverrideSameUser, message: "رفض بالعربية", messageEn: "Refused in English" },
    };
    renderScreen({ closeResult: refusal });
    fireEvent.click(await screen.findByRole("button", { name: "إقفال مع تجاوز الفحوص" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("سبب التجاوز"), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إقفال مع تجاوز الفحوص" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("رفض بالعربية");
  });

  it("and in English when the reader's locale is English", async () => {
    const refusal = {
      status: 403,
      body: { error: PeriodCloseErrorCodeDTO.LockOverrideSameUser, message: "رفض بالعربية", messageEn: "Refused in English" },
    };
    renderScreen({ closeResult: refusal, locale: "en" });
    fireEvent.click(await screen.findByRole("button", { name: "Close and override checks" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason for the override"), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close and override checks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refused in English");
    window.localStorage.removeItem("mezan.locale");
  });

  it("lists each close with its seal, and flags a summary whose seal no longer verifies", async () => {
    renderScreen({
      summaries: [summary({ id: "SUM-2", sealValid: false, overrideReason: REASON }), summary()],
    });
    const history = within(await screen.findByRole("region", { name: "سجل الإقفال" }));
    await waitFor(() => expect(history.getByText("ختم سليم")).toBeInTheDocument());
    expect(history.getByText("الختم لا يطابق — السجل عُدِّل بعد الإقفال")).toBeInTheDocument();
    expect(history.getByText(REASON)).toBeInTheDocument();
    expect(history.getByText("بدون تجاوز")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-seal-valid="false"]')).toHaveLength(1);
  });

  it("says so when the period has never been closed from the workspace", async () => {
    renderScreen();
    expect(await screen.findByText("لم تُقفل هذه الفترة من مساحة الإقفال بعد.")).toBeInTheDocument();
  });
  it("shows the page and a loading state while the periods are still on their way, not an empty screen", async () => {
    renderScreen({ periods: () => new Promise<never>(() => {}) });
    expect(await screen.findByRole("heading", { level: 1, name: "مساحة إقفال الفترة" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ التحميل");
    expect(screen.queryByText("لا توجد فترات مالية بعد")).not.toBeInTheDocument();
  });

  it("a failed periods request is an error with a retry, never the “no periods yet” empty state", async () => {
    let attempts = 0;
    renderScreen({
      periods: () => {
        attempts += 1;
        return attempts === 1 ? { status: 500, body: { message: "تعذّر الاتصال بقاعدة البيانات." } } : { body: [JUNE] };
      },
    });
    expect(await screen.findByText("تعذّر الاتصال بقاعدة البيانات.")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد فترات مالية بعد")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(checkRow(PeriodCloseCheckCodeDTO.Drafts)).toBeInTheDocument());
  });

  it("keeps the close history section on screen while its rows load", async () => {
    renderScreen({ summariesReply: () => new Promise<never>(() => {}) });
    const history = await screen.findByRole("region", { name: "سجل الإقفال" });
    expect(within(history).getByRole("status")).toHaveTextContent("جارٍ التحميل");
  });
});

describe("a bank statement with lines nobody has matched", () => {
  it("is named as an unreconciled statement with the number of lines still to match", async () => {
    const unreconciled = check(PeriodCloseCheckCodeDTO.BankStatements, PeriodCloseCheckStatusDTO.Fail, [
      finding({ kind: PeriodCloseFindingKindDTO.BankStatement, ref: "BSTMT-1", label: "البنك الأهلي — BS-2026-06", state: PeriodCloseFindingStateDTO.Unreconciled, passed: false, fix: PeriodCloseFixTargetDTO.BankReconciliation, count: 11, asOfDate: "2026-06-30" }),
    ]);
    renderScreen({ checklist: checklist({ checks: [unreconciled] }) });
    await waitFor(() => expect(checkRow(PeriodCloseCheckCodeDTO.BankStatements)).toHaveTextContent("البنك الأهلي — BS-2026-06"));
    const row = checkRow(PeriodCloseCheckCodeDTO.BankStatements);
    expect(row).toHaveTextContent("كشف غير مسوّى");
    expect(row).toHaveTextContent("بنود لم تُطابَق بعد: 11");
  });
});
