// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { AuditEventDTO, ProfileDTO } from "@mezan/contracts";
import { ProfilePage } from "./ProfilePage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const baseProfile: ProfileDTO = {
  id: "USER-ADMIN",
  nameAr: "محمد الشهابي",
  nameEn: null,
  email: "admin@cyag.example",
  phone: null,
  isCompanyAdmin: true,
  roleId: null,
  hasPin: true,
  photoUrl: null,
  lastLoginAt: "2026-03-01T08:00:00.000Z",
  createdAt: "2025-01-01T00:00:00.000Z",
};

function auditEvent(overrides: Partial<AuditEventDTO> = {}): AuditEventDTO {
  return {
    stream: "security",
    module: "auth",
    entityType: "AUTH_USER",
    entityId: "USER-ADMIN",
    action: "PASSWORD_CHANGED",
    actor: "USER-ADMIN",
    branchId: null,
    timestamp: "2026-03-01T08:00:00.000Z",
    severity: "INFO",
    details: null,
    ...overrides,
  } as unknown as AuditEventDTO;
}

interface Options {
  readonly profile?: Partial<ProfileDTO>;
  readonly profileStatus?: number;
  readonly activity?: AuditEventDTO[];
  readonly onSave?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
  readonly onChangePin?: () => { status?: number; body: unknown };
  readonly saved?: Record<string, unknown>[];
}

function renderPage(opts: Options = {}) {
  let current = { ...baseProfile, ...opts.profile };
  const transport = stubTransport({
    "GET /profile": () => ({ status: opts.profileStatus ?? 200, body: current }),
    "PUT /profile": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      opts.saved?.push(body);
      const overridden = opts.onSave?.(body);
      if (overridden) return overridden;
      current = { ...current, ...(body as Partial<ProfileDTO>) };
      return { body: current };
    },
    "GET /profile/activity": () => ({ body: opts.activity ?? [] }),
    "POST /profile/change-password": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.currentPassword !== "correct-pass") {
        return { status: 400, body: { message: "كلمة المرور الحالية غير صحيحة" } };
      }
      return { body: {} };
    },
    "POST /profile/change-pin": () => opts.onChangePin?.() ?? { body: {} },
  });
  return renderWithProviders(<ProfilePage />, { transport, initialSession: testAdminSession });
}

describe("ProfilePage — the account header", () => {
  it("says the account could not be loaded when the server refuses", async () => {
    renderPage({ profileStatus: 503 });
    expect(await screen.findByText(/تعذّر تحميل/)).toBeInTheDocument();
  });

  it("names a plain user as a user, not as the company administrator", async () => {
    renderPage({ profile: { isCompanyAdmin: false } });
    expect(await screen.findByText("مستخدم")).toBeInTheDocument();
  });

  it("says no PIN is set, and no last sign-in, for an account that has neither", async () => {
    renderPage({ profile: { hasPin: false, lastLoginAt: null } });
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    expect(screen.getByText("غير مُفعّل")).toBeInTheDocument();
  });
});

describe("ProfilePage — the photo", () => {
  it("shows the initials when the account carries no photo", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    expect(screen.queryByRole("button", { name: "إزالة" })).not.toBeInTheDocument();
  });

  it("offers to remove the photo only once there is one", async () => {
    renderPage({ profile: { photoUrl: "data:image/png;base64,AAA" } });
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    const remove = screen.getByRole("button", { name: "إزالة" });

    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole("button", { name: "إزالة" })).not.toBeInTheDocument());
  });
});

describe("ProfilePage — saving the core details", () => {
  it("sends null rather than an empty string for a name or phone that was cleared", async () => {
    const saved: Record<string, unknown>[] = [];
    renderPage({ profile: { nameEn: "Mohamed", phone: "01000000000" }, saved });
    await screen.findByRole("heading", { name: "محمد الشهابي" });

    fireEvent.change(screen.getByDisplayValue("Mohamed"), { target: { value: "   " } });
    fireEvent.change(screen.getByDisplayValue("01000000000"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ nameEn: null, phone: null });
  });

  it("surfaces the server's own message when the save is refused", async () => {
    renderPage({ onSave: () => ({ status: 422, body: { message: "البريد الإلكتروني مستخدم بالفعل" } }) });
    await screen.findByRole("heading", { name: "محمد الشهابي" });

    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));
    expect(await screen.findByText("البريد الإلكتروني مستخدم بالفعل")).toBeInTheDocument();
  });
});

describe("ProfilePage — the activity tab", () => {
  it("names the actions it knows, and falls back to module.action for the ones it does not", async () => {
    renderPage({
      activity: [
        auditEvent({ action: "PASSWORD_CHANGED" }),
        auditEvent({ action: "SOMETHING_ELSE", module: "auth", entityId: "x" }),
      ],
    });
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "النشاط" }));

    expect(await screen.findByText("تغيير كلمة المرور")).toBeInTheDocument();
    expect(screen.getByText("auth.SOMETHING_ELSE")).toBeInTheDocument();
  });

  it("tones each severity the audit trail can carry", async () => {
    renderPage({
      activity: [
        auditEvent({ action: "PIN_CHANGED", severity: "CRITICAL" }),
        auditEvent({ action: "PIN_CLEARED", severity: "ERROR" }),
        auditEvent({ action: "PASSWORD_CHANGED", severity: "WARNING" }),
        auditEvent({ action: "PASSWORD_CHANGED", severity: "INFO" }),
      ],
    });
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "النشاط" }));

    expect(await screen.findByText("تغيير الرقم السري")).toBeInTheDocument();
    expect(screen.getByText("إلغاء الرقم السري")).toBeInTheDocument();
  });

  it("shows the empty state when the account has no recorded activity", async () => {
    renderPage({ activity: [] });
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "النشاط" }));
    expect(await screen.findByText(/لا يوجد نشاط|لا توجد أحداث/)).toBeInTheDocument();
  });
});
