import type { App } from "@mezan/api";
import { BRANCH_ID, CORE, SeedPerson, hasHappened, seedActorHeaders, seededUserId, step } from "./shared.js";

/**
 * المستخلصات — slice 2 of المقاولات, seeded through the real routes.
 *
 * Every signature carries its OWN date and they run forward —
 * periodTo ≤ measuredAt ≤ certifiedAt ≤ approvedAt — because the service now
 * refuses a certificate cleared for payment before it was measured, and a seed
 * that stamped all three with today() could never prove it.
 *
 * Every figure the screens show is the server's: the previous cumulative, the
 * contracted quantity as of the execution date, the whole deductions block and
 * the net payable are derived from the certificates that came before and from
 * the posted ledger. Nothing here is a fixture the UI reads directly.
 *
 * The three signatures are held by three DIFFERENT seeded identities, because
 * preparer ≠ certifier ≠ approver is enforced by userId and seeding it with one
 * admin would leave the rule untested in the one place a person can see it.
 */

const TOWER_CONTRACT = "CTR-DEMO-1";
const TOWER_PROJECT = "PRJ-DEMO-1";
const TOWER_CUSTOMER = CORE.customers[1];
const BANK_TREASURY_ID = "TR-DEMO-BANK";
const BANK_GL = "1310";

const VIEW = "contracting.certificate.view";
const SURVEYOR = seedActor(SeedPerson.TechnicalOffice, ["contracting.certificate.prepare", VIEW]);
const CONSULTANT = seedActor(SeedPerson.ConsultantQs, ["contracting.certificate.certify", VIEW]);
const EMPLOYER_FINANCE = seedActor(SeedPerson.ContractingFinance, ["contracting.certificate.approve", VIEW]);

function seedActor(person: SeedPerson, permissions: readonly string[]) {
  return () => seedActorHeaders(seededUserId(person), permissions, null);
}

