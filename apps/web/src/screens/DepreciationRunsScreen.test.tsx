// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, DepreciationRunDTO } from "@mezan/contracts";
import { DepreciationRunsScreen } from "./DepreciationRunsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { todayIso } from "../lib/dates";

const sampleBranches: BranchDTO[] = [
  { id: "br-1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const sampleRuns: DepreciationRunDTO[] = [
  {
    id: "run-1",
    period: "2026-06",
    branchId: "br-1",
    status: "draft",
    lines: [{ assetId: "asset-1", amount: "500.000000" }],
    totalAmount: "500.000000",
    journalEntryId: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    postedAt: null,
  },
  {
    id: "run-2",
    period: "2026-05",
    branchId: null,
    status: "posted",
    lines: [{ assetId: "asset-1", amount: "500.000000" }, { assetId: "asset-2", amount: "300.000000" }],
    totalAmount: "800.000000",
    journalEntryId: "je-900",
    createdAt: "2026-05-01T00:00:00.000Z",
    postedAt: "2026-05-02T00:00:00.000Z",
  },
];

function renderScreen(runs: DepreciationRunDTO[] = sampleRuns) {
  let current = [...runs];
  const reverseRequests: { date?: string }[] = [];
  const transport = stubTransport({
    "GET /assets/depreciation/runs": () => ({ body: current }),
    "GET /branches": () => ({ body: sampleBranches }),
    "POST /assets/depreciation/runs": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((r) => r.period === body.period && r.branchId === (body.branchId ?? null))) {
        return { status: 409, body: { error: "DUPLICATE_DEPRECIATION_PERIOD", message: "تم تشغيل إهلاك لهذه الفترة من قبل." } };
      }
      const created: DepreciationRunDTO = {
        id: `run-${current.length + 1}`,
        period: body.period,
        branchId: body.branchId ?? null,
        status: "draft",
        lines: [{ assetId: "asset-1", amount: "100.000000" }],
        totalAmount: "100.000000",
        journalEntryId: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        postedAt: null,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /assets/depreciation/runs/run-1/post": () => {
      const posted: DepreciationRunDTO = { ...current[0]!, status: "posted", journalEntryId: "je-901", postedAt: "2026-06-02T00:00:00.000Z" };
      current = [posted, ...current.slice(1)];
      return { body: posted };
    },
    "POST /assets/depreciation/runs/run-1/discard": () => {
      const discarded: DepreciationRunDTO = { ...current.find((r) => r.id === "run-1")!, status: "cancelled" as const };
      current = current.map((r) => (r.id === "run-1" ? discarded : r));
      return { body: discarded };
    },
    "POST /assets/depreciation/runs/run-2/reverse": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      reverseRequests.push(body);
      const reversed: DepreciationRunDTO = { ...current.find((r) => r.id === "run-2")!, status: "cancelled" as const };
      current = current.map((r) => (r.id === "run-2" ? reversed : r));
      return { body: reversed };
    },
  });
  const result = renderWithProviders(<DepreciationRunsScreen />, { transport, initialSession: testAdminSession });
  return { ...result, reverseRequests };
}

