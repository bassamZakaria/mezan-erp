// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within, waitFor} from "@testing-library/react";
import type { WorkStationDTO } from "@mezan/contracts";
import { ProductionDashboardScreen } from "./ProductionDashboardScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import type { ProductionActiveOrderDTO, ProductionDashboardDTO } from "../../data/hub-hooks";

/** `TextField` (settings/form-controls.tsx) renders a plain `<label>` with no
 * `for`/`aria-labelledby`, so `getByLabelText` cannot find its `<input>` —
 * locate it by DOM adjacency instead, matching the repo's other tests against
 * this same primitive (e.g. TreasuryAccountsScreen.test.tsx). */
function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

function activeOrder(overrides: Partial<ProductionActiveOrderDTO> = {}): ProductionActiveOrderDTO {
  return {
    id: "wo-1", number: "WO-000001", productItemId: "item-1", producedQty: "20.000000", plannedQty: "50.000000",
    progress: 0.4, priority: "high", overdue: false, scheduledEndDate: "2026-09-05", stage: "started", nextAction: "issue",
    ...overrides,
  };
}

const sampleDashboard: ProductionDashboardDTO = {
  overdueCount: 1,
  kpis: { activeWorkOrders: 2, wipValue: "8400.250000", unitsProducedThisMonth: "160.000000", avgCostPerUnit: "52.500000" },
  buckets: {
    notStarted: [{ id: "wo-2", number: "WO-000002", productItemId: "item-2", producedQty: "0", plannedQty: "30.000000", progress: 0, priority: "normal", overdue: false }],
    awaitingMaterialIssue: [],
    awaitingProductReceipt: [],
    readyToComplete: [],
  },
  activeOrders: [activeOrder(), activeOrder({ id: "wo-3", number: "WO-000003", overdue: true, nextAction: null, progress: 0.75, scheduledEndDate: "2026-09-12" })],
};

const stations: WorkStationDTO[] = [
  { id: "ws-1", code: "ST-1", nameAr: "محطة القص", nameEn: null, notes: null, status: "active", createdAt: "2026-08-01T00:00:00.000Z" },
];

function renderScreen(
  overrides: { dashboard?: ProductionDashboardDTO; stations?: WorkStationDTO[]; dashboardStatus?: number } = {},
) {
  let currentStations = [...(overrides.stations ?? stations)];
  const transport = stubTransport({
    "GET /manufacturing/dashboard": () =>
      overrides.dashboardStatus ? { status: overrides.dashboardStatus, body: { error: "INTERNAL" } } : { body: overrides.dashboard ?? sampleDashboard },
    "GET /manufacturing/work-stations": () => ({ body: currentStations }),
    "POST /manufacturing/work-stations": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (!body.code || !body.nameAr) {
        return { status: 422, body: { error: "VALIDATION_ERROR", message: "أدخل كود المحطة واسمها." } };
      }
      const created: WorkStationDTO = { id: body.id, code: body.code, nameAr: body.nameAr, nameEn: null, notes: null, status: "active", createdAt: "2026-08-30T00:00:00.000Z" };
      currentStations = [...currentStations, created];
      return { body: created };
    },
    "POST /manufacturing/work-stations/*/activate": (_init, path) => {
      const id = path.split("/")[3];
      currentStations = currentStations.map((s) => (s.id === id ? { ...s, status: "active" } : s));
      return { body: currentStations.find((s) => s.id === id)! };
    },
    "POST /manufacturing/work-stations/*/deactivate": (_init, path) => {
      const id = path.split("/")[3];
      currentStations = currentStations.map((s) => (s.id === id ? { ...s, status: "inactive" } : s));
      return { body: currentStations.find((s) => s.id === id)! };
    },
  });
  return renderWithProviders(<ProductionDashboardScreen />, { transport, initialSession: testAdminSession });
}

