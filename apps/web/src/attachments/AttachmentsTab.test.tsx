// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { AttachmentDTO } from "@mezan/contracts";
import { AttachmentsTab } from "./AttachmentsTab";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Session } from "../data/session";
import type { Transport } from "../data/transport";

const readOnlySession: Session = {
  ...testAdminSession,
  userId: "USER-CLERK",
  isCompanyAdmin: false,
  // Holds view but NOT the "inventory.item.edit" (manage) permission.
  permissions: ["inventory.item.view"],
};

const attachment = (over: Partial<AttachmentDTO> = {}): AttachmentDTO => ({
  id: "ATT-1",
  entityType: "item",
  entityId: "ITEM-1",
  fileName: "invoice-scan.pdf",
  mimeType: "application/pdf",
  byteSize: 2048,
  uploadedBy: "محمد الشهابي",
  uploadedAt: "2026-01-15T10:00:00.000Z",
  notes: null,
  ...over,
});

function renderTab(
  rows: AttachmentDTO[],
  opts: {
    session?: Session;
    onUpload?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
    uploadRequests?: Record<string, unknown>[];
    onDelete?: (id: string) => { status?: number; body: unknown } | undefined;
    deleteRequests?: string[];
    onDownload?: (id: string) => { status?: number; body: unknown };
    features?: Record<string, boolean>;
    entitlementsPending?: boolean;
  } = {},
) {
  let current = [...rows];
  const stubbed = stubTransport({
    "GET /entitlements": () => ({ body: { plan: "enterprise", activeModules: ["inventory"], features: opts.features ?? {}, seats: 25, expiresAt: null } }),
    "GET /attachments": () => ({ body: current }),
    "POST /attachments": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      opts.uploadRequests?.push(body);
      const overridden = opts.onUpload?.(body);
      if (overridden) return overridden;
      const created = attachment({
        id: `ATT-${current.length + 1}`,
        fileName: body.fileName,
        mimeType: body.mimeType,
        byteSize: Math.floor(((body.contentBase64 as string) ?? "").length * 0.75),
        notes: body.notes ?? null,
      });
      current = [...current, created];
      return { status: 201, body: created };
    },
    "DELETE /attachments/*": (_init, path) => {
      const id = path.split("/").pop() as string;
      opts.deleteRequests?.push(id);
      const overridden = opts.onDelete?.(id);
      if (overridden) return overridden;
      current = current.filter((a) => a.id !== id);
      return { status: 204, body: {} };
    },
    "GET /attachments/*/content": (_init, path) => {
      const id = path.split("/")[path.split("/").length - 2] as string;
      if (opts.onDownload) return opts.onDownload(id);
      const row = current.find((a) => a.id === id)!;
      return { body: { ...row, contentBase64: btoa("hello world") } };
    },
  });
  const transport: Transport = (path, init) =>
    opts.entitlementsPending && path.startsWith("/entitlements") ? new Promise(() => undefined) : stubbed(path, init);
  const result = renderWithProviders(<AttachmentsTab entityType="item" entityId="ITEM-1" />, {
    transport,
    initialSession: opts.session ?? testAdminSession,
  });
  return { ...result, getCurrent: () => current };
}

