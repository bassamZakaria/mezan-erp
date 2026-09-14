// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { CertificateMaterialLineInputDTO, ProgressCertificateDTO } from "@mezan/contracts";
import { CertificatesScreen } from "./CertificatesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";
import { NavigationProvider } from "../../../navigation";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function TestNavigation({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{ navigate: () => {}, segments, openSubPage: setSegments, openScreenAt: () => {}, intent: null, clearIntent: () => {} }}
    >
      {children}
    </NavigationProvider>
  );
}

/** `Select`'s trigger is a `role="combobox"` button; its options render on a portal with `role="option"`. */
function pickFromSelect(label: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

const computed: ProgressCertificateDTO["computed"] = {
  grossWorks: "500000.000000",
  materialsOnSite: "46500.000000",
  certificateTotal: "546500.000000",
  tenderDiscountPercent: "0",
  tenderDiscount: "0.00",
  netCertified: "546500.00",
  previousNetCertified: "0.00",
  thisCertificateNetCertified: "546500.00",
  deductions: [],
  deductionsThisCertificate: "0.00",
  deductionsCumulative: "0.00",
  suspendedBalance: "0.00",
  invoiceBase: "546500.00",
  vatBasis: "standard",
  vatStatutoryRatePercent: "14",
  vatEffectiveRatePercent: "14",
  vat: "76510.00",
  previousPayments: "0.00",
  netPayableThisCertificate: "623010.00",
  cumulativeNetPayable: "623010.00",
  contractValueAfterVariations: "22331500.00",
  completionPercent: "2.4",
  retentionHeldCumulative: "27325.00",
  advanceReceived: "0.00",
  advanceOutstanding: "0.00",
};

function certificate(overrides: Partial<ProgressCertificateDTO> = {}): ProgressCertificateDTO {
  return {
    id: "CERT-DEMO-1",
    docNo: "CERT-0001",
    contractId: "CTR-DEMO-1",
    contractDocNo: "CTR-0011",
    contractTitleAr: "عقد إنشاء برج الأمل السكني",
    customerId: "CUST-DEMO-2",
    projectId: "PRJ-DEMO-1",
    serial: 1,
    previousCertificateId: null,
    periodFrom: "2026-07-01",
    periodTo: "2026-07-31",
    executionDate: "2026-07-31",
    isFinal: false,
    status: "draft",
    derivedStatus: "draft",
    preparedBy: "u1",
    preparedAt: "2026-07-31",
    measuredBy: null,
    measuredAt: null,
    certifiedBy: null,
    certifiedAt: null,
    approvedBy: null,
    approvedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReasonAr: null,
    voidedAt: null,
    voidedBy: null,
    voidReasonAr: null,
    voidJournalEntryId: null,
    invoiceId: null,
    invoiceDocNo: null,
    journalEntryId: null,
    postedDeductionsTotal: "0.00",
    dueDate: null,
    penaltiesCumulative: "0.00",
    suspendedCumulative: "0.00",
    employerMaterialsCumulative: "0.00",
    waterElectricityCumulative: "0.00",
    notes: null,
    workLines: [],
    materialLines: [
      {
        id: "CERT-DEMO-1-M1",
        materialKey: "steel",
        descriptionAr: "حديد التسليح",
        unit: "ton",
        qty: "10.000000",
        unitRate: "46500.000000",
        previousCumulativeQty: "0.000000",
        cumulativeQty: "10.000000",
        value: "465000.00",
        previousValue: "0.00",
        sortOrder: 1,
      },
    ],
    computed,
    invoice: null,
    daysOverdue: 0,
    latePaymentCompensation: "0.00",
    cbeCreditDiscountRatePercent: null,
    hasLaterCertificate: false,
    ...overrides,
  };
}

interface Calls {
  patched: { materialLines: CertificateMaterialLineInputDTO[] } | null;
}

function renderCertificates(cert: ProgressCertificateDTO, calls: Calls) {
  const transport = stubTransport({
    "GET /contracting/certificates": () => ({ body: [cert] }),
    "GET /contracting/certificates/CERT-DEMO-1": () => ({ body: cert }),
    "GET /projects": () => ({ body: [{ id: "PRJ-DEMO-1", code: "TOWER-A", nameAr: "برج الأمل السكني", customerId: "CUST-DEMO-2" }] }),
    "GET /customers": () => ({ body: [{ id: "CUST-DEMO-2", code: "C-2", nameAr: "مؤسسة النور للمقاولات" }] }),
    "PATCH /contracting/certificates/CERT-DEMO-1": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as { materialLines: CertificateMaterialLineInputDTO[] };
      calls.patched = body;
      return { body: cert };
    },
  });
  return renderWithProviders(
    <TestNavigation>
      <CertificatesScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("CertificatesScreen — materials editor", () => {
  it("shows the stored unit as a select of the BOQ unit enum, in Arabic, never a free-text code", async () => {
    renderCertificates(certificate(), { patched: null });
    fireEvent.click(await screen.findByText("CERT-0001"));
    await screen.findByRole("heading", { name: /CERT-0001/ });
    const unitSelect = screen.getByRole("combobox", { name: "الوحدة" });
    expect(unitSelect).toHaveTextContent("طن");
    // A select, not a text box the surveyor can type any code into.
    expect(screen.queryByRole("textbox", { name: "الوحدة" })).not.toBeInTheDocument();
  });

  it("offers the full BOQ unit enum and sends the picked code, not the label, on save", async () => {
    const calls: Calls = { patched: null };
    renderCertificates(certificate(), calls);
    fireEvent.click(await screen.findByText("CERT-0001"));
    await screen.findByRole("heading", { name: /CERT-0001/ });

    pickFromSelect("الوحدة", "م٣");
    fireEvent.click(await screen.findByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(calls.patched).not.toBeNull());
    expect(calls.patched?.materialLines).toEqual([
      expect.objectContaining({ materialKey: "steel", unit: "m3" }),
    ]);
  });

  it("defaults a new certificate's carried-forward material to the previous certificate's unit", async () => {
    const transport = stubTransport({
      "GET /contracting/contracts": () => ({
        body: [
          {
            id: "CTR-DEMO-1",
            docNo: "CTR-0011",
            titleAr: "عقد إنشاء برج الأمل السكني",
            status: "active",
          },
        ],
      }),
      "GET /contracting/contracts/CTR-DEMO-1/boq": () => ({ body: { lines: [], total: "0.00" } }),
      "POST /contracting/certificates/preview": () => ({
        body: {
          serial: 2,
          executionDate: "2026-08-31",
          workLines: [],
          materialLines: [
            {
              id: "CERT-DEMO-0-M1",
              materialKey: "cement",
              descriptionAr: "أسمنت",
              unit: "kg",
              qty: "500.000000",
              unitRate: "18.000000",
              previousCumulativeQty: "500.000000",
              cumulativeQty: "500.000000",
              value: "9000.00",
              previousValue: "9000.00",
              sortOrder: 1,
            },
          ],
          computed,
          refusals: [],
        },
      }),
    });
    renderWithProviders(
      <TestNavigation>
        <CertificatesScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession, route: "#/contracting/certificates/new" },
    );

    fireEvent.click(screen.getByRole("button", { name: "مستخلص جديد" }));
    const contractInput = screen.getByLabelText("العقد");
    fireEvent.focus(contractInput);
    fireEvent.change(contractInput, { target: { value: "CTR-0011" } });
    fireEvent.mouseDown(
      await screen.findByRole("button", { name: (name) => name.startsWith("عقد إنشاء برج الأمل السكني") }),
    );

    // The row the server carried forward, never typed by the surveyor: its
    // unit is a select already set to the previous certificate's unit, not
    // a blank free-text box the surveyor must fill in.
    const unitSelect = await screen.findByRole("combobox", { name: "الوحدة" });
    await waitFor(() => expect(unitSelect).toHaveTextContent("كجم"));
    expect(screen.getByDisplayValue("cement")).toBeInTheDocument();
  });
});
