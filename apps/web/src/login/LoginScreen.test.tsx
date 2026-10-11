// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useSyncExternalStore, type ReactElement } from "react";
import { LoginScreen } from "./LoginScreen";
import { useApi, ApiProvider } from "../data/ApiContext";
import { loadTenantCode, markSessionExpired, persistTenantCode, rememberTenantCodeForEmail, sessionExpiredPending, subscribeTenantCode } from "../data/session";
import { createQueryClient } from "../data/queryClient";
import { AppI18nProvider } from "../i18n";
import { rememberDeviceUser } from "./device-users";
import { MemoryRouter } from "react-router";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Transport, TransportResponse } from "../data/transport";
import { PLATFORM_LOOKUP_FIRST_RETRY_MS, PLATFORM_LOOKUP_MAX_RETRY_MS } from "../data/hooks";

function SessionProbe() {
  const { session } = useApi();
  return <span data-testid="session">{session?.nameAr ?? "none"}</span>;
}

function fillPin(pin: string) {
  pin.split("").forEach((digit, index) => {
    fireEvent.change(screen.getByLabelText(`رمز PIN رقم ${index + 1}`), { target: { value: digit } });
  });
}

/** `renderWithProviders` always mounts at the persisted-or-default (Arabic) locale; this test file's one English-UI case builds its own provider tree to force `en`. */
function renderEnglish(ui: ReactElement, transport: Transport) {
  const queryClient = createQueryClient();
  return render(
    <AppI18nProvider initialLocale="en">
      <QueryClientProvider client={queryClient}>
        <ApiProvider transport={transport} initialSession={null}>
          {/* The screen navigates on a resolved tenant code, so it needs a router
              exactly as `renderWithProviders` gives every other case here. */}
          <MemoryRouter initialEntries={["/"]}>{ui}</MemoryRouter>
        </ApiProvider>
      </QueryClientProvider>
    </AppI18nProvider>,
  );
}

const ENTITLEMENTS = {
  plan: "ENTERPRISE",
  activeModules: ["sales", "purchases", "inventory", "accounting"],
  features: {},
  seats: 10,
  expiresAt: null,
};

const preAuth = {
  "GET /tenant": () => ({ body: { name: "Cyag" } }),
  "GET /entitlements": () => ({ body: ENTITLEMENTS }),
};

const okTransport = () => stubTransport({ ...preAuth, "POST /auth/login": () => ({ body: testAdminSession }) });
const denyTransport = () =>
  stubTransport({
    ...preAuth,
    "POST /auth/login": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "اسم المستخدم أو رمز PIN غير صحيح." } }),
  });

