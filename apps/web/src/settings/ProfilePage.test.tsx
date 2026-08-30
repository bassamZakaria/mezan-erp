// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { ProfileDTO } from "@mezan/contracts";
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

function renderPage(overrides: Partial<ProfileDTO> = {}) {
  let current = { ...baseProfile, ...overrides };
  let seenBody: unknown = null;
  const transport = stubTransport({
    "GET /profile": () => ({ body: current }),
    "PUT /profile": (init) => {
      seenBody = JSON.parse((init?.body as string) ?? "{}");
      current = { ...current, ...(seenBody as Partial<ProfileDTO>) };
      return { body: current };
    },
    "GET /profile/activity": () => ({ body: [] }),
    "POST /profile/change-password": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.currentPassword !== "correct-pass") {
        return { status: 400, body: { message: "كلمة المرور الحالية غير صحيحة" } };
      }
      return { body: {} };
    },
    "POST /profile/change-pin": () => ({ body: {} }),
  });
  const result = renderWithProviders(<ProfilePage />, { transport, initialSession: testAdminSession });
  return { ...result, getSeenBody: () => seenBody };
}

describe("ProfilePage — info tab", () => {
  it("loads and shows the current profile's name and email in the header", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "محمد الشهابي" })).toBeInTheDocument();
    expect(screen.getByText("admin@cyag.example")).toBeInTheDocument();
  });

  it("editing a field and saving sends exactly what was typed", async () => {
    const { getSeenBody } = renderPage();
    await screen.findByRole("heading", { name: "محمد الشهابي" });

    const nameInput = screen.getByDisplayValue("محمد الشهابي");
    fireEvent.change(nameInput, { target: { value: "محمد الشهابي المعدّل" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));

    await screen.findByText("تم حفظ بيانات الحساب.");
    expect((getSeenBody() as { nameAr: string }).nameAr).toBe("محمد الشهابي المعدّل");
  });

  it("a save the backend rejects shows an Arabic refusal, not a raw error code", async () => {
    const transport = stubTransport({
      "GET /profile": () => ({ body: baseProfile }),
      "GET /profile/activity": () => ({ body: [] }),
      "PUT /profile": () => ({ status: 400, body: { message: "البريد الإلكتروني مستخدم بالفعل" } }),
    });
    renderWithProviders(<ProfilePage />, { transport, initialSession: testAdminSession });
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));
    expect(await screen.findByText("البريد الإلكتروني مستخدم بالفعل")).toBeInTheDocument();
  });

  it("shows the loading state before the profile has loaded", () => {
    const transport = stubTransport({
      "GET /profile": () => new Promise(() => {}) as never,
      "GET /profile/activity": () => ({ body: [] }),
    });
    renderWithProviders(<ProfilePage />, { transport, initialSession: testAdminSession });
    expect(screen.getByText("جارِ التحميل…")).toBeInTheDocument();
  });
});

describe("ProfilePage — security tab", () => {
  it("a correct password change shows success", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "الأمان" }));

    // TextField's label isn't programmatically associated with its input, so
    // the password section's three fields are addressed by position: current,
    // new, confirm (the PIN section's own two fields follow after).
    const [current, next, confirm] = screen.getAllByRole("textbox");
    fireEvent.change(current!, { target: { value: "correct-pass" } });
    fireEvent.change(next!, { target: { value: "new-strong-pass" } });
    fireEvent.change(confirm!, { target: { value: "new-strong-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "تغيير كلمة المرور" }));

    expect(await screen.findByText("تم تغيير كلمة المرور.")).toBeInTheDocument();
  });

  it("refuses client-side (no request) when the new password and confirmation don't match", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /profile": () => ({ body: baseProfile }),
      "GET /profile/activity": () => ({ body: [] }),
      "POST /profile/change-password": () => {
        called = true;
        return { body: {} };
      },
    });
    renderWithProviders(<ProfilePage />, { transport, initialSession: testAdminSession });
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "الأمان" }));

    const [current1, next1, confirm1] = screen.getAllByRole("textbox");
    fireEvent.change(current1!, { target: { value: "x" } });
    fireEvent.change(next1!, { target: { value: "aaaaaaaa" } });
    fireEvent.change(confirm1!, { target: { value: "bbbbbbbb" } });
    fireEvent.click(screen.getByRole("button", { name: "تغيير كلمة المرور" }));

    expect(await screen.findByText("كلمة المرور الجديدة وتأكيدها غير متطابقين.")).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("a wrong current password shows the server's Arabic refusal", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "الأمان" }));

    const [current2, next2, confirm2] = screen.getAllByRole("textbox");
    fireEvent.change(current2!, { target: { value: "wrong" } });
    fireEvent.change(next2!, { target: { value: "aaaaaaaa" } });
    fireEvent.change(confirm2!, { target: { value: "aaaaaaaa" } });
    fireEvent.click(screen.getByRole("button", { name: "تغيير كلمة المرور" }));

    expect(await screen.findByText("كلمة المرور الحالية غير صحيحة")).toBeInTheDocument();
  });

  it("the change-password button stays disabled until both current and new password are filled", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "الأمان" }));
    expect(screen.getByRole("button", { name: "تغيير كلمة المرور" })).toBeDisabled();
  });
});

describe("ProfilePage — activity tab", () => {
  it("shows an empty-state message when there is no recorded activity", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "النشاط" }));
    expect(await screen.findByText("لا يوجد نشاط مسجّل على حسابك بعد.")).toBeInTheDocument();
  });

  it("renders fetched activity rows with their module and severity", async () => {
    const transport = stubTransport({
      "GET /profile": () => ({ body: baseProfile }),
      "GET /profile/activity": () => ({
        body: [{ timestamp: "2026-03-01T09:00:00.000Z", action: "PASSWORD_CHANGED", module: "auth", severity: "INFO" }],
      }),
    });
    renderWithProviders(<ProfilePage />, { transport, initialSession: testAdminSession });
    await screen.findByRole("heading", { name: "محمد الشهابي" });
    fireEvent.click(screen.getByRole("tab", { name: "النشاط" }));
    expect(await screen.findByText("تغيير كلمة المرور")).toBeInTheDocument();
    expect(screen.getByText("auth")).toBeInTheDocument();
  });
});
