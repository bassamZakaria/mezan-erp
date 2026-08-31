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
    items: [{ key: "taxRegistrationNumber", labelAr: "رقم التسجيل الضريبي", complete: true, missing: 0 }],
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

type Handlers = Record<string, (init: RequestInit | undefined, path: string) => StubResult>;

function base(overrides: Handlers = {}): Handlers {
  return {
    "GET /eta/config": () => ({ body: { config: config(), readiness: readiness() } }),
    "GET /eta/submissions": () => ({ body: [] as EtaSubmissionDTO[] }),
    "GET /eta/activity-codes": () => ({ body: [] as EtaActivityCodeDTO[] }),
    "GET /eta/tax-subtypes": () => ({ body: [] as EtaTaxSubTypeRowDTO[] }),
    "GET /eta/branch-codes": () => ({ body: [] as EtaBranchCodeRowDTO[] }),
    "GET /eta/item-mappings": () => ({ body: { rows: [] as EtaItemMappingRowDTO[] } }),
    "GET /eta/unit-mappings": () => ({ body: [] as EtaUnitMappingRowDTO[] }),
    "GET /eta/unit-codes": () => ({ body: [] as EtaUnitCodeDTO[] }),
    ...overrides,
  };
}

function mount(handlers: Handlers) {
  renderWithProviders(<EtaScreen />, { transport: stubTransport(handlers), initialSession: testAdminSession });
}

function openTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("EtaScreen — عام: what the header and the readiness strip report", () => {
  it("marks a tenant filing against the LIVE authority, not the sandbox", async () => {
    mount(base({ "GET /eta/config": () => ({ body: { config: config({ environment: "production" }), readiness: readiness() } }) }));
    expect(await screen.findByText("بيئة الإنتاج (Production)")).toBeInTheDocument();
  });

  it("falls back to the server's own Arabic label for a readiness item this build does not know", async () => {
    mount(
      base({
        "GET /eta/config": () => ({
          body: {
            config: config(),
            readiness: readiness({ items: [{ key: "someFutureCheck", labelAr: "فحص جديد من الخادم", complete: false, missing: 2 }] }),
          },
        }),
      }),
    );
    expect(await screen.findByText("فحص جديد من الخادم (2)")).toBeInTheDocument();
  });

  it("loads the stored address back into the form rather than leaving it blank", async () => {
    mount(
      base({
        "GET /eta/config": () => ({
          body: {
            config: config({
              taxRegistrationNumber: "300123456700003",
              activityCode: "4610",
              address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع مصطفى النحاس", buildingNumber: "12", postalCode: "11765" },
            }),
            readiness: readiness(),
          },
        }),
      }),
    );

    await screen.findByText("40%");
    expect(screen.getByLabelText(/^المحافظة/)).toHaveValue("القاهرة");
    expect(screen.getByLabelText(/^المدينة \/ الحي/)).toHaveValue("مدينة نصر");
    expect(screen.getByLabelText(/^الشارع/)).toHaveValue("شارع مصطفى النحاس");
    expect(screen.getByLabelText(/^رقم المبنى/)).toHaveValue("12");
    expect(screen.getByLabelText(/^الرمز البريدي/)).toHaveValue("11765");
  });

  it("sends null rather than an empty string for a registration number and an address the operator cleared", async () => {
    let saved: Record<string, unknown> | null = null;
    mount(
      base({
        "GET /eta/config": () => ({
          body: {
            config: config({
              taxRegistrationNumber: "300123456700003",
              address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع", buildingNumber: "12", postalCode: null },
            }),
            readiness: readiness(),
          },
        }),
        "PUT /eta/config": (init) => {
          saved = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
          return { body: { config: config(), readiness: readiness() } };
        },
      }),
    );

    await screen.findByText("40%");
    fireEvent.change(screen.getByLabelText(/^رقم التسجيل الضريبي/), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/^المحافظة/), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: "حفظ" })[0]!);

    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toMatchObject({ taxRegistrationNumber: null, address: null });
  });

  it("reads a blank buyer-data threshold as zero rather than sending NaN", async () => {
    let saved: Record<string, unknown> | null = null;
    mount(
      base({
        "PUT /eta/config": (init) => {
          saved = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
          return { body: { config: config(), readiness: readiness() } };
        },
      }),
    );

    await screen.findByText("40%");
    fireEvent.change(screen.getByLabelText(/حد بيانات المشتري/), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: "حفظ" })[0]!);

    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toMatchObject({ buyerDataThreshold: 0 });
  });

  it("marks a tax rate whose authority sub-type the server could not resolve", async () => {
    mount(
      base({
        "GET /eta/tax-subtypes": () => ({
          body: [
            { taxRateId: "vat-0", code: "T0", name: "معفاة", rate: 0, etaSubType: "", resolved: false },
          ] as EtaTaxSubTypeRowDTO[],
        }),
      }),
    );

    const row = (await screen.findByText("معفاة")).closest("tr")!;
    expect(within(row).getByText("تلقائي")).toBeInTheDocument();
  });
});