describe("AttachmentsTab", () => {
  it("shows the empty state (not a blank table) when there are no attachments, with the byte-limit hint", async () => {
    renderTab([]);
    expect(await screen.findByText("لا توجد مرفقات")).toBeInTheDocument();
    expect(screen.getByText(/الحد الأقصى لحجم الملف 5 م\.ب/)).toBeInTheDocument();
  });

  it("lists attachments with their real filename, uploader and size", async () => {
    renderTab([attachment({ id: "ATT-1", fileName: "عقد-2026.pdf", byteSize: 3145728, uploadedBy: "سارة عادل" })]);
    expect(await screen.findByText("عقد-2026.pdf")).toBeInTheDocument();
    expect(screen.getByText("سارة عادل")).toBeInTheDocument();
    // 3145728 bytes = 3.0 MB.
    expect(screen.getByText("3 م.ب")).toBeInTheDocument();
  });

  it("uploading sends the real base64-encoded file content, name and mime type, and the new row appears", async () => {
    const uploadRequests: Record<string, unknown>[] = [];
    renderTab([], { uploadRequests });
    await screen.findByText("لا توجد مرفقات");

    const file = new File(["hello world"], "note.txt", { type: "text/plain" });
    const input = screen.getByLabelText("اختيار ملف للإرفاق") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadRequests).toHaveLength(1));
    const body = uploadRequests[0]!;
    expect(body.fileName).toBe("note.txt");
    expect(body.mimeType).toBe("text/plain");
    expect(atob(body.contentBase64 as string)).toBe("hello world");
    expect(await screen.findByText("note.txt")).toBeInTheDocument();
  });

  it("an empty file is rejected client-side — the upload mutation is never called, and no row is added", async () => {
    const uploadRequests: Record<string, unknown>[] = [];
    renderTab([], { uploadRequests });
    await screen.findByText("لا توجد مرفقات");

    const file = new File([], "empty.txt", { type: "text/plain" });
    const input = screen.getByLabelText("اختيار ملف للإرفاق") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("لا يمكن إرفاق ملف فارغ")).toBeInTheDocument();
    expect(uploadRequests).toHaveLength(0);
    expect(screen.getByText("لا توجد مرفقات")).toBeInTheDocument();
  });

  it("a file over the 5 MB limit is rejected client-side — the upload mutation is never called", async () => {
    const uploadRequests: Record<string, unknown>[] = [];
    renderTab([], { uploadRequests });
    await screen.findByText("لا توجد مرفقات");

    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.bin", { type: "application/octet-stream" });
    const input = screen.getByLabelText("اختيار ملف للإرفاق") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [oversized] } });

    expect(await screen.findByText(/حجم الملف يتجاوز الحد المسموح/)).toBeInTheDocument();
    expect(uploadRequests).toHaveLength(0);
  });

  it("a server-refused upload shows the error and does NOT add a row to the list", async () => {
    renderTab([attachment({ id: "ATT-1", fileName: "existing.pdf" })], {
      onUpload: () => ({ status: 413, body: { message: "الملف كبير جداً على الخادم" } }),
    });
    await screen.findByText("existing.pdf");

    const file = new File(["x"], "rejected.txt", { type: "text/plain" });
    const input = screen.getByLabelText("اختيار ملف للإرفاق") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("الملف كبير جداً على الخادم")).toBeInTheDocument();
    // The existing row is still there, and no second row was added.
    expect(screen.getByText("existing.pdf")).toBeInTheDocument();
    expect(screen.queryByText("rejected.txt")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2); // header row + the one existing attachment
  });

  it("deleting one attachment removes exactly that row and leaves the other row's controls enabled throughout", async () => {
    const deleteRequests: string[] = [];
    renderTab([attachment({ id: "ATT-1", fileName: "keep-me.pdf" }), attachment({ id: "ATT-2", fileName: "delete-me.pdf" })], {
      deleteRequests,
    });
    await screen.findByText("delete-me.pdf");

    const deleteMeRow = screen.getByText("delete-me.pdf").closest("tr")!;
    const keepMeRow = screen.getByText("keep-me.pdf").closest("tr")!;
    fireEvent.click(within(deleteMeRow).getByRole("button", { name: "حذف الملف delete-me.pdf" }));

    // While ATT-2's delete is in flight, ATT-1's own buttons must stay enabled —
    // a mutation-wide `isPending` disabling every row is the bug this catches.
    expect(within(keepMeRow).getByRole("button", { name: "تنزيل" })).toBeEnabled();
    expect(within(keepMeRow).getByRole("button", { name: "حذف الملف keep-me.pdf" })).toBeEnabled();

    await waitFor(() => expect(screen.queryByText("delete-me.pdf")).not.toBeInTheDocument());
    expect(screen.getByText("keep-me.pdf")).toBeInTheDocument();
    expect(deleteRequests).toEqual(["ATT-2"]);
  });

  it("a failed delete shows the error and leaves the row in place — nothing silently disappears", async () => {
    renderTab([attachment({ id: "ATT-1", fileName: "locked.pdf" })], {
      onDelete: () => ({ status: 403, body: { message: "لا تملك صلاحية حذف هذا الملف" } }),
    });
    await screen.findByText("locked.pdf");
    fireEvent.click(screen.getByRole("button", { name: "حذف الملف locked.pdf" }));

    expect(await screen.findByText("لا تملك صلاحية حذف هذا الملف")).toBeInTheDocument();
    expect(screen.getByText("locked.pdf")).toBeInTheDocument();
  });

  it("downloading fetches the real bytes and hands the browser the exact filename and mime type", async () => {
    let capturedBlob: Blob | null = null;
    let capturedFileName = "";
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      capturedFileName = this.download;
    });

    renderTab([attachment({ id: "ATT-1", fileName: "بيان-حساب.pdf", mimeType: "application/pdf" })]);
    await screen.findByText("بيان-حساب.pdf");
    fireEvent.click(screen.getByRole("button", { name: "تنزيل" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(capturedFileName).toBe("بيان-حساب.pdf");
    expect(capturedBlob).not.toBeNull();
    expect((capturedBlob as unknown as Blob).type).toBe("application/pdf");
    const text = await (capturedBlob as unknown as Blob).text();
    expect(text).toBe("hello world");

    clickSpy.mockRestore();
  });

  it("a failed download shows the error and does not throw — the row stays and its button re-enables", async () => {
    renderTab([attachment({ id: "ATT-1", fileName: "broken-link.pdf" })], {
      onDownload: () => ({ status: 500, body: { error: "INTERNAL" } }),
    });
    await screen.findByText("broken-link.pdf");
    const downloadButton = screen.getByRole("button", { name: "تنزيل" });
    fireEvent.click(downloadButton);

    // guards §4.5 #13 — the fallback sentence now carries the status as a support code.
    expect(await screen.findByText(/^تعذّر تنزيل الملف/)).toBeInTheDocument();
    expect(downloadButton).toBeEnabled();
  });

  it("a session without the entity's manage permission cannot upload or delete, but can still download", async () => {
    renderTab([attachment({ id: "ATT-1", fileName: "read-only.pdf" })], { session: readOnlySession });
    await screen.findByText("read-only.pdf");

    expect(screen.queryByRole("button", { name: "إرفاق ملف" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("اختيار ملف للإرفاق")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حذف الملف read-only.pdf" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تنزيل" })).toBeInTheDocument();
  });

  it("shows a retry control when the list fails to load, and retry re-issues the request", async () => {
    let calls = 0;
    let fail = true;
    const transport = stubTransport({
      "GET /attachments": () => {
        calls += 1;
        if (fail) return { status: 500, body: { error: "INTERNAL" } };
        return { body: [] };
      },
    });
    renderWithProviders(<AttachmentsTab entityType="item" entityId="ITEM-1" />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل المرفقات")).toBeInTheDocument();
    const callsBeforeRetry = calls;

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("لا توجد مرفقات");
    expect(calls).toBeGreaterThan(callsBeforeRetry);
  });
});