describe.each(["light", "dark"] as const)("LoginScreen (%s theme)", (theme) => {
  beforeEach(() => {
    // The face row reads `mezan.deviceUsers` from localStorage on mount, so a
    // user remembered by one test (e.g. a successful sign-in below) would
    // otherwise leak into the next test's render.
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the plain sign-in heading and email field when the device remembers nobody", () => {
    document.documentElement.setAttribute("data-theme", theme);
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
    expect(screen.getByLabelText("البريد الإلكتروني")).toHaveValue("admin@cyag.example");
  });

  it("prefills the remembered device user's identity and preselects their face", () => {
    rememberDeviceUser(testAdminSession);
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("heading", { name: "مَن يعمل الآن؟" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "اختر محمد الشهابي" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("الرمز السرّي لـ محمد الشهابي")).toBeInTheDocument();
  });

  it("keeps دخول disabled until all 6 PIN digits are filled, then submits automatically", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("123");
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("123456");
    // The 6th digit auto-submits (see LoginScreen's `submitRef` effect), so the
    // button goes straight from disabled-while-incomplete to disabled-while-pending
    // before re-enabling once the sign-in call resolves.
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "دخول" })).toBeEnabled());
  });

  it("shows an inline error when the backend rejects the credentials", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: denyTransport() });
    fillPin("000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("اسم المستخدم أو رمز PIN غير صحيح.");
  });

  it("establishes the ApiContext session after a successful real sign-in", async () => {
    renderWithProviders(
      <>
        <LoginScreen onStartWizard={() => {}} />
        <SessionProbe />
      </>,
      { transport: okTransport() },
    );
    expect(screen.getByTestId("session")).toHaveTextContent("none");

    fillPin("123456");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));
  });

  it("still says the session ended after the sign-in screen is mounted again, as a navigation does, until the person acts", () => {
    markSessionExpired();
    const first = renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("status")).toHaveTextContent("انتهت الجلسة");
    first.unmount();

    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });

    expect(screen.getByRole("status")).toHaveTextContent("انتهت الجلسة");
    expect(sessionExpiredPending()).toBe(true);
  });

  it("drops the session-ended notice once the person starts typing a PIN, and does not bring it back on the next visit", () => {
    markSessionExpired();
    const first = renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });

    fireEvent.change(screen.getByLabelText("رمز PIN رقم 1"), { target: { value: "1" } });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(sessionExpiredPending()).toBe(false);
    first.unmount();
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears the session-ended notice on a successful sign-in", async () => {
    markSessionExpired();
    renderWithProviders(
      <>
        <LoginScreen onStartWizard={() => {}} />
        <SessionProbe />
      </>,
      { transport: okTransport() },
    );

    fillPin("123456");

    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));
    expect(sessionExpiredPending()).toBe(false);
  });

  it("shows the session-expired notice when the tab was left open past a dead token", () => {
    markSessionExpired();
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("status")).toHaveTextContent("انتهت الجلسة. سجّل الدخول من جديد للمتابعة.");
  });

  it("calls onStartWizard from the first-run link", () => {
    const onStartWizard = vi.fn();
    renderWithProviders(<LoginScreen onStartWizard={onStartWizard} />, { transport: okTransport() });
    fireEvent.click(screen.getByRole("button", { name: "الإعداد الأولي" }));
    expect(onStartWizard).toHaveBeenCalledTimes(1);
  });
});

