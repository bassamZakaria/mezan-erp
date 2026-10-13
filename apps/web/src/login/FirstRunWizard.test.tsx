// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { FirstRunWizard } from "./FirstRunWizard";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const EMPTY_COUNTS = { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0 };
const SEEDED_COUNTS = { accounts: 30, taxRates: 1, branches: 1, warehouses: 1, fiscalPeriods: 12, users: 1 };

const claims: unknown[] = [];

function wizardTransport() {
  let counts = EMPTY_COUNTS;
  claims.length = 0;
  return stubTransport({
    "GET /tenant": () => ({ body: { name: "Cyag" } }),
    "GET /bootstrap/status": () => ({ body: counts }),
    "POST /bootstrap/seed": () => {
      counts = SEEDED_COUNTS;
      return { body: counts };
    },
    "POST /bootstrap/admin": (init) => {
      claims.push(JSON.parse(String(init?.body)));
      return { status: 201, body: testAdminSession };
    },
  });
}

function renderWizard(onFinish = () => {}, onCancel = () => {}) {
  return renderWithProviders(<FirstRunWizard onFinish={onFinish} onCancel={onCancel} />, {
    transport: wizardTransport(),
  });
}

function goToAdminStep() {
  fireEvent.click(screen.getByRole("button", { name: "التالي" }));
}

const COMPANY = "متجر الياسمين";

function fillAdminForm(company = COMPANY) {
  fireEvent.change(screen.getByLabelText("اسم المنشأة", { exact: false }), { target: { value: company } });
  fireEvent.change(screen.getByLabelText("الاسم الكامل"), { target: { value: "سارة حسن" } });
  // `exact: false`: the email label's `<label>` wrapper also carries a hint
  // sentence ("هذا البريد هو اسم الدخول لهذا الحساب.") as a sibling of the
  // input, so the field's full accessible name is the two concatenated.
  fireEvent.change(screen.getByLabelText("البريد الإلكتروني", { exact: false }), {
    target: { value: "sara@cyag.example" },
  });
  fireEvent.change(screen.getByLabelText("الرمز السرّي (٦ أرقام)"), { target: { value: "432198" } });
  fireEvent.change(screen.getByLabelText("تأكيد رمز PIN"), { target: { value: "432198" } });
}