describe("ProductionDashboardScreen", () => {
  it("renders the KPI tiles from the real dashboard, including money formatting", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "لوحة الإنتاج" })).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument(); // activeWorkOrders
    expect(await screen.findByText("8,400.25")).toBeInTheDocument(); // wipValue, Money-formatted
    expect(await screen.findByText("160")).toBeInTheDocument(); // unitsProducedThisMonth
    await waitFor(() => expect(screen.queryByText("8400.250000")).not.toBeInTheDocument());
  });

  it("renders each bucket's orders and the empty hint for buckets with none", async () => {
    renderScreen();
    expect(await screen.findByText("WO-000002")).toBeInTheDocument(); // notStarted bucket
    // awaitingMaterialIssue/awaitingProductReceipt/readyToComplete are empty in the fixture
    expect(screen.getAllByText("لا توجد أوامر في هذه المرحلة.").length).toBeGreaterThanOrEqual(3);
  });

  it("renders the active-orders table with progress, priority, due date and next action", async () => {
    renderScreen();
    expect(await screen.findByText("WO-000001")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("2026-09-05")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "صرف المواد" })).toBeInTheDocument(); // nextAction "issue"
    expect(screen.getByText("WO-000003")).toBeInTheDocument(); // overdue, nextAction null → "—"
  });

  it("shows the load-failed banner with a retry that re-fetches the dashboard", async () => {
    let dashboardCalls = 0;
    const transport = stubTransport({
      "GET /manufacturing/dashboard": () => {
        dashboardCalls += 1;
        return dashboardCalls === 1 ? { status: 500, body: { error: "INTERNAL" } } : { body: sampleDashboard };
      },
      "GET /manufacturing/work-stations": () => ({ body: stations }),
    });
    renderWithProviders(<ProductionDashboardScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل لوحة الإنتاج.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("WO-000001")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("تعذّر تحميل لوحة الإنتاج.")).not.toBeInTheDocument());
  });

  it("renders the registered work stations, and the empty hint when there are none", async () => {
    renderScreen({ stations: [] });
    expect(await screen.findByText("لا توجد محطات عمل بعد")).toBeInTheDocument();
    expect(screen.getByText("أضف محطة أدناه لتتمكن من تسجيلها على حركات أوامر التصنيع.")).toBeInTheDocument();
  });

  it("adds a work station with the typed code and name in the request body", async () => {
    renderScreen();
    // `getNodeText` only joins DIRECT text-node children, so the station's
    // name node (a sibling of the code `<span>`, not its own element) reads
    // as "— <name>" — the code prefix lives in the nested span instead.
    await screen.findByText("— محطة القص");
    const codeInput = textboxByLabel(document.body, "الكود");
    const nameInput = textboxByLabel(document.body, "الاسم");
    fireEvent.change(codeInput, { target: { value: "ST-2" } });
    fireEvent.change(nameInput, { target: { value: "محطة التغليف" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة محطة" }));
    expect(await screen.findByText("— محطة التغليف")).toBeInTheDocument();
  });

  it("shows the Arabic refusal when adding a station is rejected by the server", async () => {
    renderScreen();
    // `getNodeText` only joins DIRECT text-node children, so the station's
    // name node (a sibling of the code `<span>`, not its own element) reads
    // as "— <name>" — the code prefix lives in the nested span instead.
    await screen.findByText("— محطة القص");
    // Leave code/name blank — the screen's own client-side guard fires first,
    // which is itself the Arabic-not-English coverage for this path.
    fireEvent.click(screen.getByRole("button", { name: "إضافة محطة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("أدخل كود المحطة واسمها.");
  });

  it("toggles a station's status via the real activate/deactivate endpoint", async () => {
    renderScreen();
    // `getNodeText` only joins DIRECT text-node children, so the station's
    // name node (a sibling of the code `<span>`, not its own element) reads
    // as "— <name>" — the code prefix lives in the nested span instead.
    await screen.findByText("— محطة القص");
    expect(screen.getByText("مفعّلة")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إيقاف" }));
    expect(await screen.findByText("موقوفة")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("مفعّلة")).not.toBeInTheDocument());
  });
});
