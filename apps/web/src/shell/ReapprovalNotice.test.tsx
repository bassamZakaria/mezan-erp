// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { HeldDocumentReapproval, ReapprovalNotice } from "./ReapprovalNotice";

const REASON = "اعتُمد هذا المستند أو أُرسل للموافقة قبل تحديث النظام ولم يُرحَّل؛ الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد ليمرّ المستند على سلسلة الاعتماد الحالية.";
const standing = (status: string, reason: string | null = null) =>
  stubTransport({ "GET /workflow/requests/*/standing": () => ({ body: { id: "inv-1:confirm", status, reason, reasonEn: null } }) });

describe("ReapprovalNotice", () => {
  it("says in Arabic why the held document cannot be confirmed and offers to request approval again", async () => {
    const onRequestAgain = vi.fn();
    renderWithProviders(<ReapprovalNotice requestId="inv-1:confirm" pending={false} onRequestAgain={onRequestAgain} />, { transport: standing("reapproval_required", REASON), initialSession: testAdminSession });
    const notice = await screen.findByTestId("reapproval-notice");
    expect(notice).toHaveTextContent(REASON);
    fireEvent.click(screen.getByRole("button", { name: "طلب الموافقة من جديد" }));
    expect(onRequestAgain).toHaveBeenCalledTimes(1);
  });

  it("does not let the action fire twice while the request is on its way", async () => {
    renderWithProviders(<ReapprovalNotice requestId="inv-1:confirm" pending onRequestAgain={() => {}} />, { transport: standing("reapproval_required", REASON), initialSession: testAdminSession });
    await screen.findByTestId("reapproval-notice");
    expect(screen.getByRole("button", { name: "طلب الموافقة من جديد" })).toBeDisabled();
  });

  it.each(["pending", "approved", "rejected"])("says nothing for a request that is %s", async (status) => {
    let asked = 0;
    const transport = stubTransport({
      "GET /workflow/requests/*/standing": () => {
        asked += 1;
        return { body: { id: "inv-1:confirm", status, reason: null, reasonEn: null } };
      },
    });
    renderWithProviders(<ReapprovalNotice requestId="inv-1:confirm" pending={false} onRequestAgain={() => {}} />, { transport, initialSession: testAdminSession });
    await vi.waitFor(() => expect(asked).toBe(1));
    expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument();
  });

  it("asks nothing for a document that is not held", () => {
    let asked = 0;
    const transport = stubTransport({
      "GET /workflow/requests/*/standing": () => {
        asked += 1;
        return { body: {} };
      },
    });
    renderWithProviders(<ReapprovalNotice requestId={null} pending={false} onRequestAgain={() => {}} />, { transport, initialSession: testAdminSession });
    expect(asked).toBe(0);
    expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument();
  });
});

describe("HeldDocumentReapproval", () => {
  const held = { id: "ret-1", status: "pending", workflowRequestId: "ret-1:confirm" };

  it("asks for approval again through the document's own confirm and then reads the standing afresh", async () => {
    let status = "reapproval_required";
    let asked = 0;
    const transport = stubTransport({
      "GET /workflow/requests/*/standing": () => {
        asked += 1;
        return { body: { id: "ret-1:confirm", status, reason: status === "reapproval_required" ? REASON : null, reasonEn: null } };
      },
    });
    const confirm = vi.fn(async () => {
      status = "pending";
    });
    renderWithProviders(<HeldDocumentReapproval document={held} pending={false} confirm={confirm} />, { transport, initialSession: testAdminSession });
    expect(await screen.findByTestId("reapproval-notice")).toHaveTextContent(REASON);
    fireEvent.click(screen.getByRole("button", { name: "طلب الموافقة من جديد" }));
    await vi.waitFor(() => expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument());
    expect(confirm).toHaveBeenCalledWith("ret-1");
    expect(asked).toBeGreaterThan(1);
  });

  it("shows the server's refusal beside the notice and keeps the notice", async () => {
    const confirm = vi.fn(async () => {
      throw new Error("لا تملك صلاحية تأكيد هذا المستند.");
    });
    renderWithProviders(<HeldDocumentReapproval document={held} pending={false} confirm={confirm} />, { transport: standing("reapproval_required", REASON), initialSession: testAdminSession });
    await screen.findByTestId("reapproval-notice");
    fireEvent.click(screen.getByRole("button", { name: "طلب الموافقة من جديد" }));
    expect(await screen.findByText("لا تملك صلاحية تأكيد هذا المستند.")).toBeInTheDocument();
    expect(screen.getByTestId("reapproval-notice")).toBeInTheDocument();
  });

  it.each(["draft", "confirmed", "cancelled"])("asks nothing for a %s document", (documentStatus) => {
    let asked = 0;
    const transport = stubTransport({
      "GET /workflow/requests/*/standing": () => {
        asked += 1;
        return { body: {} };
      },
    });
    renderWithProviders(<HeldDocumentReapproval document={{ ...held, status: documentStatus }} pending={false} confirm={async () => {}} />, { transport, initialSession: testAdminSession });
    expect(asked).toBe(0);
  });
});

describe("every screen that confirms a document the approval gate can hold", () => {
  const GATED_CONFIRM_HOOKS = [
    "useConfirmSalesInvoice",
    "useConfirmVoucher",
    "useConfirmSalesReturn",
    "useConfirmPurchaseReturn",
    "useConfirmLandedCost",
    "useConfirmInstallmentPlan",
    "useConfirmStockAdjustment",
    "useConfirmStockTransfer",
  ];
  const screensDir = join(dirname(fileURLToPath(import.meta.url)), "../screens");
  const screens = readdirSync(screensDir)
    .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
    .map((file) => ({ file, source: readFileSync(join(screensDir, file), "utf8") }));

  it.each(GATED_CONFIRM_HOOKS)("%s — carries the re-approval notice", (hook) => {
    const using = screens.filter(({ source }) => new RegExp(`\\b${hook}\\b`).test(source));
    expect(using.length).toBeGreaterThan(0);
    expect(using.filter(({ source }) => !/<(ReapprovalNotice|HeldDocumentReapproval)\b/.test(source)).map(({ file }) => file)).toEqual([]);
  });
});
