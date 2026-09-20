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

function installBridge(
  overrides: Partial<
    Record<"list" | "create" | "restore" | "revertToPreUpdate" | "exportPortable", unknown>
  > = {},
) {
  const bridge = {
    list: vi.fn(async () => ({ backupsDir: "/data/backups", entries: [entry] })),
    create: vi.fn(async () => ({ ok: true, entry })),
    restore: vi.fn(async () => ({ ok: true, restoredFrom: entry, safetyBackupFileName: "safety.mezanbak", relaunching: true })),
    revertToPreUpdate: vi.fn(async () => ({
      ok: true,
      restoredFrom: entry,
      safetyBackupFileName: "safety.mezanbak",
      relaunching: true,
    })),
    exportPortable: vi.fn(async () => ({ ok: true, filePath: "/data/backups/mezan-portable.enc" })),
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

  /**
   * guards support #14. The column printed `manual` / `scheduled` /
   * `pre-migration` / `on-close` raw — four English machine tokens in an Arabic
   * table, in the one place an owner looks while choosing which copy of their
   * books to restore.
   */
  it("names each archive's reason in Arabic and shows the version it recorded", async () => {
    installBridge({
      list: vi.fn(async () => ({
        backupsDir: "/data/backups",
        entries: [
          { ...entry, fileName: "a.mezanbak", reason: "manual" },
          { ...entry, fileName: "b.mezanbak", reason: "scheduled" },
          { ...entry, fileName: "c.mezanbak", reason: "pre-migration" },
          { ...entry, fileName: "d.mezanbak", reason: "on-close" },
          { ...entry, fileName: "e.mezanbak", reason: "pre-update" },
        ],
      })),
    });
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });

    expect(await screen.findByText("يدوي")).toBeInTheDocument();
    expect(screen.getByText("مجدول")).toBeInTheDocument();
    expect(screen.getByText("قبل ترقية قاعدة البيانات")).toBeInTheDocument();
    expect(screen.getByText("عند إغلاق البرنامج")).toBeInTheDocument();
    expect(screen.getByText("قبل تحديث البرنامج")).toBeInTheDocument();
    expect(screen.queryByText("pre-migration")).not.toBeInTheDocument();
    // The version each archive RECORDS — the build that wrote it, never this one.
    expect(screen.getAllByText("2026.8")).toHaveLength(5);
  });

  // A reason a newer build wrote is shown as it is rather than mislabelled as
  // one of the five this build knows.
  it("passes an unrecognised reason through instead of guessing", async () => {
    installBridge({
      list: vi.fn(async () => ({
        backupsDir: "/data/backups",
        entries: [{ ...entry, reason: "pre-restore" }],
      })),
    });
    renderWithProviders(<BackupRestorePage />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(await screen.findByText("pre-restore")).toBeInTheDocument();
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

    // The page also carries a standing «خذ نسخة الآن» staleness banner with
    // role="alert", so the refusal has to be picked out of the alerts on
    // screen rather than assumed to be the only one.
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((el) => el.textContent ?? "")).toContainEqual(
        expect.stringContaining("فشل التحقق من سلامة الملف."),
      ),
    );
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

/**
 * GUARDS U-9 and N-11 — the two routes this screen did not have: back out of an
 * update that broke the books, and take a copy that opens on other hardware
 * without leaving the shop's books in the clear in the backups folder.
 */
describe("BackupRestorePage — revert and portable export", () => {
  it("restores the pre-update copy without asking the owner to recognise a timestamp", async () => {
    const bridge = installBridge();
    renderWithProviders(<BackupRestorePage />, {
      transport: stubTransport({}),
      initialSession: testAdminSession,
    });

    await userEvent.click(await screen.findByRole("button", { name: "استعادة نسخة ما قبل التحديث" }));

    expect(bridge.revertToPreUpdate).toHaveBeenCalledWith(testAdminSession.token);
    await waitFor(() => expect(screen.getByText(/سيُعاد تشغيل التطبيق/)).toBeInTheDocument());
  });

  it("surfaces the main process's Arabic reason when there is no pre-update copy", async () => {
    installBridge({
      revertToPreUpdate: vi.fn(async () => ({
        ok: false,
        code: "NOT_FOUND",
        message: "لا توجد نسخة محفوظة قبل التحديث على هذا الجهاز.",
      })),
    });
    renderWithProviders(<BackupRestorePage />, {
      transport: stubTransport({}),
      initialSession: testAdminSession,
    });

    await userEvent.click(await screen.findByRole("button", { name: "استعادة نسخة ما قبل التحديث" }));

    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((el) => el.textContent ?? "")).toContainEqual(
        expect.stringContaining("لا توجد نسخة محفوظة قبل التحديث"),
      ),
    );
  });

  it("will not export a portable copy without a passphrase", async () => {
    const bridge = installBridge();
    renderWithProviders(<BackupRestorePage />, {
      transport: stubTransport({}),
      initialSession: testAdminSession,
    });

    const button = await screen.findByRole("button", { name: "تصدير" });
    expect(button).toBeDisabled();
    expect(bridge.exportPortable).not.toHaveBeenCalled();
  });

  it("exports under the passphrase the owner typed, and names the file it wrote", async () => {
    const bridge = installBridge();
    renderWithProviders(<BackupRestorePage />, {
      transport: stubTransport({}),
      initialSession: testAdminSession,
    });

    await userEvent.type(
      await screen.findByLabelText("كلمة سر النسخة المنقولة"),
      "kalimat-sirr-2026",
    );
    await userEvent.click(screen.getByRole("button", { name: "تصدير" }));

    expect(bridge.exportPortable).toHaveBeenCalledWith(testAdminSession.token, "kalimat-sirr-2026");
    await waitFor(() =>
      expect(screen.getByText(/mezan-portable\.enc/)).toBeInTheDocument(),
    );
  });
});