describe("DepreciationRunsScreen", () => {
  it("lists depreciation runs from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الإهلاك" })).toBeInTheDocument();
    expect(await screen.findByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("2026-05")).toBeInTheDocument();
  });

  it("lists the newest period first, so a run just made is on the first page however long the history", async () => {
    const history: DepreciationRunDTO[] = Array.from({ length: 30 }, (_, index) => {
      const period = `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
      return { ...sampleRuns[1]!, id: `hist-${index}`, period, createdAt: `${period}-01T00:00:00.000Z`, postedAt: `${period}-02T00:00:00.000Z` };
    });
    const latest: DepreciationRunDTO = { ...sampleRuns[0]!, id: "run-latest", period: "2026-08" };
    renderScreen([...history, latest]);
    const table = await screen.findByRole("table");
    await within(table).findByText("2026-08");
    const firstCells = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(firstCells.slice(0, 3)).toEqual(["2026-08", "2026-06", "2026-05"]);
    expect(within(table).queryByText("2024-01")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no runs yet", async () => {
    renderScreen([]);
    expect(await screen.findByText(/لا توجد عمليات إهلاك/)).toBeInTheDocument();
  });

  it("filters the list by status via the chip row", async () => {
    renderScreen();
    await screen.findByText("2026-06");
    fireEvent.click(screen.getByRole("tab", { name: /^مرحل/ }));
    await waitFor(() => expect(screen.queryByText("2026-06")).not.toBeInTheDocument());
    expect(screen.getByText("2026-05")).toBeInTheDocument();
  });

  it("creates a new depreciation run through the side panel", async () => {
    renderScreen();
    await screen.findByText("2026-06");
    fireEvent.click(screen.getByRole("button", { name: "تشغيل إهلاك جديد" }));

    const dialog = screen.getByRole("dialog", { name: "تشغيل إهلاك جديد" });
    const [yearField, monthField] = within(dialog).getAllByRole("spinbutton");
    fireEvent.change(yearField!, { target: { value: "2026" } });
    fireEvent.change(monthField!, { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تشغيل" }));

    expect(await screen.findByText("2026-07")).toBeInTheDocument();
  });

  it("posts a draft run from its row action", async () => {
    renderScreen();
    await screen.findByText("2026-06");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات 2026-06" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "ترحيل" }));

    fireEvent.click(await screen.findByText("2026-06"));
    const detail = screen.getByRole("dialog", { name: /عملية إهلاك —/ });
    expect(within(detail).getByText(/je-901/)).toBeInTheDocument();
  });

  it("shows an error banner with a retry action when runs fail to load", async () => {
    const transport = stubTransport({
      "GET /assets/depreciation/runs": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /branches": () => ({ body: sampleBranches }),
    });
    renderWithProviders(<DepreciationRunsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل عمليات الإهلاك. (رمز 500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("opens the run detail panel listing its lines on row click", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("2026-05"));

    const detail = screen.getByRole("dialog", { name: /عملية إهلاك —/ });
    expect(within(detail).getByText("asset-1")).toBeInTheDocument();
    expect(within(detail).getByText("asset-2")).toBeInTheDocument();
  });

  it("discards a draft run from its row action; a posted run offers no discard", async () => {
    renderScreen();
    await screen.findByText("2026-06");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات 2026-06" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "استبعاد المسودة" }));

    fireEvent.click(await screen.findByRole("button", { name: "استبعاد المسودة" }));

    await waitFor(() => expect(within(screen.getByText("2026-06").closest("tr")!).getByText("ملغي")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "إجراءات 2026-05" }));
    expect(await screen.findByRole("menuitem", { name: "عكس التشغيل" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "استبعاد المسودة" })).not.toBeInTheDocument();
  });

  it("names the assets a posted run left out because another run had already charged them", async () => {
    renderScreen([{ ...sampleRuns[1]!, skippedLines: [{ assetId: "asset-9", assetCode: "AST-0009", amount: "120.000000" }] }]);
    fireEvent.click(await screen.findByText("2026-05"));

    const detail = screen.getByRole("dialog", { name: /عملية إهلاك —/ });
    expect(within(detail).getByText("أصول لم تُحمَّل في هذا التشغيل لأن تشغيلاً آخر حمّلها عن الفترة نفسها")).toBeInTheDocument();
    expect(within(detail).getByText("AST-0009")).toBeInTheDocument();
  });

  /** guards D275 — the reverse action must send a date, not rely on the server's own default. */
  it("reverses a posted run through a confirm dialog defaulting its date field to today, and sends that date", async () => {
    const { reverseRequests } = renderScreen();
    fireEvent.click(await screen.findByText("2026-05"));
    fireEvent.click(screen.getByRole("button", { name: "عكس التشغيل" }));

    const dialog = await screen.findByRole("dialog", { name: "عكس تشغيل الإهلاك هذا؟" });
    const dateInput = within(dialog).getByLabelText("تاريخ العكس") as HTMLInputElement;
    // The component's default is the LOCAL calendar day (`todayIso`), not
    // `toISOString()`'s UTC day — the two disagree for several hours a day
    // east of Greenwich, which is where this product ships.
    const today = todayIso();
    // The run itself posted on 2026-05-02; the dialog defaults to today, not that (D275).
    expect(dateInput.value).toBe(today);
    expect(dateInput.value).not.toBe("2026-05-02");

    fireEvent.click(within(dialog).getByRole("button", { name: "عكس التشغيل" }));

    await waitFor(() => expect(reverseRequests).toEqual([{ date: today }]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "عكس تشغيل الإهلاك هذا؟" })).not.toBeInTheDocument());
  });
});
