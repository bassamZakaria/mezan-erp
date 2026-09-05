// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AppI18nProvider } from "./i18n";
import { UpdateBanner } from "./UpdateBanner";

interface Status {
  phase: string;
  version?: string;
  percent?: number;
  reason?: string;
}

function installBridge() {
  let listener: ((s: Status) => void) | null = null;
  const update = vi.fn((_action: string) => Promise.resolve({ phase: "idle" }));
  (globalThis as { mezan?: unknown }).mezan = {
    update,
    onUpdateEvent: (cb: (s: Status) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  };
  return {
    update,
    emit: (s: Status) => act(() => listener?.(s)),
  };
}

function renderBanner() {
  return render(
    <AppI18nProvider>
      <UpdateBanner />
    </AppI18nProvider>,
  );
}

afterEach(() => {
  delete (globalThis as { mezan?: unknown }).mezan;
});

describe("UpdateBanner", () => {
  it("renders nothing when there is no desktop update bridge (web edition)", () => {
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("offers the download when an update is available, and relays consent", () => {
    const bridge = installBridge();
    renderBanner();
    bridge.emit({ phase: "available", version: "1.4.0" });
    expect(screen.getByText(/1\.4\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("تنزيل التحديث"));
    expect(bridge.update).toHaveBeenCalledWith("download");
  });

  it("offers restart-to-install once the verified download is ready", () => {
    const bridge = installBridge();
    renderBanner();
    bridge.emit({ phase: "ready", version: "1.4.0" });
    fireEvent.click(screen.getByText("إعادة التشغيل والتثبيت"));
    expect(bridge.update).toHaveBeenCalledWith("install");
  });

  it("reports a refused (unauthentic) update as a security alert, not a silent retry", () => {
    const bridge = installBridge();
    renderBanner();
    bridge.emit({ phase: "rejected", version: "1.4.0", reason: "SIGNATURE_INVALID" });
    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر التحقق من صحة التحديث");
  });
});