describe.each(["light", "dark"] as const)("FirstRunWizard (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  /**
   * guards L-5 / support #2. The step asked for an `XXXX-XXXX-XXXX-XXXX` key
   * the product has never used, called nothing, and showed a green «مُفعّل» —
   * so a new owner was told the licence took and then met a 403 on every save.
   */
  it("starts on the licence step, which asks for a FILE and never blocks التالي", () => {
    document.documentElement.setAttribute("data-theme", theme);
    renderWizard();
    expect(screen.getByRole("heading", { name: "معالج الإعداد الأولي" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "تفعيل الترخيص" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("XXXX-XXXX-XXXX-XXXX")).not.toBeInTheDocument();
    expect(screen.getByText(/ملف يرسله لك الدعم/)).toBeInTheDocument();
    // A shop without a file yet must still be able to finish setting up: the
    // write gate enforces the licence, not this button.
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();
  });

  it("shows no success pill and no licence facts on the browser build", () => {
    renderWizard();
    expect(screen.queryByText("مُفعّل")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "استيراد ملف الترخيص" })).toBeDisabled();
    expect(screen.getByText(/تُثبَّت التراخيص على الجهاز الرئيسي/)).toBeInTheDocument();
  });

  it("validates the admin step, then persists the admin and advances to seed", async () => {
    renderWizard();
    goToAdminStep();
    expect(screen.getByRole("heading", { name: "إنشاء حساب المسؤول" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("اسم المنشأة", { exact: false }), { target: { value: COMPANY } });
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByRole("alert")).toHaveTextContent("الاسم الكامل والبريد الإلكتروني مطلوبان");

    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(await screen.findByRole("heading", { name: "تهيئة البيانات الأساسية" })).toBeInTheDocument();
  });

  it("rejects a PIN that isn't 6 digits, then a PIN whose confirmation doesn't match", () => {
    renderWizard();
    goToAdminStep();
    fireEvent.change(screen.getByLabelText("اسم المنشأة", { exact: false }), { target: { value: COMPANY } });
    fireEvent.change(screen.getByLabelText("الاسم الكامل"), { target: { value: "سارة حسن" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني", { exact: false }), {
      target: { value: "sara@cyag.example" },
    });

    fireEvent.change(screen.getByLabelText("الرمز السرّي (٦ أرقام)"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("تأكيد رمز PIN"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByRole("alert")).toHaveTextContent("الرمز السرّي يجب أن يكون ٦ أرقام.");

    fireEvent.change(screen.getByLabelText("الرمز السرّي (٦ أرقام)"), { target: { value: "111111" } });
    fireEvent.change(screen.getByLabelText("تأكيد رمز PIN"), { target: { value: "222222" } });
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByRole("alert")).toHaveTextContent("رمز PIN وتأكيده غير متطابقين.");
  });

  it("sends the company's own name with the claim, so the install never prints the seeded one", async () => {
    renderWizard();
    goToAdminStep();
    fillAdminForm(`  ${COMPANY}  `);
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    await screen.findByRole("heading", { name: "تهيئة البيانات الأساسية" });

    expect(claims).toEqual([{ nameAr: "سارة حسن", nameEn: null, email: "sara@cyag.example", pin: "432198", companyName: COMPANY }]);
  });

  it("does not claim the install until the company is named", () => {
    renderWizard();
    goToAdminStep();
    fillAdminForm("   ");
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    expect(screen.getByRole("alert")).toHaveTextContent("اسم المنشأة مطلوب.");
    expect(claims).toEqual([]);
    expect(screen.getByRole("heading", { name: "إنشاء حساب المسؤول" })).toBeInTheDocument();
  });

  it("refuses a company name carrying a direction override, and caps its length on the field", () => {
    renderWizard();
    goToAdminStep();
    fillAdminForm("شركة \u202Eevil");
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    expect(screen.getByRole("alert")).toHaveTextContent("اسم المنشأة يحتوي على رموز غير مسموح بها.");
    expect(claims).toEqual([]);
    expect(screen.getByLabelText("اسم المنشأة", { exact: false })).toHaveAttribute("maxlength", "200");
  });

  it("greets a new install without the seeded company's name", async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByText(/إعداد نظام ميزان/)).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body).not.toHaveTextContent("Cyag");
  });

  it("requires the base data to exist before التالي, and تشغيل التهيئة seeds it for real", async () => {
    renderWizard();
    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    await screen.findByRole("heading", { name: "تهيئة البيانات الأساسية" });

    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "تشغيل التهيئة" }));
    expect(await screen.findAllByText("جاهز")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();
  });

  it("reaches the optional import step and finishes into the app", async () => {
    const onFinish = vi.fn();
    renderWizard(onFinish);
    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    await screen.findByRole("heading", { name: "تهيئة البيانات الأساسية" });
    fireEvent.click(screen.getByRole("button", { name: "تشغيل التهيئة" }));
    await screen.findAllByText("جاهز");
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    expect(screen.getByRole("heading", { name: "استيراد البيانات (اختياري)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء والانتقال إلى النظام" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel to return to login from any step", () => {
    const onCancel = vi.fn();
    renderWizard(() => {}, onCancel);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("offers a way out when the install turns out to already be claimed", async () => {
    // `POST /bootstrap/admin` answers a claimed tenant with a bare 409 — it
    // used to hand back the EXISTING admin's session, which was an anonymous
    // takeover. Correct, but the wizard then printed the refusal and STOPPED:
    // the message tells the owner to sign in with their account and the screen
    // gave them no way to. Anyone arriving here after an interrupted first run
    // was stuck on step 2 with only «رجوع».
    const onCancel = vi.fn();
    renderWithProviders(<FirstRunWizard onFinish={() => {}} onCancel={onCancel} />, {
      transport: stubTransport({
        "GET /tenant": () => ({ body: { name: "Cyag" } }),
        "GET /bootstrap/status": () => ({ body: { ...EMPTY_COUNTS, claimed: true } }),
        "POST /bootstrap/admin": () => ({
          status: 409,
          body: { error: "TENANT_ALREADY_PROVISIONED", message: "تم إعداد هذه المنشأة بالفعل. سجّل الدخول بحسابك." },
        }),
      }),
    });

    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("تم إعداد هذه المنشأة بالفعل");

    const out = await screen.findByRole("button", { name: "سجّل الدخول بحسابك" });
    fireEvent.click(out);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows no way-out button for an ordinary failure, which is worth retrying", async () => {
    renderWithProviders(<FirstRunWizard onFinish={() => {}} onCancel={() => {}} />, {
      transport: stubTransport({
        "GET /tenant": () => ({ body: { name: "Cyag" } }),
        "GET /bootstrap/status": () => ({ body: EMPTY_COUNTS }),
        "POST /bootstrap/admin": () => ({ status: 400, body: { error: "VALIDATION_ERROR", message: "بيانات غير صالحة." } }),
      }),
    });

    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "سجّل الدخول بحسابك" })).not.toBeInTheDocument();
  });
});