describe("LoginScreen — SaaS company code", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the company-code input in code mode", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: false } }) }),
    });
    expect(await screen.findByLabelText("رمز المنشأة")).toBeInTheDocument();
  });

  it("lower-cases as it is typed but only persists and resolves on blur — firing exactly one /tenant request, and echoes the CODE back rather than the tenant's real name", async () => {
    let tenantRequests = 0;
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /tenant": () => {
          tenantRequests += 1;
          return { body: { name: "Cyag" } };
        },
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
      }),
    });
    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "C" } });
    fireEvent.change(input, { target: { value: "CY" } });
    fireEvent.change(input, { target: { value: "CYA" } });
    fireEvent.change(input, { target: { value: "CYAG" } });
    expect(input).toHaveValue("cyag");
    expect(localStorage.getItem("mezan.tenantCode")).toBeNull();
    expect(tenantRequests).toBe(0);
    fireEvent.blur(input);
    expect(await screen.findByText("الرمز: cyag")).toBeInTheDocument();
    expect(screen.queryByText("Cyag")).not.toBeInTheDocument();
    expect(localStorage.getItem("mezan.tenantCode")).toBe("cyag");
    expect(tenantRequests).toBe(1);
  });

  it("shows «رمز المنشأة غير صالح» for an invalid code and disables submit", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: false } }) }),
    });
    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "a" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("رمز المنشأة غير صالح");
    fillPin("123456");
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
  });

  it("clears the stored code from «تغيير المنشأة»", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }) }),
    });
    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "cyag" } });
    fireEvent.blur(input);
    await screen.findByText("الرمز: cyag");
    fireEvent.click(screen.getByRole("button", { name: "تغيير المنشأة" }));
    // Changing the code clears the query cache (see the test below), so
    // `/platform/resolve` — and with it this very field — refetches for a
    // tick before it settles back in.
    expect(await screen.findByLabelText("رمز المنشأة")).toHaveValue("");
    expect(localStorage.getItem("mezan.tenantCode")).toBeNull();
  });

  it("switching the company code clears the query cache and re-reads the face row under the new tenant — one browser origin serves every 'code' tenant, so a stale query or a rival company's remembered faces must not survive the switch", async () => {
    localStorage.setItem("mezan.tenantCode", "cyag");
    localStorage.setItem(
      "mezan.deviceUsers.cyag",
      JSON.stringify([{ email: "old@cyag.example", nameAr: "قديم", initials: "ق", role: "member" }]),
    );
    const clearSpy = vi.spyOn(QueryClient.prototype, "clear");
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }) }),
    });
    expect(await screen.findByRole("radio", { name: /قديم/ })).toBeInTheDocument();

    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "nile" } });
    fireEvent.blur(input);

    await screen.findByText("الرمز: nile"); // the query re-fired and resolved for the new code
    expect(clearSpy).toHaveBeenCalled();
    expect(screen.queryByRole("radio", { name: /قديم/ })).not.toBeInTheDocument();
    // cyag's own remembered faces are untouched — only nile's login screen stops reading them.
    expect(localStorage.getItem("mezan.deviceUsers.cyag")).not.toBeNull();
    clearSpy.mockRestore();
  });

  it("shows «المنشأة غير موجودة» inline once the typed code fails to resolve", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: false } }),
        "GET /tenant": () => ({ status: 404, body: { error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" } }),
      }),
    });
    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "ghost" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("المنشأة غير موجودة");
  });

  it("renders no code field in subdomain mode and never shows a tenant name pre-login — /platform/resolve is name-free", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "subdomain", exists: true } }),
      }),
    });
    await vi.waitFor(() => expect(screen.queryByText("جارٍ التحقق من المنشأة…")).not.toBeInTheDocument());
    expect(screen.queryByText("سياج")).not.toBeInTheDocument();
    expect(screen.queryByText("Cyag")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("رمز المنشأة")).not.toBeInTheDocument();
  });

  it("blocks a submit with no company code and shows «حدّد رمز المنشأة» without calling the server", async () => {
    let loginCalled = false;
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: false } }),
        "POST /auth/login": () => {
          loginCalled = true;
          return { body: testAdminSession };
        },
      }),
    });
    await screen.findByLabelText("رمز المنشأة");
    fillPin("123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("حدّد رمز المنشأة");
    expect(loginCalled).toBe(false);
  });

  it("maps a login refusal by the server's error CODE, not its status — an unrelated message is replaced with the client's own translation", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: false } }),
        "POST /auth/login": () => ({ status: 404, body: { error: "TENANT_NOT_FOUND", message: "some other server text" } }),
      }),
    });
    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "ghost" } });
    fillPin("123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("المنشأة غير موجودة");
  });

  it("still shows the credentials message verbatim for a plain 401 — an unmapped error code passes through", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
        "POST /auth/login": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "اسم المستخدم أو رمز PIN غير صحيح." } }),
      }),
    });
    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "cyag" } });
    fillPin("000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("اسم المستخدم أو رمز PIN غير صحيح.");
  });

  it("sends x-mezan-tenant on the login request once a company code is resolved", async () => {
    let seenTenantHeader: string | null = null;
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
        "POST /auth/login": (init) => {
          seenTenantHeader = new Headers(init?.headers).get("x-mezan-tenant");
          return { body: testAdminSession };
        },
      }),
    });
    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "cyag" } });
    fireEvent.blur(input);
    await screen.findByText("الرمز: cyag");
    fillPin("123456");
    await vi.waitFor(() => expect(seenTenantHeader).toBe("cyag"));
  });

  it("corrects a stale company code once a returning operator types their OWN email — a shared 'code' origin must not carry operator A's leftover company into operator B's sign-in", async () => {
    // Operator "a" signed in here before and was remembered under "acme"; the
    // browser's CURRENT code is left over from someone else ("nile").
    rememberTenantCodeForEmail("a@acme.example", "acme");
    localStorage.setItem("mezan.tenantCode", "nile");
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /tenant": () => ({ body: { name: "either tenant, never shown pre-login" } }),
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
      }),
    });

    const email = await screen.findByLabelText("البريد الإلكتروني");
    fireEvent.change(email, { target: { value: "a@acme.example" } });
    fireEvent.blur(email);

    await screen.findByText("الرمز: acme");
    expect(localStorage.getItem("mezan.tenantCode")).toBe("acme");
  });

  it("leaves the company code alone for an email nobody has signed in with before", async () => {
    localStorage.setItem("mezan.tenantCode", "nile");
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }) }),
    });

    const email = await screen.findByLabelText("البريد الإلكتروني");
    fireEvent.change(email, { target: { value: "stranger@example.com" } });
    fireEvent.blur(email);

    expect(localStorage.getItem("mezan.tenantCode")).toBe("nile");
  });

  it("opens on no company and no face row when two companies have signed in on this device — the last operator's leftover is dropped before the first paint", async () => {
    rememberTenantCodeForEmail("a@acme.example", "acme");
    rememberTenantCodeForEmail("b@nile.example", "nile");
    localStorage.setItem("mezan.tenantCode", "nile");
    localStorage.setItem(
      "mezan.deviceUsers.nile",
      JSON.stringify([{ email: "b@nile.example", nameAr: "بسمة النيل", nameEn: null, initials: "ب.ا", role: "admin", photoUrl: null }]),
    );
    const requests: string[] = [];
    const transport = stubTransport({
      ...preAuth,
      "GET /tenant": () => ({ body: { name: "never shown" } }),
      "GET /platform/resolve": () => ({ body: { mode: "code", exists: false } }),
    });
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: (path, init) => {
        requests.push(path);
        return transport(path, init);
      },
    });

    expect(await screen.findByLabelText("رمز المنشأة")).toHaveValue("");
    expect(localStorage.getItem("mezan.tenantCode")).toBeNull();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByText("بسمة النيل")).not.toBeInTheDocument();
    expect(requests).not.toContain("/tenant");

    const email = screen.getByLabelText("البريد الإلكتروني");
    fireEvent.change(email, { target: { value: "a@acme.example" } });
    fireEvent.blur(email);
    await screen.findByText("الرمز: acme");
    expect(localStorage.getItem("mezan.tenantCode")).toBe("acme");
  });

  it("drops the leftover company without updating another component while it renders, and sends no request under it", async () => {
    rememberTenantCodeForEmail("a@acme.example", "acme");
    rememberTenantCodeForEmail("b@nile.example", "nile");
    function CodeProbe() {
      const code = useSyncExternalStore(subscribeTenantCode, loadTenantCode, () => null);
      return <span data-testid="stored-code">{code ?? "none"}</span>;
    }
    function Shell() {
      const [signedOut, setSignedOut] = useState(false);
      return (
        <>
          <CodeProbe />
          <button type="button" onClick={() => setSignedOut(true)}>sign out</button>
          {signedOut ? <LoginScreen onStartWizard={() => {}} /> : null}
        </>
      );
    }
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const requests: (string | null)[] = [];
    const transport = stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }) });
    renderWithProviders(<Shell />, {
      transport: (path, init) => {
        requests.push(new Headers(init?.headers).get("x-mezan-tenant"));
        return transport(path, init);
      },
    });
    act(() => persistTenantCode("nile"));
    expect(screen.getByTestId("stored-code")).toHaveTextContent("nile");

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    expect(await screen.findByLabelText("رمز المنشأة")).toHaveValue("");
    await waitFor(() => expect(screen.getByTestId("stored-code")).toHaveTextContent("none"));
    const warnings = errors.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("while rendering a different component"));
    errors.mockRestore();
    expect(warnings).toEqual([]);
    expect(localStorage.getItem("mezan.tenantCode")).toBeNull();
    expect(requests.filter((code) => code !== null)).toEqual([]);
  });

  it("keeps the company the operator just confirmed when the screen mounts again — opening the setup wizard and cancelling must not wipe it", async () => {
    rememberTenantCodeForEmail("a@acme.example", "acme");
    rememberTenantCodeForEmail("b@nile.example", "nile");
    localStorage.setItem("mezan.tenantCode", "nile");
    const transport = stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }) });
    const first = renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });
    const code = await screen.findByLabelText("رمز المنشأة");
    expect(code).toHaveValue("");
    fireEvent.change(code, { target: { value: "acme" } });
    fireEvent.blur(code);
    await screen.findByText("الرمز: acme");

    first.unmount();
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });

    await screen.findByText("الرمز: acme");
    expect(localStorage.getItem("mezan.tenantCode")).toBe("acme");
  });

  it("drops a company confirmed on an earlier page load — a reload on a shared device opens neutral again", async () => {
    rememberTenantCodeForEmail("a@acme.example", "acme");
    rememberTenantCodeForEmail("b@nile.example", "nile");
    localStorage.setItem("mezan.tenantCode", "acme");
    sessionStorage.setItem("mezan.tenantCodeConfirmed", JSON.stringify({ code: "acme", load: "an-earlier-page-load" }));

    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }) }),
    });

    expect(await screen.findByLabelText("رمز المنشأة")).toHaveValue("");
    expect(localStorage.getItem("mezan.tenantCode")).toBeNull();
  });

  it("does not let a remembered email pull the screen off the company confirmed before it mounted again", async () => {
    rememberTenantCodeForEmail("a@acme.example", "acme");
    rememberTenantCodeForEmail("b@nile.example", "nile");
    const transport = stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }) });
    const first = renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });
    const code = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(code, { target: { value: "nile" } });
    fireEvent.blur(code);
    await screen.findByText("الرمز: nile");
    first.unmount();
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });
    await screen.findByText("الرمز: nile");

    const email = await screen.findByLabelText("البريد الإلكتروني");
    fireEvent.change(email, { target: { value: "a@acme.example" } });
    fireEvent.blur(email);

    expect(localStorage.getItem("mezan.tenantCode")).toBe("nile");
  });

  it("opens neutral again for the next operator once the one who confirmed a company has signed in and out", async () => {
    rememberTenantCodeForEmail("a@acme.example", "acme");
    rememberTenantCodeForEmail("b@nile.example", "nile");
    const transport = stubTransport({
      ...preAuth,
      "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
      "POST /auth/login": () => ({ body: testAdminSession }),
    });
    const first = renderWithProviders(
      <>
        <LoginScreen onStartWizard={() => {}} />
        <SessionProbe />
      </>,
      { transport },
    );
    const code = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(code, { target: { value: "acme" } });
    fireEvent.blur(code);
    await screen.findByText("الرمز: acme");
    const email = await screen.findByLabelText("البريد الإلكتروني");
    fireEvent.change(email, { target: { value: "a@acme.example" } });
    fillPin("123456");
    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));

    first.unmount();
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });

    expect(await screen.findByLabelText("رمز المنشأة")).toHaveValue("");
    expect(localStorage.getItem("mezan.tenantCode")).toBeNull();
  });

  it("keeps the company code and the face row on a device only one company signs into", async () => {
    rememberTenantCodeForEmail("b@nile.example", "nile");
    localStorage.setItem("mezan.tenantCode", "nile");
    localStorage.setItem(
      "mezan.deviceUsers.nile",
      JSON.stringify([{ email: "b@nile.example", nameAr: "بسمة النيل", nameEn: null, initials: "ب.ا", role: "admin", photoUrl: null }]),
    );
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({ ...preAuth, "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }) }),
    });

    expect(await screen.findByLabelText("رمز المنشأة")).toHaveValue("nile");
    expect(screen.getByRole("radio", { name: "اختر بسمة النيل" })).toBeChecked();
    expect(localStorage.getItem("mezan.tenantCode")).toBe("nile");
  });

  it("remembers the resolved company code under the operator's email after a successful sign-in", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
        "POST /auth/login": () => ({ body: testAdminSession }),
      }),
    });
    const input = await screen.findByLabelText("رمز المنشأة");
    fireEvent.change(input, { target: { value: "cyag" } });
    fireEvent.blur(input);
    await screen.findByText("الرمز: cyag");

    const email = screen.getByLabelText("البريد الإلكتروني");
    fireEvent.change(email, { target: { value: testAdminSession.email } });
    fillPin("123456");

    await vi.waitFor(() => expect(localStorage.getItem("mezan.tenantCodeByEmail")).not.toBeNull());
    const map = JSON.parse(localStorage.getItem("mezan.tenantCodeByEmail")!);
    expect(map[testAdminSession.email.toLowerCase()]).toBe("cyag");
  });

  it("shows a checking status line while /platform/resolve is pending", async () => {
    const pending: Promise<never> = new Promise(() => {});
    const base = stubTransport(preAuth);
    const transport: Transport = (path, init) => (path.startsWith("/platform/resolve") ? pending : base(path, init));
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });
    expect(await screen.findByText("جارٍ التحقق من المنشأة…")).toBeInTheDocument();
  });

  it("does not gate submission when /platform/resolve answers 500 — a normal sign-in still succeeds (regression: desktop and every existing transport never serve this route, so gating on any error hung sign-in forever)", async () => {
    renderWithProviders(
      <>
        <LoginScreen onStartWizard={() => {}} />
        <SessionProbe />
      </>,
      {
        transport: stubTransport({
          ...preAuth,
          "GET /platform/resolve": () => ({ status: 500, body: {} }),
          "POST /auth/login": () => ({ body: testAdminSession }),
        }),
      },
    );
    await vi.waitFor(() => expect(screen.queryByText("جارٍ التحقق من المنشأة…")).not.toBeInTheDocument());
    expect(screen.queryByText("تعذّر الوصول إلى الخادم")).not.toBeInTheDocument();
    fillPin("123456");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));
  });

  it("does not gate submission when /platform/resolve's fetch throws — a normal sign-in still succeeds", async () => {
    const base = stubTransport({ ...preAuth, "POST /auth/login": () => ({ body: testAdminSession }) });
    const transport: Transport = (path, init) =>
      path.startsWith("/platform/resolve") ? Promise.reject(new Error("network down")) : base(path, init);
    renderWithProviders(
      <>
        <LoginScreen onStartWizard={() => {}} />
        <SessionProbe />
      </>,
      { transport },
    );
    fillPin("123456");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));
  });

  describe("while the company lookup is failing", () => {
    const HTML_ERROR_PAGE: TransportResponse = {
      status: 502,
      ok: false,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
      text: () => Promise.resolve("<html><body>Bad Gateway</body></html>"),
    };
    const HTML_INSTEAD_OF_JSON: TransportResponse = { ...HTML_ERROR_PAGE, status: 200, ok: true };

    function failingLookup(failure: () => Promise<TransportResponse>, handlers: Parameters<typeof stubTransport>[0] = {}) {
      const state = { failing: true, lookups: 0, requests: [] as string[] };
      const base = stubTransport({ ...preAuth, "POST /auth/login": () => ({ body: testAdminSession }), ...handlers });
      const transport: Transport = (path, init) => {
        state.requests.push(path);
        if (!path.startsWith("/platform/resolve")) return base(path, init);
        state.lookups += 1;
        return state.failing ? failure() : base(path, init);
      };
      return { state, transport };
    }

    const jsonFailure = (status: number, body: unknown = {}, retryAfter?: string) => (): Promise<TransportResponse> =>
      Promise.resolve({
        status,
        ok: false,
        json: <T,>() => Promise.resolve(body as T),
        text: () => Promise.resolve(JSON.stringify(body)),
        header: (name: string) => (name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null),
      });

    afterEach(() => vi.useRealTimers());

    it.each([
      ["answers 500", jsonFailure(500)],
      ["answers a 502 HTML page", () => Promise.resolve(HTML_ERROR_PAGE)],
      ["answers 200 with an HTML body", () => Promise.resolve(HTML_INSTEAD_OF_JSON)],
      ["answers 429", jsonFailure(429, { error: "TOO_MANY_REQUESTS" }, "30")],
      ["cannot be reached", () => Promise.reject(new Error("network down"))],
    ])("shows the sign-in form at once, with the company-code field, no blocking panel and no alert, when the lookup %s", async (_what, failure) => {
      const { transport } = failingLookup(failure);
      renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });

      expect(await screen.findByRole("textbox", { name: "رمز المنشأة" })).toBeInTheDocument();
      expect(screen.getByLabelText("رمز PIN رقم 1")).toBeEnabled();
      expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("جارٍ التحقق من المنشأة…")).not.toBeInTheDocument();
    });

    it("signs in without a company code, as a subdomain needs, and says nothing about the lookup", async () => {
      const { transport, state } = failingLookup(jsonFailure(503));
      renderWithProviders(
        <>
          <LoginScreen onStartWizard={() => {}} />
          <SessionProbe />
        </>,
        { transport },
      );
      await screen.findByRole("textbox", { name: "رمز المنشأة" });

      fillPin("123456");

      await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));
      expect(state.requests.filter((path) => path === "/tenant" || path === "/entitlements" || path === "/bootstrap/status")).toEqual([]);
    });

    it("signs in with a typed company code it could not confirm, and says so in a notice that blocks nothing", async () => {
      const { transport } = failingLookup(jsonFailure(503), { "GET /tenant": () => ({ status: 503, body: {} }) });
      renderWithProviders(
        <>
          <LoginScreen onStartWizard={() => {}} />
          <SessionProbe />
        </>,
        { transport },
      );
      const code = await screen.findByRole("textbox", { name: "رمز المنشأة" });
      fireEvent.change(code, { target: { value: "acme" } });
      fireEvent.blur(code);
      expect(screen.queryByText("تعذّر التأكد من رمز المنشأة الآن. سنحاول تسجيل الدخول به كما هو.")).not.toBeInTheDocument();

      fillPin("123456");

      expect(await screen.findByText("تعذّر التأكد من رمز المنشأة الآن. سنحاول تسجيل الدخول به كما هو.")).toHaveAttribute("role", "status");
      await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));
      expect(loadTenantCode()).toBe("acme");
    });

    it("looks again on its own and settles into the answered mode with no click", async () => {
      vi.useFakeTimers();
      const { transport, state } = failingLookup(jsonFailure(500), { "GET /platform/resolve": () => ({ body: { mode: "subdomain", exists: true } }) });
      renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByRole("textbox", { name: "رمز المنشأة" })).toBeInTheDocument();
      expect(state.lookups).toBe(1);

      state.failing = false;
      await act(async () => { await vi.advanceTimersByTimeAsync(PLATFORM_LOOKUP_FIRST_RETRY_MS); });

      expect(state.lookups).toBe(2);
      await vi.waitFor(() => expect(screen.queryByRole("textbox", { name: "رمز المنشأة" })).not.toBeInTheDocument());
      expect(state.lookups).toBe(2);
    });

    it("backs off between lookups, never past the cap, and keeps looking", async () => {
      vi.useFakeTimers();
      const { transport, state } = failingLookup(jsonFailure(500));
      renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      await act(async () => { await vi.advanceTimersByTimeAsync(PLATFORM_LOOKUP_FIRST_RETRY_MS - 1); });
      expect(state.lookups).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(state.lookups).toBe(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(PLATFORM_LOOKUP_FIRST_RETRY_MS * 2 - 1); });
      expect(state.lookups).toBe(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(state.lookups).toBe(3);

      await act(async () => { await vi.advanceTimersByTimeAsync(PLATFORM_LOOKUP_MAX_RETRY_MS * 20); });
      const settled = state.lookups;
      await act(async () => { await vi.advanceTimersByTimeAsync(PLATFORM_LOOKUP_MAX_RETRY_MS); });
      expect(state.lookups).toBe(settled + 1);
    });

    it("waits as long as Retry-After asks before it looks again", async () => {
      vi.useFakeTimers();
      const { transport, state } = failingLookup(jsonFailure(429, { error: "TOO_MANY_REQUESTS" }, "7"));
      renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      await act(async () => { await vi.advanceTimersByTimeAsync(6_999); });
      expect(state.lookups).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(state.lookups).toBe(2);
    });

    it.each([
      [429, { error: "TOO_MANY_REQUESTS", message: "طلبات كثيرة من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة." }],
      [403, { error: "OFF_SUBNET", message: "هذا الجهاز ليس على شبكة المنشأة. This device is not on the company network." }],
    ])("shows the form and the host's own message when a till's host answers the lookup with %s", async (status, body) => {
      const { transport } = failingLookup(jsonFailure(status, body));
      renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport });

      expect(await screen.findByText(body.message)).toHaveAttribute("role", "status");
      expect(screen.getByLabelText("رمز PIN رقم 1")).toBeEnabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("does not gate submission when /platform/resolve simply doesn't exist (desktop/LAN backends, a plain 404)", async () => {
    renderWithProviders(
      <>
        <LoginScreen onStartWizard={() => {}} />
        <SessionProbe />
      </>,
      { transport: stubTransport({ ...preAuth, "POST /auth/login": () => ({ body: testAdminSession }) }) },
    );
    fillPin("123456");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));
  });

  it("never shows a tenant name pre-login in subdomain mode, in any UI language", async () => {
    renderEnglish(
      <LoginScreen onStartWizard={() => {}} />,
      stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "subdomain", exists: true } }),
      }),
    );
    await vi.waitFor(() => expect(screen.queryByText("Checking your company…")).not.toBeInTheDocument());
    expect(screen.queryByText("Cyag")).not.toBeInTheDocument();
    expect(screen.queryByText("سياج")).not.toBeInTheDocument();
  });
});
