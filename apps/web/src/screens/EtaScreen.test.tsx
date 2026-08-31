// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type {
  EtaActivityCodeDTO,
  EtaBranchCodeRowDTO,
  EtaConfigDTO,
  EtaItemMappingRowDTO,
  EtaReadinessDTO,
  EtaSubmissionDTO,
  EtaTaxSubTypeRowDTO,
  EtaUnitCodeDTO,
  EtaUnitMappingRowDTO,
} from "@mezan/contracts";
import { EtaScreen } from "./EtaScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

/**
 * Types into the activity-code `EntityPicker` and commits the matching
 * option. Unlike BomsScreen's item picker, EtaScreen's outer `<Field>` does
 * not pass its label down to `EntityPicker` (it never sets `label` there, and
 * the wrapping `<Field>` has no `htmlFor` either — see EtaScreen.tsx:269-276),
 * so `getByLabelText` cannot find this control. Its placeholder is the only
 * reliable handle.
 */
function pickActivityCode(optionCode: string) {
  const input = screen.getByPlaceholderText("ابحث عن كود النشاط...");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionCode } });
  const option = screen.getByRole("button", { name: (name) => name.startsWith(optionCode) });
  fireEvent.mouseDown(option);
}

function selectValue(triggerName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

/**
 * The environment/document-version/signing-method `Select`s in EtaScreen are
 * wrapped only in the generic `<Field label=…>` — which never sets `htmlFor`
 * — and never pass their own `aria-label` to `Select` either (unlike the
 * per-row code-type/unit-code `Select`s, which do). The trigger button ends
 * up with NO accessible name at all (EtaScreen.tsx:259-267, 319-328,
 * 490-499), so it can only be found by its position next to the visible
 * label text, not by role+name.
 */
function selectNearLabel(labelText: string, optionLabel: string) {
  const label = screen.getByText(labelText, { selector: "label" });
  const trigger = label.parentElement?.querySelector<HTMLElement>('[role="combobox"]');
  if (!trigger) throw new Error(`No combobox found next to label "${labelText}"`);
  fireEvent.click(trigger);
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

function config(overrides: Partial<EtaConfigDTO> = {}): EtaConfigDTO {
  return {
    environment: "preproduction",
    taxRegistrationNumber: null,
    activityCode: null,
    address: null,
    buyerDataThreshold: 25000,
    documentVersion: "1.0",
    autoSubmitOnConfirm: false,
    signingMethod: "none",
    clientId: null,
    hasClientSecret: false,
    ...overrides,
  };
}

function readiness(overrides: Partial<EtaReadinessDTO> = {}): EtaReadinessDTO {
  return {
    percent: 40,
    items: [
      { key: "taxRegistrationNumber", labelAr: "رقم التسجيل الضريبي", complete: true, missing: 0 },
      { key: "activityCode", labelAr: "كود النشاط", complete: false, missing: 1 },
    ],
    ...overrides,
  };
}

function submission(overrides: Partial<EtaSubmissionDTO> = {}): EtaSubmissionDTO {
  return {
    id: "s1",
    internalId: "INV-000014",
    documentType: "invoice",
    status: "ready",
    etaUuid: null,
    errors: [],
    exclusionReason: null,
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:00:00.000Z",
    submittedAt: null,
    ...overrides,
  };
}

/** Records every matched call as `"METHOD /path?query"` alongside the stubbed transport. */
function trackedTransport(handlers: Record<string, (init: RequestInit | undefined, path: string) => StubResult>) {
  const calls: string[] = [];
  const wrapped: typeof handlers = {};
  for (const [key, fn] of Object.entries(handlers)) {
    wrapped[key] = (init, path) => {
      calls.push(`${key.split(" ")[0]} ${path}`);
      return fn(init, path);
    };
  }
  return { transport: stubTransport(wrapped), calls };
}

describe("EtaScreen — top level", () => {
  it("renders an honest error and retries GET /eta/config on failure", async () => {
    const { transport, calls } = trackedTransport({
      "GET /eta/config": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /eta/submissions": () => ({ body: [] }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("تعذّر تحميل بيانات الفاتورة الإلكترونية.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/INTERNAL/)).not.toBeInTheDocument());

    const before = calls.filter((c) => c.startsWith("GET /eta/config")).length;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => {
      expect(calls.filter((c) => c.startsWith("GET /eta/config")).length).toBeGreaterThan(before);
    });
  });
});

