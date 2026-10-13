// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintToolbar } from "./PrintToolbar";

type Bridge = { savePDF?: ReturnType<typeof vi.fn>; printToPDF?: ReturnType<typeof vi.fn> };

function installBridge(bridge: Bridge): Bridge {
  (window as unknown as { mezan?: Bridge }).mezan = bridge;
  return bridge;
}

afterEach(() => {
  delete (window as unknown as { mezan?: Bridge }).mezan;
  vi.restoreAllMocks();
});

describe("PrintToolbar — «حفظ PDF» on a document print page", () => {
  it("asks the desktop app to save the file, never to hand back bytes nobody writes", async () => {
    const bridge = installBridge({
      savePDF: vi.fn(async () => ({ ok: true, path: "/Users/owner/Documents/INV-000123.pdf" })),
      printToPDF: vi.fn(async () => new Uint8Array([1, 2, 3])),
    });
    render(<PrintToolbar pageSize="A4" landscape defaultFileName="INV-000123" />);

    await userEvent.click(screen.getByRole("button", { name: "حفظ PDF" }));

    expect(bridge.savePDF).toHaveBeenCalledWith({ pageSize: "A4", landscape: true, defaultFileName: "INV-000123" });
    expect(bridge.printToPDF).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("حُفظ الملف في: /Users/owner/Documents/INV-000123.pdf");
  });

  it("shows the reason in Arabic when the file could not be written", async () => {
    installBridge({ savePDF: vi.fn(async () => ({ ok: false, cancelled: false, message: "تعذّر حفظ ملف PDF. القرص ممتلئ" })) });
    render(<PrintToolbar pageSize="A4" />);

    await userEvent.click(screen.getByRole("button", { name: "حفظ PDF" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر حفظ ملف PDF. القرص ممتلئ");
  });

  it("says so in Arabic when the bridge itself rejects", async () => {
    installBridge({ savePDF: vi.fn(async () => Promise.reject(new Error("Error invoking remote method 'mezan:save-pdf'"))) });
    render(<PrintToolbar pageSize="A4" />);

    await userEvent.click(screen.getByRole("button", { name: "حفظ PDF" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذّر حفظ ملف PDF");
    expect(alert).not.toHaveTextContent("remote method");
  });

  it("says nothing when the owner closes the save dialog", async () => {
    const bridge = installBridge({ savePDF: vi.fn(async () => ({ ok: false, cancelled: true })) });
    render(<PrintToolbar pageSize="A5" />);

    await userEvent.click(screen.getByRole("button", { name: "حفظ PDF" }));

    await waitFor(() => expect(bridge.savePDF).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("in a browser there is no file to write: «طباعة» opens the print dialog and no dead save button is offered", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<PrintToolbar pageSize="A4" />);

    expect(screen.queryByRole("button", { name: "حفظ PDF" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "طباعة" }));
    expect(print).toHaveBeenCalledTimes(1);
  });
});
