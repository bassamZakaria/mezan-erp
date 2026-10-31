// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ChangeTemporaryPasswordScreen } from "./ChangeTemporaryPasswordScreen";
import { useApi } from "../data/ApiContext";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const flagged = { ...testAdminSession, mustChangePassword: true };

function SessionProbe() {
  const { session } = useApi();
  return <span data-testid="must-change">{String(session?.mustChangePassword ?? "none")}</span>;
}

function fill(current: string, next: string, confirm = next) {
  fireEvent.change(screen.getByLabelText("كلمة المرور المؤقتة"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور الجديدة"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "حفظ والمتابعة" }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("the temporary-password change that gates a first sign-in", () => {
  it("changes the password, then signs in again with the new one and leaves the gate", async () => {
    const sent: { path: string; body: unknown }[] = [];
    const transport = stubTransport({
      "POST /profile/change-password": (init) => {
        sent.push({ path: "change", body: JSON.parse(String(init?.body)) });
        return { body: {} };
      },
      "POST /auth/login": (init) => {
        sent.push({ path: "login", body: JSON.parse(String(init?.body)) });
        return { body: testAdminSession };
      },
    });
    renderWithProviders(
      <>
        <ChangeTemporaryPasswordScreen />
        <SessionProbe />
      </>,
      { transport, initialSession: flagged },
    );

    fill("Tmp-9f3K-q2Lx", "My-Own-2026");

    await waitFor(() => expect(screen.getByTestId("must-change")).toHaveTextContent("false"));
    expect(sent).toEqual([
      { path: "change", body: { currentPassword: "Tmp-9f3K-q2Lx", newPassword: "My-Own-2026" } },
      { path: "login", body: { username: testAdminSession.email, password: "My-Own-2026" } },
    ]);
  });

  it("after the change succeeds but the sign-in that follows fails, retrying only signs in again with the new password", async () => {
    const sent: string[] = [];
    let loginAttempts = 0;
    const transport = stubTransport({
      "POST /profile/change-password": () => {
        sent.push("change");
        return { body: {} };
      },
      "POST /auth/login": (init) => {
        loginAttempts += 1;
        sent.push(`login:${(JSON.parse(String(init?.body)) as { password: string }).password}`);
        return loginAttempts === 1 ? { status: 429, body: { error: "TOO_MANY_REQUESTS", message: "طلبات كثيرة" } } : { body: testAdminSession };
      },
    });
    renderWithProviders(
      <>
        <ChangeTemporaryPasswordScreen />
        <SessionProbe />
      </>,
      { transport, initialSession: flagged },
    );
    fill("Tmp-9f3K-q2Lx", "My-Own-2026");
    expect(await screen.findByRole("alert")).toHaveTextContent("تغيّرت كلمة المرور، لكن تعذّر الدخول تلقائيًا.");
    expect(screen.queryByLabelText("كلمة المرور المؤقتة")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إعادة محاولة الدخول" }));

    await waitFor(() => expect(screen.getByTestId("must-change")).toHaveTextContent("false"));
    expect(sent).toEqual(["change", "login:My-Own-2026", "login:My-Own-2026"]);
  });

  it("refuses a short or mismatched new password without calling the server", () => {
    const transport = vi.fn(stubTransport({}));
    renderWithProviders(<ChangeTemporaryPasswordScreen />, { transport, initialSession: flagged });
    fill("Tmp-9f3K-q2Lx", "short1");
    expect(screen.getByRole("alert")).toHaveTextContent("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
    fill("Tmp-9f3K-q2Lx", "My-Own-2026", "My-Own-2027");
    expect(screen.getByRole("alert")).toHaveTextContent("كلمة المرور الجديدة وتأكيدها غير متطابقين.");
    expect(transport.mock.calls.map(([path]) => path)).not.toContain("/profile/change-password");
  });

  it("shows the server's refusal for a wrong temporary password and stays on the gate", async () => {
    const transport = stubTransport({
      "POST /profile/change-password": () => ({ status: 403, body: { error: "INCORRECT_PASSWORD", message: "كلمة المرور الحالية غير صحيحة" } }),
    });
    renderWithProviders(
      <>
        <ChangeTemporaryPasswordScreen />
        <SessionProbe />
      </>,
      { transport, initialSession: flagged },
    );
    fill("wrong-one", "My-Own-2026");
    expect(await screen.findByRole("alert")).toHaveTextContent("كلمة المرور الحالية غير صحيحة");
    expect(screen.getByTestId("must-change")).toHaveTextContent("true");
  });

  it("offers a way out: signing out revokes the session and ends it here", async () => {
    const asked: string[] = [];
    const base = stubTransport({ "POST /auth/logout": () => ({ body: {} }) });
    renderWithProviders(
      <>
        <ChangeTemporaryPasswordScreen />
        <SessionProbe />
      </>,
      { transport: (path, init) => (asked.push(path), base(path, init)), initialSession: flagged },
    );
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
    expect(screen.getByTestId("must-change")).toHaveTextContent("none");
    expect(asked).toContain("/auth/logout");
  });
});