describe("EtaScreen — عام (general)", () => {
  it("renders config, readiness and tax sub-types from the real routes", async () => {
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config({ taxRegistrationNumber: "300123456700003" }), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "GET /eta/activity-codes": () => ({ body: [] as EtaActivityCodeDTO[] }),
      "GET /eta/tax-subtypes": () => ({
        body: [
          { taxRateId: "vat-14", code: "T1", name: "ضريبة القيمة المضافة", rate: 14, etaSubType: "V009", resolved: true },
        ] as EtaTaxSubTypeRowDTO[],
      }),
      "GET /eta/branch-codes": () => ({ body: [] as EtaBranchCodeRowDTO[] }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "الفاتورة الإلكترونية" })).toBeInTheDocument();
    const readinessCard = (await screen.findByText("40%")).closest("div.rounded-lg") as HTMLElement;
    expect(within(readinessCard).getByText(/رقم التسجيل الضريبي/)).toBeInTheDocument();
    expect(within(readinessCard).getByText(/كود النشاط \(1\)/)).toBeInTheDocument();
    expect(await screen.findByText("ضريبة القيمة المضافة")).toBeInTheDocument();
    expect(screen.getByText("V009")).toBeInTheDocument();
  });

  it("saves company settings with the real activity-code id and a trimmed address via PUT /eta/config", async () => {
    let saved: unknown = null;
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "GET /eta/activity-codes": () => ({
        body: [{ code: "4610", labelAr: "تجارة الجملة والتجزئة", labelEn: "Wholesale and retail trade" }] as EtaActivityCodeDTO[],
      }),
      "GET /eta/tax-subtypes": () => ({ body: [] as EtaTaxSubTypeRowDTO[] }),
      "GET /eta/branch-codes": () => ({ body: [] as EtaBranchCodeRowDTO[] }),
      "PUT /eta/config": (init) => {
        saved = JSON.parse((init?.body as string) ?? "{}");
        return { body: { config: config({ ...(saved as object) }), readiness: readiness({ percent: 100 }) } };
      },
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    await screen.findByText("40%");
    fireEvent.change(screen.getByLabelText(/^رقم التسجيل الضريبي/), { target: { value: "300123456700003" } });
    pickActivityCode("4610");
    fireEvent.change(screen.getByLabelText(/^المحافظة/), { target: { value: "القاهرة" } });
    fireEvent.change(screen.getByLabelText(/^المدينة \/ الحي/), { target: { value: "مدينة نصر" } });
    fireEvent.change(screen.getByLabelText(/^الشارع/), { target: { value: "شارع مصطفى النحاس" } });
    fireEvent.change(screen.getByLabelText(/^رقم المبنى/), { target: { value: "12" } });

    fireEvent.click(screen.getAllByRole("button", { name: "حفظ" })[0]!);

    await screen.findByText("حُفظت الإعدادات.");
    expect(saved).toEqual({
      environment: "preproduction",
      taxRegistrationNumber: "300123456700003",
      activityCode: "4610",
      address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع مصطفى النحاس", buildingNumber: "12", postalCode: null },
      buyerDataThreshold: 25000,
      documentVersion: "1.0",
      autoSubmitOnConfirm: false,
    });
  });

  /**
   * Same shape as D124. `onClick={save}` does not await `save()`, and `save()`
   * awaited `update.mutateAsync` with no try/catch — so a rejected save
   * escaped as an unhandled promise rejection, and `setSaved(true)` ran on a
   * save that never happened. Both halves are asserted: no rejection, and the
   * screen does not claim success.
   */
  it("reports a failed config save, claims no success, and leaks no unhandled rejection", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const { transport } = trackedTransport({
        "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
        "GET /eta/submissions": () => ({ body: [] }),
        "GET /eta/activity-codes": () => ({ body: [] as EtaActivityCodeDTO[] }),
        "GET /eta/tax-subtypes": () => ({ body: [] as EtaTaxSubTypeRowDTO[] }),
        "GET /eta/branch-codes": () => ({ body: [] as EtaBranchCodeRowDTO[] }),
        "PUT /eta/config": () => ({ status: 422, body: { error: "INVALID_TRN", message: "رقم التسجيل الضريبي غير صالح." } }),
      });
      renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

      await screen.findByText("40%");
      fireEvent.change(screen.getByLabelText(/^رقم التسجيل الضريبي/), { target: { value: "1" } });
      fireEvent.click(screen.getAllByRole("button", { name: "حفظ" })[0]!);

      await waitFor(() => expect(rejections).toEqual([]));
      // The success line must NOT appear — the config was refused.
      expect(screen.queryByText("حُفظت الإعدادات.")).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("saves a branch's authority code via PUT /eta/branch-codes/:branchId", async () => {
    let saved: unknown = null;
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "GET /eta/activity-codes": () => ({ body: [] as EtaActivityCodeDTO[] }),
      "GET /eta/tax-subtypes": () => ({ body: [] as EtaTaxSubTypeRowDTO[] }),
      "GET /eta/branch-codes": () => ({
        body: [{ branchId: "b1", branchCode: "MAIN", branchName: "الفرع الرئيسي", etaBranchCode: null }] as EtaBranchCodeRowDTO[],
      }),
      "PUT /eta/branch-codes/b1": (init) => {
        saved = JSON.parse((init?.body as string) ?? "{}");
        return { body: { branchId: "b1", branchCode: "MAIN", branchName: "الفرع الرئيسي", etaBranchCode: (saved as { etaBranchCode: string }).etaBranchCode } };
      },
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    const input = await screen.findByLabelText("كود الفرع لدى المصلحة — الفرع الرئيسي");
    fireEvent.change(input, { target: { value: "EG-MAIN-01" } });
    const row = input.closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(saved).toEqual({ etaBranchCode: "EG-MAIN-01" }));
  });
});