describe("EtaScreen — أكواد الفروع", () => {
  it("refuses to save a branch whose authority code is still blank", async () => {
    let saves = 0;
    mount(
      base({
        "GET /eta/branch-codes": () => ({
          body: [{ branchId: "br-1", branchName: "الفرع الرئيسي", etaBranchCode: null }] as EtaBranchCodeRowDTO[],
        }),
        "PUT /eta/branch-codes/br-1": () => {
          saves += 1;
          return { body: { branchId: "br-1", branchName: "الفرع الرئيسي", etaBranchCode: "0" } };
        },
      }),
    );

    const row = (await screen.findByText("الفرع الرئيسي")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(saves).toBe(0));
  });
});

describe("EtaScreen — بيانات الربط", () => {
  it("sends null for a client id the operator cleared", async () => {
    let saved: Record<string, unknown> | null = null;
    mount(
      base({
        "GET /eta/config": () => ({ body: { config: config({ clientId: "abc-123" }), readiness: readiness() } }),
        "PUT /eta/config": (init) => {
          saved = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
          return { body: { config: config(), readiness: readiness() } };
        },
      }),
    );

    await screen.findByText("40%");
    openTab("بيانات الربط");
    fireEvent.change(screen.getByLabelText(/معرّف العميل/), { target: { value: "  " } });
    fireEvent.click(screen.getAllByRole("button", { name: "حفظ" })[0]!);

    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toMatchObject({ clientId: null });
  });

  it("keeps the typed secret and claims no success when the save is refused", async () => {
    mount(
      base({
        "PUT /eta/config": () => ({ status: 422, body: { error: "INVALID_CREDENTIALS", message: "بيانات الربط غير صالحة." } }),
      }),
    );

    await screen.findByText("40%");
    openTab("بيانات الربط");
    fireEvent.change(screen.getByLabelText(/السر \(Client Secret\)/), { target: { value: "s3cret" } });
    fireEvent.click(screen.getAllByRole("button", { name: "حفظ" })[0]!);

    // The card shows no banner of its own; what it must NOT do is claim success
    // or throw the typed secret away, so the operator can simply press save again.
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ" })).toBeEnabled());
    expect(screen.queryByText("حُفظت الإعدادات.")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/السر \(Client Secret\)/)).toHaveValue("s3cret");
  });

  it("says the authority is unreachable when the test fails for a reason other than missing credentials", async () => {
    mount(base({ "POST /eta/test-connection": () => ({ body: { ok: false, reason: "offline" } }) }));

    await screen.findByText("40%");
    openTab("بيانات الربط");
    fireEvent.click(screen.getByRole("button", { name: "اختبار الاتصال" }));

    expect(await screen.findByText(/تعذّر الاتصال|غير متاح|بلا اتصال/)).toBeInTheDocument();
  });
});

