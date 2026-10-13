// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { LoginScreen } from "./LoginScreen";
import { useApi, ApiProvider } from "../data/ApiContext";
import { SignInNotice, markSessionExpired, markSignInNotice, rememberTenantCodeForEmail } from "../data/session";
import { createQueryClient } from "../data/queryClient";
import { AppI18nProvider } from "../i18n";
import { rememberDeviceUser } from "./device-users";
import { MemoryRouter } from "react-router";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Transport } from "../data/transport";

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

  it("shows the session-expired notice when the tab was left open past a dead token", () => {
    markSessionExpired();
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("status")).toHaveTextContent("انتهت الجلسة. سجّل الدخول من جديد للمتابعة.");
  });

  it("confirms in Arabic that the account was unlocked when the person arrives from a mailed link", () => {
    markSignInNotice(SignInNotice.AccountUnlocked);
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("status")).toHaveTextContent("تم فكّ قفل الحساب. أدخل رمز PIN للدخول.");
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

  it("says the server is busy and holds the button for the seconds it was told to wait", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
        "POST /auth/login": () => ({
          status: 503,
          body: { error: "SIGN_IN_BUSY", retryAfterSeconds: 2, message: "الخادم مشغول الآن بطلبات دخول أخرى، ولم تُحتسب هذه المحاولة. أعد المحاولة بعد ثوانٍ." },
        }),
      }),
    });
    fireEvent.change(await screen.findByLabelText("رمز المنشأة"), { target: { value: "cyag" } });
    fillPin("123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("الخادم مشغول الآن");
    fillPin("123456");
    expect(screen.getByRole("button", { name: /الحساب مقفل|انتظر|بعد/ })).toBeDisabled();
  });

  it.each([
    [429, { error: "TOO_MANY_REQUESTS", message: "طلبات كثيرة من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة." }, "طلبات كثيرة من هذا الجهاز", /الحساب مقفل — بعد 60s/],
    [503, { error: "DATABASE_BUSY", message: "قاعدة البيانات مشغولة بعملية لم تنتهِ، فلم يُنفَّذ طلبك. حاول مرة أخرى بعد قليل." }, "قاعدة البيانات مشغولة", /الخادم مشغول — أعد المحاولة بعد 60s/],
  ] as const)("holds the button for the wait a %i names only in its Retry-After header, as the host's own socket answers a till", async (status, body, said, held) => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
        "POST /auth/login": () => ({ status, body, retryAfterSeconds: 60 }),
      }),
    });
    fireEvent.change(await screen.findByLabelText("رمز المنشأة"), { target: { value: "cyag" } });
    fillPin("123456");

    expect(await screen.findByRole("alert")).toHaveTextContent(said);
    expect(screen.getByRole("button", { name: held })).toBeDisabled();
  });

  it("says the audit log could not record the sign-in, in the server's own words, without calling it a lock or a wrong PIN", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
        "POST /auth/login": () => ({
          status: 503,
          body: { error: "AUDIT_UNAVAILABLE", message: "تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى." },
        }),
      }),
    });
    fireEvent.change(await screen.findByLabelText("رمز المنشأة"), { target: { value: "cyag" } });
    fillPin("123456");

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى.");
    expect(screen.getByRole("button", { name: "دخول" })).toBeInTheDocument();
    expect(screen.queryByLabelText("رمز فكّ القفل")).not.toBeInTheDocument();
  });

  it("offers a place to type the mailed code when the account is locked, and opens the account with it", async () => {
    let unlockBody: unknown = null;
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
        "POST /auth/login": () => ({
          status: 423,
          body: { error: "ACCOUNT_LOCKED", unlockByCode: true, message: "تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة." },
        }),
        "POST /auth/unlock": (init) => {
          unlockBody = JSON.parse((init?.body as string) ?? "{}");
          return { body: { ok: true } };
        },
      }),
    });
    fireEvent.change(await screen.findByLabelText("رمز المنشأة"), { target: { value: "cyag" } });
    fillPin("000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("تم قفل هذا الحساب");

    fireEvent.change(screen.getByLabelText("رمز فكّ القفل"), { target: { value: "ABCDEFGHIJKLMNOP" } });
    fireEvent.click(screen.getByRole("button", { name: "فكّ القفل" }));

    expect(await screen.findByRole("status")).toHaveTextContent("تم فكّ قفل الحساب");
    expect(unlockBody).toMatchObject({ code: "ABCDEFGHIJKLMNOP" });
    expect(screen.queryByLabelText("رمز فكّ القفل")).not.toBeInTheDocument();
  });

  it("offers no code field when the lock can only be opened by an administrator", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, {
      transport: stubTransport({
        ...preAuth,
        "GET /platform/resolve": () => ({ body: { mode: "code", exists: true } }),
        "POST /auth/login": () => ({
          status: 423,
          body: { error: "ACCOUNT_LOCKED", unlockByCode: false, message: "تم قفل هذا الحساب. اطلب من مدير النظام فكّ القفل." },
        }),
      }),
    });
    fireEvent.change(await screen.findByLabelText("رمز المنشأة"), { target: { value: "cyag" } });
    fillPin("000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("اطلب من مدير النظام فكّ القفل");
    expect(screen.queryByLabelText("رمز فكّ القفل")).not.toBeInTheDocument();
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