describe("EtaScreen — بيانات الربط (credentials)", () => {
  it("saves client id and signing method without overwriting the secret when left blank, via PUT /eta/config", async () => {
    let saved: unknown = null;
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config({ clientId: "old-client", hasClientSecret: true }), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "PUT /eta/config": (init) => {
        saved = JSON.parse((init?.body as string) ?? "{}");
        return { body: { config: config({ ...(saved as object) }), readiness: readiness() } };
      },
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "بيانات الربط" }));
    const clientIdInput = await screen.findByLabelText("معرّف العميل (Client ID)");
    fireEvent.change(clientIdInput, { target: { value: "new-client-id" } });
    selectNearLabel("طريقة التوقيع", "ختم إلكتروني (e-Seal)");
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await screen.findByText("حُفظت الإعدادات.");
    expect(saved).toEqual({ clientId: "new-client-id", signingMethod: "eseal" });
  });

  it("shows the Arabic reason a connection test could not run", async () => {
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "POST /eta/test-connection": () => ({ body: { ok: false, reason: "missing_credentials", checkedAt: "2026-08-30T00:00:00.000Z" } }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "بيانات الربط" }));
    fireEvent.click(await screen.findByRole("button", { name: "اختبار الاتصال" }));
    expect(await screen.findByText("تعذّر الاختبار: أكمل معرّف العميل والسر أولاً.")).toBeInTheDocument();
  });
});