describe("EtaScreen — ربط الأصناف", () => {
  const row: EtaItemMappingRowDTO = {
    itemId: "item-1",
    code: "ITM-1",
    nameAr: "أسمنت",
    nameEn: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
  };

  it("defaults an unmapped item to the EGS scheme rather than leaving it blank", async () => {
    mount(base({ "GET /eta/item-mappings": () => ({ body: { rows: [row] } }) }));

    openTab("ربط الأصناف");
    await screen.findByText("ITM-1");
    expect(screen.getByRole("combobox", { name: /نوع الكود/ })).toHaveTextContent("EGS");
  });

  it("sends null rather than an empty string for the codes an operator left blank", async () => {
    let saved: Record<string, unknown> | null = null;
    mount(
      base({
        "GET /eta/item-mappings": () => ({ body: { rows: [row] } }),
        "PUT /eta/item-mappings/item-1": (init) => {
          saved = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
          return { body: { ...row, etaCodeType: "EGS" } };
        },
      }),
    );

    openTab("ربط الأصناف");
    await screen.findByText("ITM-1");
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toEqual({ etaCodeType: "EGS", etaItemCode: null, gpcCode: null });
  });

  it("keeps an item on the GPC scheme when that is what the operator chose", async () => {
    let saved: Record<string, unknown> | null = null;
    mount(
      base({
        "GET /eta/item-mappings": () => ({ body: { rows: [row] } }),
        "PUT /eta/item-mappings/item-1": (init) => {
          saved = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
          return { body: { ...row, etaCodeType: "GPC" } };
        },
      }),
    );

    openTab("ربط الأصناف");
    await screen.findByText("ITM-1");
    fireEvent.click(screen.getByRole("combobox", { name: /نوع الكود/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "GPC" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toMatchObject({ etaCodeType: "GPC" });
  });
});

describe("EtaScreen — ربط الوحدات", () => {
  const unitRow: EtaUnitMappingRowDTO = {
    unitCode: "PCS",
    nameAr: "قطعة",
    nameEn: null,
    etaUnitCode: null,
    suggestion: null,
  };

  it("shows a dash for a unit the server has no suggestion for", async () => {
    mount(base({ "GET /eta/unit-mappings": () => ({ body: [unitRow] }) }));

    openTab("ربط الوحدات");
    const row = (await screen.findByText("PCS")).closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("refuses to save a unit that has not been mapped to anything yet", async () => {
    let saves = 0;
    mount(
      base({
        "GET /eta/unit-mappings": () => ({ body: [unitRow] }),
        "PUT /eta/unit-mappings/PCS": () => {
          saves += 1;
          return { body: unitRow };
        },
      }),
    );

    openTab("ربط الوحدات");
    await screen.findByText("PCS");
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(saves).toBe(0));
  });
});

describe("EtaScreen — الإرسالات", () => {
  it("reports the authority's own refusal against the row that was rejected", async () => {
    mount(
      base({
        "GET /eta/submissions": () => ({ body: [submission()] }),
        "POST /eta/submissions/s1/submit": () => ({ status: 422, body: { error: "ETA_REJECTED", message: "رفضت المصلحة المستند." } }),
      }),
    );

    openTab("الإرسالات");
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات INV-000014" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إرسال" }));

    expect(await screen.findByText("رفضت المصلحة المستند.")).toBeInTheDocument();
  });

  it("refuses to exclude a document until a reason is written", async () => {
    let excludes = 0;
    mount(
      base({
        "GET /eta/submissions": () => ({ body: [submission()] }),
        "POST /eta/submissions/s1/exclude": () => {
          excludes += 1;
          return { body: submission({ status: "excluded", exclusionReason: "x" }) };
        },
      }),
    );

    openTab("الإرسالات");
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات INV-000014" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "استبعاد" }));
    fireEvent.click(await screen.findByRole("button", { name: "استبعاد" }));

    fireEvent.change(await screen.findByLabelText("سبب الاستبعاد"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الاستبعاد" }));

    await waitFor(() => expect(excludes).toBe(0));
  });

  it("keeps the exclusion dialog open and shows why when the server refuses", async () => {
    mount(
      base({
        "GET /eta/submissions": () => ({ body: [submission()] }),
        "POST /eta/submissions/s1/exclude": () => ({ status: 422, body: { error: "ALREADY_SUBMITTED", message: "المستند مُرسَل بالفعل." } }),
      }),
    );

    openTab("الإرسالات");
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات INV-000014" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "استبعاد" }));
    fireEvent.click(await screen.findByRole("button", { name: "استبعاد" }));

    fireEvent.change(await screen.findByLabelText("سبب الاستبعاد"), { target: { value: "فاتورة تجريبية" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الاستبعاد" }));

    expect(await screen.findByText("المستند مُرسَل بالفعل.")).toBeInTheDocument();
    expect(screen.getByLabelText("سبب الاستبعاد")).toHaveValue("فاتورة تجريبية");
  });
});
