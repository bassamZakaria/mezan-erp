// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  CountScanOutcomeDTO,
  CountScanSourceDTO,
  CountZoneKindDTO,
  CountZoneStatusDTO,
  type CountModeItemDTO,
  type CountModeScanResultDTO,
  type CountModeSessionDTO,
} from "@mezan/contracts";
import { CountModeScreen } from "./CountModeScreen";
import { TestNavigation, renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";

afterEach(cleanup);

const ZONE = {
  id: "Z1",
  name: "المشروبات",
  kind: CountZoneKindDTO.AdHoc,
  categoryId: null,
  status: CountZoneStatusDTO.Open,
  counterUserIds: [testAdminSession.userId],
  totalItems: 2,
  countedItems: 0,
  recountItems: 0,
  submittedAt: null,
  submittedBy: null,
  approvedAt: null,
  approvedBy: null,
  assignedToMe: true,
  netValue: null,
  absValue: null,
};

function item(over: Partial<CountModeItemDTO>): CountModeItemDTO {
  return {
    itemId: "I1",
    code: "COLA",
    nameAr: "كولا",
    nameEn: "Cola",
    unitCode: "PCS",
    units: [],
    zoneId: "Z1",
    countedQty: null,
    recount: false,
    systemQty: null,
    varianceQty: null,
    varianceValue: null,
    ...over,
  };
}

function session(items: CountModeItemDTO[], over: Partial<CountModeSessionDTO> = {}): CountModeSessionDTO {
  return {
    id: "C1",
    countNo: "CNT-000001",
    warehouseId: "WH-MAIN",
    date: "2026-10-17",
    memo: "",
    status: "IN_PROGRESS",
    blind: true,
    generatedAdjustmentId: null,
    zones: [{ ...ZONE, countedItems: items.filter((i) => i.countedQty !== null).length }],
    items,
    counters: [],
    revealsVariance: false,
    canReview: false,
    netValue: null,
    absValue: null,
    ...over,
  };
}

function scanResult(outcome: CountScanOutcomeDTO, over: Partial<CountModeScanResultDTO> = {}): CountModeScanResultDTO {
  return {
    outcome,
    replayed: false,
    scan: { id: "S1", zoneId: "Z1", itemId: "I1", barcode: "6221", outcome, source: CountScanSourceDTO.Scan, qty: "1.000000", enteredQty: null, unitCode: null, userId: "USER-ADMIN", userName: "x", scannedAt: "2026-10-17T10:00:00.000Z", voidedAt: null, voidedBy: null, voidReason: null },
    item: item({ countedQty: "1.000000" }),
    addedQty: "1.000000",
    zone: ZONE,
    ...over,
  };
}

function renderScan(handlers: { sessionBody?: CountModeSessionDTO; onScan?: (body: Record<string, unknown>) => CountModeScanResultDTO | { status: number; body: unknown } } = {}) {
  const scans: Record<string, unknown>[] = [];
  const transport = stubTransport({
    "GET /inventory/count-mode/C1": () => ({ body: handlers.sessionBody ?? session([item({}), item({ itemId: "I2", code: "JUICE", nameAr: "عصير", nameEn: "Juice" })]) }),
    "POST /inventory/count-mode/C1/zones/Z1/scan": (init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      scans.push(body);
      const answer = handlers.onScan?.(body) ?? scanResult(CountScanOutcomeDTO.Counted);
      return "outcome" in answer ? { status: 201, body: answer } : answer;
    },
  });
  renderWithProviders(
    <TestNavigation initialSegments={["C1", "Z1"]}>
      <CountModeScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
  return scans;
}

async function scanInput(): Promise<HTMLInputElement> {
  return (await screen.findByLabelText("امسح الباركود")) as HTMLInputElement;
}

function enter(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("CountModeScreen — scanning a zone", () => {
  it("focuses the scan input, posts the barcode on Enter and keeps focus there", async () => {
    const scans = renderScan();
    const input = await scanInput();
    await waitFor(() => expect(input).toHaveFocus());
    enter(input, "6221000000011");
    await waitFor(() => expect(scans).toHaveLength(1));
    expect(scans[0]).toMatchObject({ barcode: "6221000000011", mode: "ADD" });
    expect(await screen.findByText("تم العدّ")).toBeInTheDocument();
    expect(screen.getAllByText("كولا").length).toBeGreaterThan(0);
    expect(input).toHaveValue("");
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("carries a *N quantity onto the next scan only", async () => {
    const scans = renderScan();
    const input = await scanInput();
    enter(input, "*24");
    expect(await screen.findByLabelText("الكمية المعلّقة للمسح التالي")).toHaveTextContent("24");
    enter(input, "6221");
    await waitFor(() => expect(scans).toHaveLength(1));
    expect(scans[0]).toMatchObject({ barcode: "6221", qty: "24" });
    enter(input, "6221");
    await waitFor(() => expect(scans).toHaveLength(2));
    expect(scans[1]).not.toHaveProperty("qty");
  });

  it("says so, in words and not only colour, when the barcode is unknown", async () => {
    renderScan({
      onScan: () => scanResult(CountScanOutcomeDTO.UnknownBarcode, { item: null, addedQty: null, scan: { ...scanResult(CountScanOutcomeDTO.UnknownBarcode).scan, itemId: null, qty: "0.000000" } }),
    });
    enter(await scanInput(), "999");
    expect(await screen.findByText("باركود غير معروف")).toBeInTheDocument();
  });

  it("refuses a malformed command without calling the server", async () => {
    const scans = renderScan();
    enter(await scanInput(), "*abc");
    expect(await screen.findByText(/إدخال غير صالح/)).toBeInTheDocument();
    expect(scans).toHaveLength(0);
  });

  it("keeps a scan the server never received and lets the counter retry it", async () => {
    let attempts = 0;
    const scans = renderScan({
      onScan: () => {
        attempts += 1;
        return attempts === 1 ? { status: 503, body: { message: "غير متاح" } } : scanResult(CountScanOutcomeDTO.Counted);
      },
    });
    enter(await scanInput(), "6221");
    expect(await screen.findByText("لم يصل")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(scans).toHaveLength(2));
    expect(scans[1]?.clientKey).toBe(scans[0]?.clientKey);
    expect(await screen.findByText("تم العدّ")).toBeInTheDocument();
  });

  it("withholds the expected quantity on a blind count and shows it when the server sends it", async () => {
    renderScan();
    await scanInput();
    expect(screen.queryByText(/الدفتري/)).not.toBeInTheDocument();
    cleanup();
    renderScan({ sessionBody: session([item({ countedQty: "9.000000", systemQty: "10.000000", varianceQty: "-1.000000" })], { blind: false, revealsVariance: true }) });
    await scanInput();
    fireEvent.click(await screen.findByText(/أصناف المنطقة/));
    expect(await screen.findByText("عجز -1")).toBeInTheDocument();
  });

  it("locks the scan input once the zone is submitted", async () => {
    renderScan({ sessionBody: session([item({ countedQty: "1.000000" })], { zones: [{ ...ZONE, status: CountZoneStatusDTO.Submitted, countedItems: 1, totalItems: 1 }] }) });
    expect(await screen.findByText(/سُلِّمت المنطقة للمراجعة/)).toBeInTheDocument();
    expect(screen.queryByLabelText("امسح الباركود")).not.toBeInTheDocument();
  });

  it("offers submit only when every item is counted", async () => {
    renderScan();
    const submit = await screen.findByRole("button", { name: "تسليم المنطقة للمراجعة" });
    expect(submit).toBeDisabled();
  });
});