describe("EtaScreen — ربط الأصناف (item mapping)", () => {
  it("lists mappings from GET /eta/item-mappings and re-queries the server on every filter change", async () => {
    const rows: EtaItemMappingRowDTO[] = [
      { itemId: "item-1", code: "ITM-1", nameAr: "أرز أبيض", nameEn: null, etaCodeType: "EGS", etaItemCode: null, gpcCode: null },
    ];
    const { transport, calls } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "GET /eta/item-mappings": () => ({ body: { rows, total: rows.length, unmapped: 1 } }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "ربط الأصناف" }));
    expect(await screen.findByText("ITM-1")).toBeInTheDocument();
    expect(calls).toContain("GET /eta/item-mappings");

    fireEvent.change(screen.getByPlaceholderText("ابحث بالكود أو الاسم..."), { target: { value: "أرز" } });
    await waitFor(() => expect(calls).toContain("GET /eta/item-mappings?q=%D8%A3%D8%B1%D8%B2"));

    fireEvent.click(screen.getByRole("radio", { name: /غير المربوطة فقط/ }));
    await waitFor(() =>
      expect(calls).toContain("GET /eta/item-mappings?q=%D8%A3%D8%B1%D8%B2&unmapped=1"),
    );
  });

  it("shows an honest empty state when nothing matches", async () => {
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "GET /eta/item-mappings": () => ({ body: { rows: [], total: 0, unmapped: 0 } }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "ربط الأصناف" }));
    expect(await screen.findByText("لا توجد أصناف مطابقة")).toBeInTheDocument();
  });

  it("saves an item's authority code via PUT /eta/item-mappings/:itemId", async () => {
    let saved: unknown = null;
    const row: EtaItemMappingRowDTO = { itemId: "item-1", code: "ITM-1", nameAr: "أرز أبيض", nameEn: null, etaCodeType: "EGS", etaItemCode: null, gpcCode: null };
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "GET /eta/item-mappings": () => ({ body: { rows: [row], total: 1, unmapped: 1 } }),
      "PUT /eta/item-mappings/item-1": (init) => {
        saved = JSON.parse((init?.body as string) ?? "{}");
        return { body: { ...row, ...(saved as object) } };
      },
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "ربط الأصناف" }));
    await screen.findByText("ITM-1");
    fireEvent.change(screen.getByLabelText("كود الصنف لدى المصلحة — ITM-1"), { target: { value: "EG-1001" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() =>
      expect(saved).toEqual({ etaCodeType: "EGS", etaItemCode: "EG-1001", gpcCode: null }),
    );
  });
});

describe("EtaScreen — ربط الوحدات (unit mapping)", () => {
  it("saves a unit's authority code and applies suggestions", async () => {
    let saved: unknown = null;
    const row: EtaUnitMappingRowDTO = { unitCode: "PCS", nameAr: "قطعة", nameEn: null, etaUnitCode: null, suggestion: "EA" };
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
      "GET /eta/unit-mappings": () => ({ body: [row] as EtaUnitMappingRowDTO[] }),
      "GET /eta/unit-codes": () => ({ body: [{ code: "EA", labelAr: "قطعة", labelEn: "Each" }] as EtaUnitCodeDTO[] }),
      "PUT /eta/unit-mappings/PCS": (init) => {
        saved = JSON.parse((init?.body as string) ?? "{}");
        return { body: { ...row, ...(saved as object) } };
      },
      "POST /eta/unit-mappings/apply-suggestions": () => ({
        body: { applied: [{ ...row, etaUnitCode: "EA" }], unresolved: [] },
      }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "ربط الوحدات" }));
    expect(await screen.findByText("EA")).toBeInTheDocument(); // the suggestion column
    selectValue("كود الوحدة لدى المصلحة — PCS", "EA — قطعة");
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(saved).toEqual({ etaUnitCode: "EA" }));

    fireEvent.click(screen.getByRole("button", { name: "تطبيق الاقتراحات" }));
    expect(await screen.findByText(/الاقتراحات المُطبَّقة: 1/)).toBeInTheDocument();
  });
});

