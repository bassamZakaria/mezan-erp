// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaintextKeyRiskBanner, SupportInfoCard } from "./SupportInfoCard";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { DesktopLicenceResultDTO } from "../data/hooks";

/**
 * THE FIRST FOUR QUESTIONS OF EVERY SUPPORT CALL, and the two files that ruin a
 * shop years later.
 *
 * «ما هي نسختك؟» had three disagreeing answers, the `LIC-*` codes were
 * unreachable, the machine fingerprint could not be read anywhere in the
 * product, and `database-key.txt` was warned about only to a console.
 */

interface Bridge {
  mezan?: {
    licence?: { status(token: string): Promise<DesktopLicenceResultDTO> };
    appVersion?: () => Promise<string>;
    support?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  };
}

const FINGERPRINT = "8f3c0b1a44de9077a1c2f5b6e0d3a91c";

function desktopStatus(over: Partial<DesktopLicenceResultDTO> = {}): DesktopLicenceResultDTO {
  return {
    ok: true,
    code: "LIC-EXPIRED",
    messageAr: "انتهت صلاحية الترخيص.",
    state: "READ_ONLY",
    reason: "EXPIRED_PAST_GRACE",
    canWrite: false,
    plan: "ENTERPRISE",
    seats: 4,
    seatsUsed: 2,
    modules: ["sales"],
    expiresAt: "2026-01-01T00:00:00.000Z",
    fingerprint: FINGERPRINT,
    daysSinceCheckin: 6,
    licenceFilePath: "/u/license.mezan",
    appVersion: "2026.9.0",
    role: "host",
    databasePath: "/u/mezan.db",
    backupsDir: "/u/Mezan Backups",
    keyCardPath: null,
    plaintextArchivePath: null,
    lan: { listening: true, url: "https://192.168.1.7:4173", fingerprintSha256: null },
    ...over,
  } as DesktopLicenceResultDTO;
}

function installBridge(status: DesktopLicenceResultDTO, support: Bridge["mezan"] = {}): void {
  (globalThis as Bridge).mezan = {
    licence: { status: () => Promise.resolve(status) },
    appVersion: () => Promise.resolve("2026.9.0"),
    ...support,
  } as Bridge["mezan"];
}

function render(ui: React.ReactElement) {
  const transport = stubTransport({});
  return renderWithProviders(ui, { transport, initialSession: testAdminSession });
}

afterEach(() => {
  delete (globalThis as Bridge).mezan;
});

describe("SupportInfoCard — guards support #3", () => {
  it("shows the version, the LIC-* code, the role, seats, paths and the fingerprint", async () => {
    installBridge(desktopStatus());
    render(<SupportInfoCard />);

    expect(await screen.findByText("LIC-EXPIRED")).toBeInTheDocument();
    expect(screen.getByText("2026.9.0")).toBeInTheDocument();
    expect(screen.getByText("الجهاز الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("https://192.168.1.7:4173")).toBeInTheDocument();
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(FINGERPRINT)).toBeInTheDocument();
    expect(screen.getByText("/u/mezan.db")).toBeInTheDocument();
    expect(screen.getByText("/u/Mezan Backups")).toBeInTheDocument();
  });

  it("copies every fact in one press", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    installBridge(desktopStatus());
    render(<SupportInfoCard />);

    await userEvent.click(await screen.findByRole("button", { name: "نسخ معلومات الدعم" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain("2026.9.0");
    expect(copied).toContain("LIC-EXPIRED");
    expect(copied).toContain(FINGERPRINT);
    expect(await screen.findByText("تم نسخ معلومات الدعم.")).toBeInTheDocument();
  });

  it("writes the diagnostic file through the bridge and says where it went", async () => {
    const saveDiagnostic = vi.fn().mockResolvedValue({ ok: true, path: "/Desktop/d.json" });
    installBridge(desktopStatus(), { support: { saveDiagnostic } });
    render(<SupportInfoCard />);

    await userEvent.click(await screen.findByRole("button", { name: "حفظ ملف التشخيص" }));
    await waitFor(() => expect(saveDiagnostic).toHaveBeenCalled());
    const body = JSON.parse(saveDiagnostic.mock.calls[0]?.[1] as string) as {
      licence: { code: string; fingerprint: string };
    };
    expect(body.licence.code).toBe("LIC-EXPIRED");
    expect(body.licence.fingerprint).toBe(FINGERPRINT);
    expect(await screen.findByText(/\/Desktop\/d\.json/)).toBeInTheDocument();
  });

  // A fact this build cannot know renders as «غير معروف», never as a plausible
  // value that would send support down the wrong path.
  it("says «غير معروف» on the browser build rather than inventing facts", async () => {
    render(<SupportInfoCard />);
    expect(await screen.findAllByText("غير معروف")).not.toHaveLength(0);
    expect(screen.getByText(/لا تُعرف إلا على الجهاز الرئيسي/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حفظ ملف التشخيص" })).not.toBeInTheDocument();
  });
});

describe("PlaintextKeyRiskBanner — guards support #15", () => {
  it("stays silent while neither plaintext file is on disk", async () => {
    installBridge(desktopStatus());
    render(<PlaintextKeyRiskBanner />);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("names the key card, its path, and offers to reveal and delete it", async () => {
    const reveal = vi.fn().mockResolvedValue({ ok: true, path: "/u/database-key.txt" });
    const remove = vi.fn().mockResolvedValue({ ok: true, path: "/u/database-key.txt" });
    installBridge(desktopStatus({ keyCardPath: "/u/database-key.txt" }), {
      support: { reveal, remove },
    });
    render(<PlaintextKeyRiskBanner />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("/u/database-key.txt");

    await userEvent.click(screen.getByRole("button", { name: "افتح مجلد الملف" }));
    await waitFor(() => expect(reveal).toHaveBeenCalledWith("TEST-SESSION-TOKEN", "key-card"));

    // Deleting asks twice: the key card is unrecoverable, and losing it before
    // copying it makes every archive taken on this machine unopenable.
    await userEvent.click(screen.getByRole("button", { name: "تم — احذف الملف" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/سيُحذف هذا الملف نهائياً/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "نعم، احذفه" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("TEST-SESSION-TOKEN", "key-card"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("warns about the unencrypted pre-conversion archive too", async () => {
    installBridge(desktopStatus({ plaintextArchivePath: "/u/backups/plain.mezanbak" }));
    render(<PlaintextKeyRiskBanner />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("/u/backups/plain.mezanbak");
    expect(alert).toHaveTextContent("يقرأ دفاترك كلها بلا أي مفتاح");
  });
});