async function stepAs(
  app: App,
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await app.fetch(
    new Request(`http://demo-seed${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    throw new Error(`[demo-seed] ${method} ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

interface BoqLineRow {
  id: string;
  code: string;
}

interface CertificateRow {
  id: string;
  docNo: string;
  invoiceId: string | null;
  computed: { netPayableThisCertificate: string };
}

/** BOQ line id by its bill item number, so the seed never hardcodes an id the server generated. */
async function boqLineIds(app: App): Promise<Map<string, string>> {
  const res = (await step(app, "GET", `/contracting/contracts/${TOWER_CONTRACT}/boq`)) as {
    lines: BoqLineRow[];
  };
  return new Map(res.lines.map((l) => [l.code, l.id]));
}

export async function seedContractingCertificates(app: App): Promise<void> {
  // The single non-stock line every generated certificate invoice names. Real
  // enough to be looked up on the invoice screen rather than a dangling id.
  await step(app, "POST", "/items", {
    id: "SRV-CONTRACTING-WORKS",
    code: "SRV-MST-01",
    nameAr: "أعمال مقاولات منفذة بالمستخلص",
    nameEn: "Certified contracting works",
    type: "service",
    baseUnitCode: "PCS",
    taxRatePercent: 14,
    trackInventory: false,
    salePrice: "0",
    costPrice: "0",
    revenueAccountId: "4100",
    cogsAccountId: "5100",
    inventoryAccountId: "1200",
  });

  const boq = await boqLineIds(app);
  const line = (code: string): string => {
    const id = boq.get(code);
    if (!id) throw new Error(`[demo-seed] certificates: BOQ line "${code}" is missing from ${TOWER_CONTRACT}`);
    return id;
  };

  /**
   * Quantities climb toward the design's picture but stay small enough early
   * that the advance recovery lands under the 60,000 actually received on
   * VCH-DEMO-PRJ-ADV — and then deliberately exceeds it on the third, so the
   * cap is a thing a reader can see working rather than a branch nothing takes.
   */
  const certificates = [
    {
      id: "MST-DEMO-1",
      periodFrom: "2026-05-01",
      periodTo: "2026-05-31",
      executionDate: "2026-05-31",
      workLines: [{ code: "1", qty: "1600" }],
      materialLines: [] as { materialKey: string; descriptionAr: string; unit: string; qty: string; unitRate: string }[],
      measuredAt: "2026-06-01",
      certifiedAt: "2026-06-03",
      approvedAt: "2026-06-05",
    },
    {
      id: "MST-DEMO-2",
      periodFrom: "2026-06-01",
      periodTo: "2026-06-30",
      executionDate: "2026-06-30",
      workLines: [
        { code: "1", qty: "1200" },
        { code: "2", qty: "30" },
      ],
      materialLines: [],
      measuredAt: "2026-07-01",
      certifiedAt: "2026-07-03",
      approvedAt: "2026-07-06",
    },
    {
      id: "MST-DEMO-3",
      periodFrom: "2026-07-01",
      periodTo: "2026-07-31",
      executionDate: "2026-07-31",
      workLines: [
        { code: "1", qty: "1200" },
        { code: "2", qty: "90" },
        { code: "3", qty: "40" },
      ],
      materialLines: [],
      measuredAt: "2026-08-01",
      certifiedAt: "2026-08-03",
      approvedAt: "2026-08-06",
    },
  ] as const;

  let firstInvoiceId: string | null = null;
  let firstNetPayable = "0";

  for (const spec of certificates) {
    await stepAs(app, SURVEYOR(), "POST", "/contracting/certificates", {
      id: spec.id,
      contractId: TOWER_CONTRACT,
      periodFrom: spec.periodFrom,
      periodTo: spec.periodTo,
      executionDate: spec.executionDate,
      workLines: spec.workLines.map((w) => ({ boqLineId: line(w.code), thisPeriodQty: w.qty })),
      materialLines: spec.materialLines,
    });
    await stepAs(app, SURVEYOR(), "POST", `/contracting/certificates/${spec.id}/measure`, {
      measuredAt: spec.measuredAt,
    });
    await stepAs(app, CONSULTANT(), "POST", `/contracting/certificates/${spec.id}/certify`, {
      certifiedAt: spec.certifiedAt,
    });
    const approved = (await stepAs(app, EMPLOYER_FINANCE(), "POST", `/contracting/certificates/${spec.id}/approve`, {
      approvedAt: spec.approvedAt,
    })) as unknown as CertificateRow;
    if (spec.id === "MST-DEMO-1") {
      firstInvoiceId = approved.invoiceId;
      firstNetPayable = approved.computed.netPayableThisCertificate;
    }
  }

  // «محصّل» is DERIVED from the invoice's remaining balance, so the first
  // certificate reads collected only because the money really arrived and was
  // allocated to the invoice it generated.
  if (firstInvoiceId) {
    await step(app, "POST", "/vouchers", {
      id: "VCH-DEMO-MST-1",
      date: "2026-07-02",
      memo: "تحصيل مستخلص رقم ١ — برج الأمل",
      voucherType: "customer_collection",
      amount: firstNetPayable,
      branchId: BRANCH_ID,
      paymentMethod: "bank",
      treasuryAccountId: BANK_TREASURY_ID,
      treasuryGlAccountId: BANK_GL,
      counterpartyGlAccountId: "1105",
      customerId: TOWER_CUSTOMER,
      projectId: TOWER_PROJECT,
    });
    await step(app, "POST", "/vouchers/VCH-DEMO-MST-1/confirm", {});
    await step(app, "POST", "/vouchers/VCH-DEMO-MST-1/allocations", {
      invoiceId: firstInvoiceId,
      amount: firstNetPayable,
    });
  }

  /**
   * August: التشوينات — 18.35 tonnes of rebar delivered to site and jointly
   * inspected, certified at the contract's 75%. Left at «معتمد من الاستشاري»,
   * which is where a real certificate sits while the employer's finance
   * department works through it (D-09).
   */
  await stepAs(app, SURVEYOR(), "POST", "/contracting/certificates", {
    id: "MST-DEMO-4",
    contractId: TOWER_CONTRACT,
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    executionDate: "2026-08-31",
    workLines: [
      { boqLineId: line("1"), thisPeriodQty: "1200" },
      { boqLineId: line("2"), thisPeriodQty: "140" },
      { boqLineId: line("3"), thisPeriodQty: "110" },
      { boqLineId: line("7"), thisPeriodQty: "12" },
    ],
    materialLines: [
      {
        materialKey: "REBAR-16MM",
        descriptionAr: "حديد تسليح مورد بالموقع",
        unit: "ton",
        qty: "18.35",
        unitRate: "46500.00",
      },
    ],
    notes: "تشوينات حديد التسليح بمحضر معاينة مشترك رقم ٤١.",
  });
  if (hasHappened("2026-09-02")) {
    await stepAs(app, SURVEYOR(), "POST", "/contracting/certificates/MST-DEMO-4/measure", {
      measuredAt: "2026-09-02",
    });
  }
  if (hasHappened("2026-09-05")) {
    await stepAs(app, CONSULTANT(), "POST", "/contracting/certificates/MST-DEMO-4/certify", {
      certifiedAt: "2026-09-05",
    });
  }

  await stepAs(app, SURVEYOR(), "POST", "/contracting/certificates", {
    id: "MST-DEMO-5",
    contractId: TOWER_CONTRACT,
    periodFrom: "2026-09-01",
    periodTo: "2026-09-30",
    executionDate: "2026-09-30",
    workLines: [
      { boqLineId: line("1"), thisPeriodQty: "800" },
      { boqLineId: line("3"), thisPeriodQty: "90" },
    ],
    materialLines: [],
    notes: "مسودة — في انتظار حصر أعمال البياض.",
  });
}
