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
    expect(container.textContent).toBe("");
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

  /**
   * GUARDS U-5 / support ticket #8. The red bar had no dismiss control and sat
   * across every screen until the app restarted.
   */
  it("can be dismissed after a failure, instead of sitting there until restart", () => {
    const bridge = installBridge();
    renderBanner();
    bridge.emit({ phase: "error", reason: "boom" });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByText("إخفاء"));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("can be dismissed after a refused update too", () => {
    const bridge = installBridge();
    renderBanner();
    bridge.emit({ phase: "rejected", version: "1.4.0", reason: "SIGNATURE_INVALID" });
    fireEvent.click(screen.getByText("إخفاء"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * GUARDS U-5. A build with no feed and no vendor key — every machine in the
   * field today — answered «تعذّر إكمال التحديث» in red. It is not a failure.
   */
  it("reports an install with no update channel as information, not an error", () => {
    const bridge = installBridge();
    renderBanner();
    bridge.emit({ phase: "unavailable" });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "لا تتوفر تحديثات تلقائية في هذه النسخة",
    );
  });

  it("says the update will be installed on close once that has been chosen", () => {
    const bridge = installBridge();
    renderBanner();
    bridge.emit({ phase: "scheduled", version: "1.4.0" });
    expect(screen.getByRole("status")).toHaveTextContent("سيُثبَّت التحديث عند إغلاق البرنامج");
  });

  /** GUARDS Q-3: the launch backup now has a window and a sentence on it. */
  it("explains the pre-update backup instead of leaving a frozen screen", () => {
    const bridge = installBridge();
    renderBanner();
    bridge.emit({ phase: "migrating", version: "1.4.0" });
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ أخذ نسخة احتياطية");
    // No dismiss here: hiding it would leave a busy app with no reason on screen.
    expect(screen.queryByText("إخفاء")).toBeNull();
  });

  /**
   * GUARDS the missing `.catch` in update-hooks (N-7 / ticket #8): on a client
   * the channel is refused, and an unhandled rejection made the button dead.
   */
  it("shows a failure when the main process rejects, rather than doing nothing", async () => {
    const bridge = installBridge();
    bridge.update.mockImplementation(() => Promise.reject(new Error("No handler registered")));
    renderBanner();
    bridge.emit({ phase: "ready", version: "1.4.0" });

    await act(async () => {
      fireEvent.click(screen.getByText("إعادة التشغيل والتثبيت"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر إكمال التحديث");
  });
});
