// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OpeningBalanceDuplicatesCard } from "./OpeningBalanceDuplicatesCard";
import { OpeningBalancePartyKind, type OpeningBalanceDuplicateDTO } from "../data/opening-balance-duplicates-hooks";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import type { Session } from "../data/session";

const CUSTOMER: OpeningBalanceDuplicateDTO = {
  key: "customer:cust-dup",
  kind: OpeningBalancePartyKind.Customer,
  partyId: "cust-dup",
  code: "C-014",
  nameAr: "عميل مكرر",
  wanted: 750,
  totalPosted: 1500,
  excess: 750,
  entryIds: ["e1", "e2"],
  entryCount: 2,
};

const SUPPLIER: OpeningBalanceDuplicateDTO = {
  key: "supplier:sup-dup",
  kind: OpeningBalancePartyKind.Supplier,
  partyId: "sup-dup",
  code: "S-003",
  nameAr: "مورد مكرر",
  wanted: -300,
  totalPosted: -600,
  excess: -300,
  entryIds: ["e3", "e4"],
  entryCount: 2,
};

function transportWith(rows: OpeningBalanceDuplicateDTO[], repairs: string[] = [], repair?: (path: string) => StubResult) {
  return stubTransport({
    "GET /gl/opening-balance-duplicates": () => ({ body: { rows: [...rows], groups: [], grandTotals: {}, reconciliation: null } }),
    "POST /gl/opening-balance-duplicates/*/*/repair": (_init, path) => {
      repairs.push(path);
      if (repair) return repair(path);
      const index = rows.findIndex((row) => path.includes(`/${row.kind}/${row.partyId}/`));
      const [fixed] = rows.splice(index, 1);
      return { body: { kind: fixed!.kind, partyId: fixed!.partyId, repaired: true } };
    },
  });
}

const restricted = (permissions: string[]): Session => ({ ...testAdminSession, userId: "USER-R", isCompanyAdmin: false, permissions, roleCode: "R" });

describe("OpeningBalanceDuplicatesCard — opening balances posted more than once", () => {
  it("lists each party with what should stand, what is posted and the excess", async () => {
    renderWithProviders(<OpeningBalanceDuplicatesCard />, { transport: transportWith([CUSTOMER, SUPPLIER]), initialSession: testAdminSession });
    const customer = await screen.findByRole("row", { name: /عميل مكرر/ });
    expect(within(customer).getByText("عميل")).toBeInTheDocument();
    expect(within(customer).getByText("1,500.00")).toBeInTheDocument();
    expect(within(customer).getAllByText("750.00")).toHaveLength(2);
    expect(within(screen.getByRole("row", { name: /مورد مكرر/ })).getByText("مورد")).toBeInTheDocument();
  });

  it("explains what the repair posts before posting it, then repairs that party alone and drops its row", async () => {
    const repairs: string[] = [];
    renderWithProviders(<OpeningBalanceDuplicatesCard />, { transport: transportWith([{ ...CUSTOMER }, { ...SUPPLIER }], repairs), initialSession: testAdminSession });

    const customer = await screen.findByRole("row", { name: /عميل مكرر/ });
    fireEvent.click(within(customer).getByRole("button", { name: "عكس الترحيل المكرر" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/قيد عكسي/)).toBeInTheDocument();
    expect(within(dialog).getByText(/750\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/لا تُعدَّل ولا تُحذف/)).toBeInTheDocument();
    expect(repairs).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "ترحيل القيد العكسي" }));
    await waitFor(() => expect(repairs).toEqual(["/gl/opening-balance-duplicates/customer/cust-dup/repair"]));
    await waitFor(() => expect(screen.queryByRole("row", { name: /عميل مكرر/ })).not.toBeInTheDocument());
    expect(screen.getByRole("row", { name: /مورد مكرر/ })).toBeInTheDocument();
  });

  it("disables only the row being repaired while its request is in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = transportWith([{ ...CUSTOMER }, { ...SUPPLIER }]);
    renderWithProviders(<OpeningBalanceDuplicatesCard />, {
      transport: async (path, init) => {
        if (init?.method === "POST") await gate;
        return base(path, init);
      },
      initialSession: testAdminSession,
    });

    const customer = await screen.findByRole("row", { name: /عميل مكرر/ });
    fireEvent.click(within(customer).getByRole("button", { name: "عكس الترحيل المكرر" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "ترحيل القيد العكسي" }));

    await waitFor(() => expect(within(customer).getByRole("button")).toBeDisabled());
    expect(within(screen.getByRole("row", { name: /مورد مكرر/ })).getByRole("button", { name: "عكس الترحيل المكرر" })).toBeEnabled();
    release?.();
    await waitFor(() => expect(screen.queryByRole("row", { name: /عميل مكرر/ })).not.toBeInTheDocument());
  });

  it("shows the server's Arabic refusal and leaves the row able to be tried again", async () => {
    renderWithProviders(<OpeningBalanceDuplicatesCard />, {
      transport: transportWith([{ ...CUSTOMER }], [], () => ({ status: 422, body: { error: "PERIOD_NOT_OPEN", message: "الفترة المحاسبية مغلقة؛ لا يمكن ترحيل القيد العكسي." } })),
      initialSession: testAdminSession,
    });
    const customer = await screen.findByRole("row", { name: /عميل مكرر/ });
    fireEvent.click(within(customer).getByRole("button", { name: "عكس الترحيل المكرر" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "ترحيل القيد العكسي" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة المحاسبية مغلقة؛ لا يمكن ترحيل القيد العكسي.");
    await waitFor(() => expect(within(customer).getByRole("button", { name: "عكس الترحيل المكرر" })).toBeEnabled());
  });

  it("lists the duplicates but offers no repair to a session that cannot post to the journal", async () => {
    renderWithProviders(<OpeningBalanceDuplicatesCard />, { transport: transportWith([CUSTOMER]), initialSession: restricted(["accounting.reports.view"]) });
    const customer = await screen.findByRole("row", { name: /عميل مكرر/ });
    expect(within(customer).queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when no opening balance was posted twice", async () => {
    const { container } = renderWithProviders(<OpeningBalanceDuplicatesCard />, { transport: transportWith([]), initialSession: testAdminSession });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByRole("heading", { name: "أرصدة افتتاحية مُرحّلة أكثر من مرة" })).not.toBeInTheDocument();
  });

  it("asks for nothing on behalf of a session that cannot view accounting reports", async () => {
    const asked: string[] = [];
    const base = transportWith([CUSTOMER]);
    renderWithProviders(<OpeningBalanceDuplicatesCard />, {
      transport: (path, init) => {
        asked.push(path);
        return base(path, init);
      },
      initialSession: restricted(["sales.invoice.view"]),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).not.toContain("/gl/opening-balance-duplicates");
  });
});