describe("AttachmentsTab — #125 separate attachment permissions in the top edition", () => {
  const SEPARATE = { "attachments.separate_permissions": true };
  const editor = (permissions: string[]): Session => ({ ...readOnlySession, permissions });

  it("below the top edition the item's edit right still offers upload and delete", async () => {
    renderTab([attachment()], { session: editor(["inventory.item.view", "inventory.item.edit"]) });
    expect(await screen.findByText("invoice-scan.pdf")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "إرفاق ملف" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /حذف/ })).toBeInTheDocument();
  });

  it("offers neither upload nor delete until the edition is known, so the top edition never flashes them", async () => {
    renderTab([attachment()], { session: editor(["inventory.item.view", "inventory.item.edit"]), entitlementsPending: true });
    expect(await screen.findByText("invoice-scan.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إرفاق ملف" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
  });

  it("in the top edition the edit right alone offers neither upload nor delete", async () => {
    renderTab([attachment()], { session: editor(["inventory.item.view", "inventory.item.edit", "admin.attachment.view"]), features: SEPARATE });
    expect(await screen.findByText("invoice-scan.pdf")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "إرفاق ملف" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
  });

  it("in the top edition upload and delete follow their own rights", async () => {
    renderTab([attachment()], {
      session: editor(["inventory.item.view", "inventory.item.edit", "admin.attachment.view", "admin.attachment.upload"]),
      features: SEPARATE,
    });
    expect(await screen.findByText("invoice-scan.pdf")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "إرفاق ملف" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
  });

  it("in the top edition a user without the view right is told so, not shown a load error", async () => {
    renderTab([attachment()], { session: editor(["inventory.item.view"]), features: SEPARATE });
    expect(await screen.findByText(/لا تملك صلاحية «عرض — المرفقات»/)).toBeInTheDocument();
  });
});
