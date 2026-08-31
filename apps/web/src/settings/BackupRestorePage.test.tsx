// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackupRestorePage } from "./BackupRestorePage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * The screen a restore was missing. `restoreBackup()` was implemented, tested
 * and called from nothing — no IPC, no menu, no screen — so the only
 * instruction the product gave was a `console.error` naming a function. These
 * assert the two things that make the screen worth having: that it reaches the
 * bridge at all, and that it cannot replace the books on a single misclick.
 */

const entry = {
  fileName: "mezan-2026-08-14T0300.mezanbak",
  createdAt: "2026-08-14T03:00:00.000Z",
  appVersion: "2026.8",
  reason: "scheduled",
  sizeBytes: 5_242_880,
  tables: { sales_invoice: 120 },
  readable: true,
};

function installBridge(overrides: Partial<Record<"list" | "create" | "restore", unknown>> = {}) {
  const bridge = {
    list: vi.fn(async () => ({ backupsDir: "/data/backups", entries: [entry] })),
    create: vi.fn(async () => ({ ok: true, entry })),
    restore: vi.fn(async () => ({ ok: true, restoredFrom: entry, safetyBackupFileName: "safety.mezanbak", relaunching: true })),
    ...overrides,
  };
  (globalThis as { mezan?: unknown }).mezan = { backup: bridge };
  return bridge;
}

afterEach(() => {
  delete (globalThis as { mezan?: unknown }).mezan;
});

describe("BackupRestorePage", () => {
  it("says so plainly on an edition that holds no database file", async () => {
    delete (globalThis as { mezan?: unknown }).mezan;
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(await screen.findByText(/تطبيق سطح المكتب فقط/)).toBeInTheDocument();
  });

  it("lists the archives on disk, newest first, with the folder to copy them from", async () => {
    installBridge();
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });

    expect(await screen.findByText("2026-08-14")).toBeInTheDocument();
    expect(screen.getByText("/data/backups")).toBeInTheDocument();
    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
  });

  it("passes the session token, because an IPC channel carries no headers", async () => {
    // Without it these handlers would be the one unauthenticated write surface
    // in the product: anything in the renderer could replace the books.
    const bridge = installBridge();
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });

    await waitFor(() => expect(bridge.list).toHaveBeenCalledWith(testAdminSession.token));
  });

  it("will not restore until the archive's own date is typed", async () => {
    const bridge = installBridge();
    const user = userEvent.setup();
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });

    await user.click(await screen.findByRole("button", { name: "استعادة" }));

    const confirm = screen.getByRole("button", { name: "استعادة واستبدال البيانات" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("اكتب تاريخ النسخة للتأكيد"), "2026-08-01");
    expect(confirm).toBeDisabled();
    expect(bridge.restore).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("اكتب تاريخ النسخة للتأكيد"));
    await user.type(screen.getByLabelText("اكتب تاريخ النسخة للتأكيد"), "2026-08-14");
    await waitFor(() => expect(confirm).toBeEnabled());

    await user.click(confirm);
    await waitFor(() => expect(bridge.restore).toHaveBeenCalledWith(testAdminSession.token, entry.fileName));
  });

  it("shows the refusal the main process gave, never its code", async () => {
    const bridge = installBridge({
      restore: vi.fn(async () => ({ ok: false, code: "VERIFICATION_FAILED", message: "فشل التحقق من سلامة الملف." })),
    });
    const user = userEvent.setup();
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });

    await user.click(await screen.findByRole("button", { name: "استعادة" }));
    await user.type(screen.getByLabelText("اكتب تاريخ النسخة للتأكيد"), "2026-08-14");
    await user.click(screen.getByRole("button", { name: "استعادة واستبدال البيانات" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("فشل التحقق من سلامة الملف.");
    await waitFor(() => expect(screen.queryByText(/VERIFICATION_FAILED/)).not.toBeInTheDocument());
    expect(bridge.restore).toHaveBeenCalledTimes(1);
  });

  it("marks a damaged archive rather than hiding it from the list", async () => {
    // A damaged archive the owner can SEE and be warned about beats one that
    // silently vanishes from the list they are counting on.
    installBridge({
      list: vi.fn(async () => ({
        backupsDir: "/data/backups",
        entries: [{ ...entry, readable: false, appVersion: null, reason: null, tables: null }],
      })),
    });
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });

    expect(await screen.findByText("ملف تالف")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "استعادة" })).not.toBeInTheDocument();
  });

  it("takes a backup on demand and refreshes the list", async () => {
    const bridge = installBridge();
    const user = userEvent.setup();
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });

    await user.click(await screen.findByRole("button", { name: "أخذ نسخة الآن" }));

    await waitFor(() => expect(bridge.create).toHaveBeenCalledWith(testAdminSession.token));
    expect(await screen.findByText("تم أخذ النسخة الاحتياطية.")).toBeInTheDocument();
    expect(bridge.list).toHaveBeenCalledTimes(2);
  });
});
