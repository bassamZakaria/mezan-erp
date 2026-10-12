// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { ReapprovalNotice } from "./ReapprovalNotice";

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
