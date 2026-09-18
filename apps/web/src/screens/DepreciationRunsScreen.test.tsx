// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, DepreciationRunDTO } from "@mezan/contracts";
import { DepreciationRunsScreen } from "./DepreciationRunsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

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
  });
  return renderWithProviders(<DepreciationRunsScreen />, { transport, initialSession: testAdminSession });
}

describe("DepreciationRunsScreen", () => {
  it("lists depreciation runs from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الإهلاك" })).toBeInTheDocument();
    expect(await screen.findByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("2026-05")).toBeInTheDocument();
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
});