describe("EtaScreen — الإرسالات (submissions)", () => {
  it("lists submissions from a single GET /eta/submissions call, even across tab visits", async () => {
    const { transport, calls } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [submission()] }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "الإرسالات" }));
    expect(await screen.findByText("INV-000014")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "عام" }));
    fireEvent.click(screen.getByRole("tab", { name: "الإرسالات" }));
    await screen.findByText("INV-000014");

    expect(calls.filter((c) => c.startsWith("GET /eta/submissions"))).toEqual(["GET /eta/submissions"]);
  });

  it("shows an honest empty state for a status with no documents", async () => {
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [] }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "الإرسالات" }));
    expect(await screen.findByText("لا توجد مستندات في هذه الحالة")).toBeInTheDocument();
  });

  it("keeps a document queued when the offline transmit is stubbed (202)", async () => {
    const { transport, calls } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [submission()] }),
      "POST /eta/submissions/s1/submit": () => ({ status: 202, body: { error: "ETA_OFFLINE", message: "offline" } }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "الإرسالات" }));
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات INV-000014" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إرسال" }));

    expect(await screen.findByText(/قائمة الإرسال/)).toBeInTheDocument();
    expect(calls).toContain("POST /eta/submissions/s1/submit");
  });

  it("renders the server's Arabic refusal message when a submit fails outright", async () => {
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [submission({ status: "error", errors: ["INVALID_TAX_CODE"] })] }),
      "POST /eta/submissions/s1/submit": () => ({
        status: 409,
        body: { error: "ETA_REJECTED", message: "تعذّر الإرسال — كود الضريبة غير صالح لدى المصلحة." },
      }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "الإرسالات" }));
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات INV-000014" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إرسال" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذّر الإرسال — كود الضريبة غير صالح لدى المصلحة.");
    expect(alert).not.toHaveTextContent("ETA_REJECTED");
  });

  it("excludes a submission with the operator's reason via POST /eta/submissions/:id/exclude", async () => {
    let saved: unknown = null;
    const { transport } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [submission()] }),
      "POST /eta/submissions/s1/exclude": (init) => {
        saved = JSON.parse((init?.body as string) ?? "{}");
        return { body: submission({ status: "excluded", exclusionReason: (saved as { reason: string }).reason }) };
      },
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "الإرسالات" }));
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات INV-000014" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "استبعاد" }));
    // "استبعاد" carries tone: "danger", so RowMenu interposes its own
    // confirmation dialog before calling onSelect (RowMenu.tsx:129-131) —
    // confirm that first.
    fireEvent.click(await screen.findByRole("button", { name: "استبعاد" }));

    fireEvent.change(await screen.findByLabelText("سبب الاستبعاد"), { target: { value: "مستند اختباري لا يُرسل" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الاستبعاد" }));

    await waitFor(() => expect(saved).toEqual({ reason: "مستند اختباري لا يُرسل" }));
  });

  it("submits everything ready via POST /eta/submissions/submit-all and reports what stayed queued", async () => {
    const { transport, calls } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({ body: [submission(), submission({ id: "s2", internalId: "INV-000015" })] }),
      "POST /eta/submissions/submit-all": () => ({ body: { submitted: [], queued: ["s1", "s2"] } }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "الإرسالات" }));
    await screen.findByText("INV-000014");
    fireEvent.click(screen.getByRole("button", { name: "إرسال كل الجاهز" }));

    expect(await screen.findByText(/بقيت في قائمة الإرسال: 2/)).toBeInTheDocument();
    expect(calls).toContain("POST /eta/submissions/submit-all");
  });

  it("filters the visible rows by status without a new request (already-loaded submissions)", async () => {
    const { transport, calls } = trackedTransport({
      "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
      "GET /eta/submissions": () => ({
        body: [submission(), submission({ id: "s2", internalId: "INV-000015", status: "accepted", etaUuid: "uuid-1" })],
      }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    fireEvent.click(screen.getByRole("tab", { name: "الإرسالات" }));
    await screen.findByText("INV-000014");
    expect(screen.getByText("INV-000015")).toBeInTheDocument();

    // The status chips filter the already-fetched list in memory (the counts
    // next to each chip need the full list up front) — no extra round trip.
    fireEvent.click(screen.getByRole("radio", { name: /^مقبول/ }));
    await waitFor(() => expect(screen.queryByText("INV-000014")).not.toBeInTheDocument());
    expect(screen.getByText("INV-000015")).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith("GET /eta/submissions"))).toEqual(["GET /eta/submissions"]);
  });
});
