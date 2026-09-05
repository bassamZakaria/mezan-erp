// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "./i18n";
import { ApiProvider } from "./data/ApiContext";
import { createQueryClient } from "./data/queryClient";
import { stubTransport, testAdminSession } from "./data/test-support";
import type { Transport } from "./data/transport";
import { LicenseBanner } from "./LicenseBanner";

function renderBanner(state: Record<string, unknown>) {
  const transport: Transport = stubTransport({ "GET /license/state": () => ({ body: state }) });
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider transport={transport} initialSession={testAdminSession}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  }
  return render(<LicenseBanner />, { wrapper: Wrapper });
}

describe("LicenseBanner", () => {
  it("renders nothing when the license is ACTIVE", async () => {
    const { container } = renderBanner({ state: "ACTIVE", canWrite: true, usable: true });
    // Give the query a tick; an ACTIVE license must never show a banner.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the read-only lockout message past grace", async () => {
    renderBanner({ state: "READ_ONLY", canWrite: false, usable: true, reason: "EXPIRED_PAST_GRACE" });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("القراءة فقط");
  });

  it("shows an escalating grace-period message while still writable", async () => {
    renderBanner({
      state: "GRACE",
      canWrite: true,
      usable: true,
      graceEndsAt: "2026-06-04T00:00:00.000Z",
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("فترة سماح");
  });

  it("shows the unauthentic-license message for a fingerprint mismatch", async () => {
    renderBanner({ state: "FINGERPRINT_MISMATCH", canWrite: false, usable: false, reason: "MACHINE_NOT_BOUND" });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر التحقق من الترخيص");
  });
});
