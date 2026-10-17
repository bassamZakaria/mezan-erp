// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { VatReturnRow } from "@mezan/domain";
import { VatFilingState, type VatFilingDTO } from "@mezan/contracts";
import { VatFilingAction, VatFilingsList, isWholeMonthWindow } from "./VatFilingPanel";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Session } from "../data/session";

const ROWS: readonly VatReturnRow[] = [
  { rowId: "output-14", side: "output", sideLabel: "ضريبة المخرجات (المبيعات)", rate: 14, taxRateId: "TR-14", taxRateName: "14%", base: 1000, tax: 140 },
  { rowId: "input-14", side: "input", sideLabel: "ضريبة المدخلات (المشتريات)", rate: 14, taxRateId: "TR-14", taxRateName: "14%", base: 500, tax: 70 },
];

const JULY: VatFilingDTO = {
  id: "f-july",
  periodFrom: "2026-07-01",
  periodTo: "2026-07-31",
  netAmount: "70.000000",
  referenceNo: "ETA-7",
  status: VatFilingState.Filed,
  filedAt: "2026-08-05T09:00:00.000Z",
  filedBy: "USER-ADMIN",
  amendedAt: null,
  amendmentReason: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const restricted = (permissions: string[]): Session => ({ ...testAdminSession, userId: "USER-R", isCompanyAdmin: false, permissions, roleCode: "R" });

function transportWith(filings: VatFilingDTO[], posted: { path: string; body: unknown }[] = [], refuse?: { status: number; message: string }) {
  return stubTransport({
    "GET /gl/vat-filings": () => ({ body: [...filings] }),
    "GET /users": () => ({ body: [{ id: "USER-ADMIN", nameAr: "محمد الشهابي", nameEn: null }] }),
    "POST /gl/vat-filings": (init, path) => {
      const body = JSON.parse(String(init?.body)) as { id: string; periodFrom: string; periodTo: string; netAmount: string; referenceNo?: string | null };
      posted.push({ path, body });
      if (refuse) return { status: refuse.status, body: { error: "REFUSED", message: refuse.message } };
      const filed: VatFilingDTO = { ...JULY, id: body.id, periodFrom: body.periodFrom, periodTo: body.periodTo, netAmount: body.netAmount, referenceNo: body.referenceNo ?? null };
      filings.push(filed);
      return { status: 201, body: filed };
    },
    "POST /gl/vat-filings/*/amend": (init, path) => {
      const body = JSON.parse(String(init?.body)) as { reason: string };
      posted.push({ path, body });
      const index = filings.findIndex((f) => path.includes(`/${f.id}/`));
      const amended: VatFilingDTO = { ...filings[index]!, status: VatFilingState.Amended, amendedAt: "2026-08-09T10:00:00.000Z", amendmentReason: body.reason };
      filings[index] = amended;
      return { body: amended };
    },
  });
}

describe("isWholeMonthWindow", () => {
  it.each([
    ["2026-07-01", "2026-07-31", true],
    ["2026-01-01", "2026-03-31", true],
    ["2024-02-01", "2024-02-29", true],
    ["2026-07-02", "2026-07-31", false],
    ["2026-07-01", "2026-07-30", false],
    ["2026-08-01", "2026-07-31", false],
    ["", "", false],
  ])("%s → %s is %s", (from, to, expected) => {
    expect(isWholeMonthWindow(from, to)).toBe(expected);
  });
});

describe("VatFilingAction — filing the period on screen", () => {
  it("states what filing locks and the figures being filed, then files them under a UUID the client mints", async () => {
    const posted: { path: string; body: unknown }[] = [];
    const filings: VatFilingDTO[] = [];
    renderWithProviders(
      <>
        <VatFilingAction rows={ROWS} periodFrom="2026-07-01" periodTo="2026-07-31" />
        <VatFilingsList />
      </>,
      { transport: transportWith(filings, posted), initialSession: testAdminSession },
    );

    fireEvent.click(await screen.findByRole("button", { name: "تقديم إقرار هذه الفترة" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/يُرفض أي ترحيل بتاريخ يقع داخلها/)).toBeInTheDocument();
    expect(within(dialog).getByText("140.00")).toBeInTheDocument();
    expect(within(dialog).getAllByText("70.00")).toHaveLength(2);

    fireEvent.change(within(dialog).getByLabelText(/رقم إشعار الاستلام/), { target: { value: "ETA-2026-07" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تقديم الإقرار" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0]!.body as { id: string; periodFrom: string; periodTo: string; netAmount: string; referenceNo: string };
    expect(body.id).toMatch(UUID);
    expect(body).toMatchObject({ periodFrom: "2026-07-01", periodTo: "2026-07-31", netAmount: "70.00", referenceNo: "ETA-2026-07" });

    expect(await screen.findByText("إقرار هذه الفترة مُقدَّم")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تقديم إقرار هذه الفترة" })).not.toBeInTheDocument();
    const row = await screen.findByRole("row", { name: /2026-07-01/ });
    expect(within(row).getByText("مُقدَّم")).toBeInTheDocument();
    expect(within(row).getByText("محمد الشهابي")).toBeInTheDocument();
  });

  it("shows the server's Arabic refusal when the period already has a filing", async () => {
    renderWithProviders(<VatFilingAction rows={ROWS} periodFrom="2026-07-01" periodTo="2026-07-31" />, {
      transport: transportWith([], [], { status: 409, message: "هذه الفترة لديها إقرار مسجَّل بالفعل (f-other)." }),
      initialSession: testAdminSession,
    });
    fireEvent.click(await screen.findByRole("button", { name: "تقديم إقرار هذه الفترة" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "تقديم الإقرار" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("هذه الفترة لديها إقرار مسجَّل بالفعل (f-other).");
  });

  it("does not offer filing for a window that is not whole months, and says why", async () => {
    renderWithProviders(<VatFilingAction rows={ROWS} periodFrom="2026-01-01" periodTo="2026-07-14" />, {
      transport: transportWith([]),
      initialSession: testAdminSession,
    });
    expect(await screen.findByText(/تبدأ في أول الشهر وتنتهي في آخره/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تقديم إقرار هذه الفترة" })).toBeDisabled();
  });

  it("calls a window filed only when a filed return covers all of it; a window that merely overlaps one is neither filed nor offered", async () => {
    const overlapping = renderWithProviders(<VatFilingAction rows={ROWS} periodFrom="2026-01-01" periodTo="2026-12-31" />, {
      transport: transportWith([{ ...JULY }]),
      initialSession: testAdminSession,
    });
    expect(await screen.findByText(/جزء من هذه الفترة مُقدَّم بالفعل/)).toBeInTheDocument();
    expect(screen.queryByText("إقرار هذه الفترة مُقدَّم")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تقديم إقرار هذه الفترة" })).not.toBeInTheDocument();
    overlapping.unmount();

    renderWithProviders(<VatFilingAction rows={ROWS} periodFrom="2026-07-05" periodTo="2026-07-20" />, {
      transport: transportWith([{ ...JULY }]),
      initialSession: testAdminSession,
    });
    expect(await screen.findByText("إقرار هذه الفترة مُقدَّم")).toBeInTheDocument();
  });

  it("offers nothing to a session that cannot close periods", async () => {
    const asked: string[] = [];
    const base = transportWith([JULY]);
    renderWithProviders(
      <>
        <VatFilingAction rows={ROWS} periodFrom="2026-08-01" periodTo="2026-08-31" />
        <VatFilingsList />
      </>,
      {
        transport: (path, init) => {
          asked.push(path);
          return base(path, init);
        },
        initialSession: restricted(["accounting.reports.view"]),
      },
    );
    expect(await screen.findByRole("row", { name: /2026-07-01/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تقديم إقرار هذه الفترة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعديل الإقرار" })).not.toBeInTheDocument();
    expect(asked).not.toContain("/users");
  });

  it("reads no filings for a session that cannot view accounting reports", async () => {
    const asked: string[] = [];
    const base = transportWith([JULY]);
    renderWithProviders(<VatFilingsList />, {
      transport: (path, init) => {
        asked.push(path);
        return base(path, init);
      },
      initialSession: restricted(["sales.invoice.view"]),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).not.toContain("/gl/vat-filings");
  });
});

describe("VatFilingsList — amending a filed period", () => {
  it("requires a reason, sends it, and shows the period as amended with the reason", async () => {
    const posted: { path: string; body: unknown }[] = [];
    renderWithProviders(<VatFilingsList />, { transport: transportWith([{ ...JULY }], posted), initialSession: testAdminSession });

    fireEvent.click(await screen.findByRole("button", { name: "تعديل الإقرار" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/يفتح الفترة من جديد/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "تعديل الإقرار" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("سبب التعديل"), { target: { value: "فاتورة وردت متأخرة" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(posted).toEqual([{ path: "/gl/vat-filings/f-july/amend", body: { reason: "فاتورة وردت متأخرة" } }]));
    const row = await screen.findByRole("row", { name: /2026-07-01/ });
    await waitFor(() => expect(within(row).getByText("مُعدَّل")).toBeInTheDocument());
    expect(within(row).getByText(/فاتورة وردت متأخرة/)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "تعديل الإقرار" })).not.toBeInTheDocument();
  });

  it("says so when nothing has been filed", async () => {
    renderWithProviders(<VatFilingsList />, { transport: transportWith([]), initialSession: testAdminSession });
    expect(await screen.findByText("لم يُقدَّم أي إقرار بعد.")).toBeInTheDocument();
  });
});