/**
 * THE ACTIVATION STEP ON A REAL DESKTOP HOST — guards L-5 / support #2.
 *
 * Outside the theme matrix, because the bridge has to be installed and torn
 * down around each case and none of this is about colour.
 */
describe("FirstRunWizard — the standard roles", () => {
  function atSeedStep(roles: number | undefined) {
    renderWithProviders(<FirstRunWizard onFinish={() => {}} onCancel={() => {}} />, {
      transport: stubTransport({
        "GET /tenant": () => ({ body: { name: "Cyag" } }),
        "GET /bootstrap/status": () => ({ body: { ...SEEDED_COUNTS, ...(roles === undefined ? {} : { roles }) } }),
        "POST /bootstrap/admin": () => ({ status: 201, body: testAdminSession }),
      }),
    });
    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
  }

  it("says the standard roles were added, and how many, so the owner knows a cashier can be assigned one", async () => {
    atSeedStep(13);
    const note = await screen.findByTestId("standard-roles-note");
    expect(note).toHaveTextContent("أُضيف 12 دوراً قياسياً");
    expect(note).toHaveTextContent("الأدوار والصلاحيات");
  });

  it("says they will arrive once the licence is installed when the install holds only the system role", async () => {
    atSeedStep(1);
    expect(await screen.findByTestId("standard-roles-note")).toHaveTextContent("تُضاف الأدوار القياسية");
  });

  it("says nothing on an edition that does not report its roles", async () => {
    atSeedStep(undefined);
    await screen.findByRole("heading", { name: "تهيئة البيانات الأساسية" });
    expect(screen.queryByTestId("standard-roles-note")).not.toBeInTheDocument();
  });
});

describe("FirstRunWizard — installing a licence file", () => {
  interface Bridge {
    mezan?: { licence?: Record<string, (...args: unknown[]) => Promise<unknown>> };
  }

  afterEach(() => {
    delete (globalThis as Bridge).mezan;
  });

  function withBridge(importResult: unknown): ReturnType<typeof vi.fn> {
    const importLicence = vi.fn().mockResolvedValue(importResult);
    (globalThis as Bridge).mezan = {
      licence: {
        status: () => Promise.resolve({ ok: false, code: "UNAUTHORIZED", message: "لا جلسة." }),
        import: importLicence,
      },
    };
    return importLicence;
  }

  it("states the verified plan, seats and expiry — not «activated»", async () => {
    const importLicence = withBridge({
      ok: true,
      accepted: true,
      status: { plan: "PRO", seats: 4, expiresAt: "2027-03-01T00:00:00.000Z", code: "LIC-OK" },
    });
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "استيراد ملف الترخيص" }));
    await waitFor(() => expect(importLicence).toHaveBeenCalled());
    expect(await screen.findByText(/PRO/)).toHaveTextContent("4");
    expect(await screen.findByText(/2027-03-01/)).toBeInTheDocument();
    expect(screen.getByText("مُفعّل")).toBeInTheDocument();
  });

  // The finding itself: a file that copies but does not verify is not an
  // activation, and must never paint the green pill.
  it("shows no success pill when the file is installed but refused", async () => {
    withBridge({
      ok: true,
      accepted: false,
      status: { plan: "UNLICENSED", seats: 0, expiresAt: null, code: "LIC-INVALID" },
    });
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "استيراد ملف الترخيص" }));
    expect(await screen.findByText(/لم يُقبل/)).toBeInTheDocument();
    expect(screen.queryByText("مُفعّل")).not.toBeInTheDocument();
  });

  it("says nothing at all when the file picker is cancelled", async () => {
    const importLicence = withBridge({ ok: false, code: "CANCELLED", message: "لم يتم اختيار أي ملف." });
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "استيراد ملف الترخيص" }));
    await waitFor(() => expect(importLicence).toHaveBeenCalled());
    expect(screen.queryByText("مُفعّل")).not.toBeInTheDocument();
    expect(screen.queryByText(/لم يتم اختيار أي ملف/)).not.toBeInTheDocument();
  });

  it("renders the refusal the main process gave, in Arabic", async () => {
    withBridge({ ok: false, code: "UNREADABLE", message: "تعذّرت قراءة الملف المختار." });
    renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "استيراد ملف الترخيص" }));
    expect(await screen.findByText("تعذّرت قراءة الملف المختار.")).toBeInTheDocument();
  });
});

describe("FirstRunWizard — the stored theme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("opens in the dark theme the device already chose", () => {
    localStorage.setItem("mezan:theme", "dark");

    renderWizard();

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
