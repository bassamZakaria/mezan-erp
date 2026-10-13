// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { UnlockLinkScreen } from "./UnlockLinkScreen";
import { SignInNotice, clearSignInNotice, clearTenantCode, pendingSignInNotice } from "../data/session";
import { renderWithProviders, stubTransport } from "../data/test-support";

const TOKEN = "k".repeat(43);

interface Sent {
  readonly body: unknown;
  readonly tenant: string | null;
}

function mount(route: string, answer: () => { status?: number; body: unknown }) {
  const sent: Sent[] = [];
  const transport = stubTransport({
    "POST /auth/unlock-link": (init) => {
      sent.push({ body: JSON.parse(String(init?.body)), tenant: new Headers(init?.headers).get("x-mezan-tenant") });
      return answer();
    },
  });
  renderWithProviders(
    <Routes>
      <Route path="/unlock" element={<UnlockLinkScreen />} />
      <Route path="/" element={<p>شاشة الدخول</p>} />
    </Routes>,
    { transport, route },
  );
  return sent;
}

afterEach(() => {
  clearSignInNotice();
  clearTenantCode();
  vi.restoreAllMocks();
});

describe("the page a mailed unlock link opens", () => {
  it("spends the link only when the person presses the button, never by being opened", async () => {
    const sent = mount(`/unlock?tenant=acme&token=${TOKEN}`, () => ({ body: { ok: true } }));

    expect(screen.getByRole("heading", { name: "فكّ قفل الحساب" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "فكّ القفل" }));

    await vi.waitFor(() => expect(screen.getByText("شاشة الدخول")).toBeInTheDocument());
    expect(sent).toEqual([{ body: { token: TOKEN }, tenant: "acme" }]);
    expect(pendingSignInNotice()).toBe(SignInNotice.AccountUnlocked);
  });

  it("shows the server's Arabic refusal for a link that was used or has expired, and offers the way back to sign-in", async () => {
    mount(`/unlock?token=${TOKEN}`, () => ({
      status: 400,
      body: { error: "INVALID_UNLOCK_LINK", message: "رابط فكّ القفل غير صالح، أو انتهت صلاحيته، أو استُخدم من قبل." },
    }));

    fireEvent.click(screen.getByRole("button", { name: "فكّ القفل" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("رابط فكّ القفل غير صالح، أو انتهت صلاحيته، أو استُخدم من قبل.");
    expect(screen.getByRole("link", { name: "العودة إلى تسجيل الدخول" })).toHaveAttribute("href", "/");
    expect(pendingSignInNotice()).toBeNull();
  });

  it("says the link is incomplete when it carries no token, and asks the server nothing", () => {
    const sent = mount("/unlock?tenant=acme", () => ({ body: { ok: true } }));

    expect(screen.getByRole("alert")).toHaveTextContent("رابط فكّ القفل غير مكتمل. افتحه كما وصلك في البريد.");
    expect(screen.queryByRole("button", { name: "فكّ القفل" })).not.toBeInTheDocument();
    expect(sent).toEqual([]);
  });
});
