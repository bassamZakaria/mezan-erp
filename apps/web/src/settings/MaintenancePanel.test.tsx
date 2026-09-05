// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MaintenancePanel } from "./MaintenancePanel";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function installBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    backup: { create: vi.fn(async () => ({ ok: true })) },
    licence: {
      status: vi.fn(async () => ({ ok: true })),
      checkin: vi.fn(async () => ({
        reachedServer: true,
        revoked: false,
        daysSince: 0,
        messageAr: "تم التحقق من الترخيص بنجاح.",
      })),
    },
    update: vi.fn(async () => ({ phase: "not-available" })),
    onUpdateEvent: vi.fn(() => () => undefined),
    ...overrides,
  };
  (globalThis as { mezan?: unknown }).mezan = bridge;
  return bridge;
}

function render() {
  renderWithProviders(<MaintenancePanel />, { transport: stubTransport({}), initialSession: testAdminSession });
}

afterEach(() => {
  delete (globalThis as { mezan?: unknown }).mezan;
});

describe("MaintenancePanel", () => {
  it("renders nothing on the web edition, where none of these channels exist", () => {
    delete (globalThis as { mezan?: unknown }).mezan;
    render();
    expect(screen.queryByText("الصيانة والتحديثات")).not.toBeInTheDocument();
  });

  it("takes a backup on demand, passing the session token", async () => {
    const bridge = installBridge();
    render();
    await userEvent.click(screen.getByRole("button", { name: "أخذ نسخة الآن" }));
    expect(bridge.backup.create).toHaveBeenCalledWith(testAdminSession.token);
    expect(await screen.findByRole("status")).toHaveTextContent("تم أخذ النسخة الاحتياطية.");
  });

  it("shows the check-in handler's own Arabic verdict rather than re-wording it", async () => {
    const bridge = installBridge();
    render();
    await userEvent.click(screen.getByRole("button", { name: "تحقّق من الترخيص الآن" }));
    expect(bridge.licence.checkin).toHaveBeenCalledWith(testAdminSession.token);
    expect(await screen.findByRole("status")).toHaveTextContent("تم التحقق من الترخيص بنجاح.");
  });

  it("says the machine is up to date, because the banner only renders once there IS an update", async () => {
    installBridge();
    render();
    await userEvent.click(screen.getByRole("button", { name: "ابحث عن تحديثات" }));
    expect(await screen.findByRole("status")).toHaveTextContent("النسخة المثبّتة هي الأحدث.");
  });
});
