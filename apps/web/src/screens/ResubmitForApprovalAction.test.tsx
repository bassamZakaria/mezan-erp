// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { DocumentApprovalStatus, type SessionDTO } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import {
  ResubmitFamily,
  ResubmitForApprovalAction,
  resubmitRowMenuItems,
  useResubmitForApproval,
  type ResubmittableDocument,
} from "./ResubmitForApprovalAction";

const REASON = "الكمية لا تطابق محضر الاستلام";
const LABEL = "إعادة الإرسال للاعتماد";

const document = (over: Partial<ResubmittableDocument> = {}): ResubmittableDocument => ({
  id: "D-1",
  docNo: null,
  status: "draft",
  approval: { status: DocumentApprovalStatus.Rejected, rejectionReason: REASON, rejectedBy: "USER-BOSS" },
  ...over,
});

const FAMILIES: readonly (readonly [ResubmitFamily, string, string])[] = [
  [ResubmitFamily.SalesReturns, "POST /sales-returns/*/resubmit", "sales.return.confirm"],
  [ResubmitFamily.PurchaseReturns, "POST /purchase-returns/*/resubmit", "purchases.return.confirm"],
  [ResubmitFamily.LandedCosts, "POST /landed-costs/*/resubmit", "purchases.landed_cost.confirm"],
  [ResubmitFamily.StockAdjustments, "POST /inventory/stock-adjustments/*/resubmit", "inventory.adjustment.confirm"],
  [ResubmitFamily.StockTransfers, "POST /inventory/stock-transfers/*/resubmit", "inventory.transfer.confirm"],
  [ResubmitFamily.Vouchers, "POST /vouchers/*/resubmit", "treasury.cash_voucher.confirm"],
];

const trigger = () => screen.queryByRole("button", { name: LABEL });

describe("ResubmitForApprovalAction — «إعادة الإرسال للاعتماد» on a rejected document", () => {
  it.each(FAMILIES)("%s: shows the rejecter's reason and sends one resubmit to the family's own route", async (family, route) => {
    const sent: string[] = [];
    let refuse = true;
    const transport = stubTransport({
      [route]: () => {
        sent.push(route);
        if (refuse) return { status: 409, body: { error: "DOCUMENT_RESUBMIT_REFUSED", message: "المستند بانتظار الموافقة بالفعل، ولا حاجة لإعادة إرساله." } };
        return { body: { document: document({ status: "pending" }), held: true } };
      },
    });
    renderWithProviders(<ResubmitForApprovalAction family={family} document={document()} />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("note")).toHaveTextContent(REASON);
    fireEvent.click(trigger()!);
    expect(await screen.findByRole("alert")).toHaveTextContent("بانتظار الموافقة بالفعل");
    refuse = false;
    fireEvent.click(trigger()!);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(sent).toEqual([route, route]);
  });

  it.each(FAMILIES)("%s: is offered only on a rejected draft, to a caller who may confirm it", (family, _route, permission) => {
    const confirmer: SessionDTO = { ...testAdminSession, permissions: [permission] };
    const reader: SessionDTO = { ...testAdminSession, permissions: ["sales.return.view", "treasury.cash_voucher.view"] };
    for (const [doc, session] of [
      [document(), reader],
      [document({ approval: null }), confirmer],
      [document({ approval: { status: DocumentApprovalStatus.Approved, rejectionReason: null, rejectedBy: null } }), confirmer],
      [document({ status: "pending", approval: { status: DocumentApprovalStatus.Pending, rejectionReason: REASON, rejectedBy: "USER-BOSS" } }), confirmer],
    ] as const) {
      const { unmount } = renderWithProviders(<ResubmitForApprovalAction family={family} document={doc} />, { transport: stubTransport({}), initialSession: session });
      expect(trigger()).toBeNull();
      unmount();
    }
    renderWithProviders(<ResubmitForApprovalAction family={family} document={document()} />, { transport: stubTransport({}), initialSession: confirmer });
    expect(trigger()).not.toBeNull();
  });
});

function Rows({ documents }: { documents: readonly ResubmittableDocument[] }) {
  const resubmit = useResubmitForApproval(ResubmitFamily.SalesReturns);
  return (
    <ul>
      {documents.map((doc) => (
        <li key={doc.id}>
          {resubmitRowMenuItems(resubmit, doc).map((item) => (
            <button key={item.key} disabled={item.disabled} onClick={item.onSelect}>
              {`${item.label} ${doc.id}`}
            </button>
          ))}
        </li>
      ))}
    </ul>
  );
}

describe("the resubmit row action in a list", () => {
  it("disables only the row being resubmitted, sends nothing for a second click, and frees the row when the request settles", async () => {
    let release: (() => void) | undefined;
    const calls: string[] = [];
    const transport: ReturnType<typeof stubTransport> = async (path, init) => {
      calls.push(`${init?.method ?? "GET"} ${path}`);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Response(JSON.stringify({ error: "DOCUMENT_RESUBMIT_REFUSED", message: "تعذّرت إعادة إرسال المستند للاعتماد." }), { status: 409 });
    };
    renderWithProviders(<Rows documents={[document({ id: "A" }), document({ id: "B" }), document({ id: "C", approval: null })]} />, { transport, initialSession: testAdminSession });
    expect(screen.queryByRole("button", { name: `${LABEL} C` })).toBeNull();
    const rowA = () => screen.getByRole("button", { name: `${LABEL} A` });
    const rowB = () => screen.getByRole("button", { name: `${LABEL} B` });

    fireEvent.click(rowA());
    await waitFor(() => expect(rowA()).toBeDisabled());
    expect(rowB()).toBeEnabled();
    fireEvent.click(rowB());
    expect(calls).toEqual(["POST /sales-returns/A/resubmit"]);

    await act(async () => release?.());
    await waitFor(() => expect(rowA()).toBeEnabled());
    expect(calls).toEqual(["POST /sales-returns/A/resubmit"]);
  });
});
