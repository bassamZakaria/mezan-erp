// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://192.168.1.20:5173/" }
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";
import { holdsItsOwnBooks, LookupHost, lookupHostOf } from "./lookup-host";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Transport } from "../data/transport";

const UNREACHABLE = "تعذّر الوصول إلى الجهاز الرئيسي. تأكّد أنه يعمل وأن هذا الجهاز على الشبكة نفسها. سنعيد المحاولة تلقائيًا.";

describe("a till on the shop's network whose host machine does not answer", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("says the host machine cannot be reached, in Arabic, and never asks for a company code", async () => {
    let lookups = 0;
    const base = stubTransport({ "POST /auth/login": () => ({ body: testAdminSession }) });
    const transport: Transport = (path, init) => {
      if (!path.startsWith("/platform/resolve")) return base(path, init);
      lookups += 1;
      return Promise.reject(new Error("network down"));
    };
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });

    expect(await screen.findByText(UNREACHABLE)).toHaveAttribute("role", "status");
    await vi.waitFor(() => expect(lookups).toBeGreaterThan(0));
    expect(screen.queryByRole("textbox", { name: "رمز المنشأة" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("رمز PIN رقم 1")).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers neither the first-run wizard nor the cloud's signup page: a till sets nothing up", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({ "POST /auth/login": () => ({ body: testAdminSession }), "GET /bootstrap/status": () => ({ body: { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0, claimed: false } }) }),
    });

    await screen.findByLabelText("رمز PIN رقم 1");
    expect(screen.queryByRole("button", { name: "الإعداد الأولي" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "أنشئ حسابًا جديدًا" })).not.toBeInTheDocument();
  });

  it("says nothing of the kind while the host answers", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: stubTransport({ "POST /auth/login": () => ({ body: testAdminSession }) }) });

    await screen.findByLabelText("رمز PIN رقم 1");
    expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument();
  });
});

describe("which sign-in screens are on the machine that holds the company's books, where the first-run wizard can run", () => {
  it.each([
    [LookupHost.DesktopHost, false, true],
    [LookupHost.DesktopHost, true, true],
    [LookupHost.Cloud, true, true],
    [LookupHost.Cloud, false, false],
    [LookupHost.LanTill, true, false],
    [LookupHost.LanTill, false, false],
  ])("%s, with no platform in front: %s → %s", (host, noPlatformInFront, expected) => {
    expect(holdsItsOwnBooks(host, noPlatformInFront)).toBe(expected);
  });
});

describe("which kind of host the sign-in screen is opened on", () => {
  it.each(["192.168.1.20", "10.0.0.7", "172.16.4.2", "172.31.255.1", "169.254.10.10", "till-host.local"])("treats %s as a till on the shop's network", (hostname) => {
    expect(lookupHostOf(hostname)).toBe(LookupHost.LanTill);
  });

  it.each(["app.mezan.example", "nile.mezan.example", "172.32.0.1", "11.0.0.1", "localhost", "127.0.0.1", "192.168.example.com"])("treats %s as the cloud", (hostname) => {
    expect(lookupHostOf(hostname)).toBe(LookupHost.Cloud);
  });

  it("treats a machine carrying the desktop bridge as the desktop host, whatever its address", () => {
    const desktop = globalThis as { mezan?: unknown };
    desktop.mezan = { licence: { status: async () => ({}) } };
    try {
      expect(lookupHostOf("192.168.1.20")).toBe(LookupHost.DesktopHost);
    } finally {
      delete desktop.mezan;
    }
  });
});
