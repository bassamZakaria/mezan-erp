import type { App } from "@mezan/api";
import { BRANCH_ID, CORE, seedActorHeaders, step } from "./shared.js";

/**
 * عقود الباطن ومستخلصاتها — slice 3 of المقاولات, seeded through the real routes.
 *
 * Every figure the screens show is the server's: the margin against the client
 * line, the previous cumulative, the ceiling the consultant certified to the
 * employer, the whole deductions block and the net payable are derived from the
 * client certificates that came before and from the posted ledger.
 *
 * The three signatures are held by the SAME three seeded identities the client
 * certificate uses, because the separation of duties is the same rule and
 * seeding it with one admin would leave it untested in the one place a person
 * can see it.
 */

const TOWER_CONTRACT = "CTR-DEMO-1";
const SUBCONTRACTOR = CORE.suppliers[0];
const BANK_TREASURY_ID = "TR-DEMO-BANK";
const BANK_GL = "1310";
/** سلف الموردين — an advance to a subcontractor is an asset until a certificate recovers it. */
const SUPPLIER_ADVANCES_GL = "1350";

const EXCAVATION = "SUB-DEMO-1";
const PLASTERING = "SUB-DEMO-2";

const VIEW = "contracting.certificate.view";
const SITE_ENGINEER = seedActor("USER-DEMO-SURVEYOR", ["contracting.certificate.prepare", VIEW]);
const TECHNICAL_OFFICE = seedActor("USER-DEMO-CONSULTANT", ["contracting.certificate.certify", VIEW]);
const FINANCE = seedActor("USER-DEMO-CERT-FINANCE", ["contracting.certificate.approve", VIEW]);

function seedActor(userId: string, permissions: readonly string[]) {
  return () => seedActorHeaders(userId, permissions, null);
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

interface SubcontractLineRow {
  id: string;
  code: string;
}

/** BOQ line id by its bill item number, so the seed never hardcodes an id the server generated. */
async function boqLineIds(app: App): Promise<Map<string, string>> {
  const res = (await step(app, "GET", `/contracting/contracts/${TOWER_CONTRACT}/boq`)) as {
    lines: BoqLineRow[];
  };
  return new Map(res.lines.map((l) => [l.code, l.id]));
}

async function subcontractLineIds(app: App, subcontractId: string): Promise<Map<string, string>> {
  const res = (await step(app, "GET", `/contracting/subcontracts/${subcontractId}`)) as {
    lines: SubcontractLineRow[];
  };
  return new Map(res.lines.map((l) => [l.code, l.id]));
}

export async function seedContractingSubcontracts(app: App): Promise<void> {
  /**
   * A subcontractor cannot be certified for payment without a tax number and a
   * bank account: the withheld tax is remitted under its own name, and the net
   * leaves through a transfer. Seeding them here — rather than on the core
   * supplier fixture — keeps the gate visible as something a subcontractor
   * needs and a stock supplier does not.
   */
  await step(app, "PATCH", `/suppliers/${SUBCONTRACTOR}`, {
    taxNumber: "512-874-903",
    bankAccount: "EG380019000500000000263180002",
  });

  const boq = await boqLineIds(app);
  const clientLine = (code: string): string => {
    const id = boq.get(code);
    if (!id) throw new Error(`[demo-seed] subcontracts: BOQ line "${code}" is missing from ${TOWER_CONTRACT}`);
    return id;
  };

  // The back-to-back package: the excavation and the plain concrete, let at a
  // rate under the client's own on both lines, so the margin column reads
  // positive and the «مقارنة بالعميل» grid has something to compare.
  await step(app, "POST", "/contracting/subcontracts", {
    id: EXCAVATION,
    contractId: TOWER_CONTRACT,
    supplierId: SUBCONTRACTOR,
    titleAr: "عقد باطن — أعمال الحفر والخرسانة العادية",
    kind: "works",
    signedDate: "2026-03-20",
    startDate: "2026-04-01",
    plannedEndDate: "2026-12-31",
    notes: "عقد باطن ظهير لبندي الحفر والخرسانة العادية بعقد برج الأمل.",
    retentionPercent: "5",
    advancePercent: "10",
    advanceRecoveryPercent: "10",
    withholdingTaxPercent: "1",
    withholdSocialInsurance: false,
    paymentTermDays: 30,
    defectsLiabilityMonths: 12,
    lines: [
      { clientBoqLineId: clientLine("1"), qty: "12000", unitRate: "140.00", estimatedUnitCost: "118" },
      { clientBoqLineId: clientLine("2"), qty: "1450", unitRate: "1650.00", estimatedUnitCost: "1290" },
    ],
  });
  await step(app, "POST", `/contracting/subcontracts/${EXCAVATION}/activate`, { activatedAt: "2026-04-01" });

  /**
   * الدفعة المقدمة. It is paid OUT as an asset (سلف الموردين 1350), not as a
   * settlement of a payable: the money is owed back and every certificate
   * recovers a slice of it. The route below only LINKS the confirmed voucher —
   * the recovery ceiling on every later certificate is read off it.
   */
  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-SUB-ADV",
    date: "2026-04-05",
    memo: "دفعة مقدمة لمقاول باطن الحفر — تُسترد من مستخلصاته",
    voucherType: "other_expense",
    amount: "150000.00",
    branchId: BRANCH_ID,
    paymentMethod: "bank",
    treasuryAccountId: BANK_TREASURY_ID,
    treasuryGlAccountId: BANK_GL,
    counterpartyGlAccountId: SUPPLIER_ADVANCES_GL,
    supplierId: SUBCONTRACTOR,
    projectId: "PRJ-DEMO-1",
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-SUB-ADV/confirm", {});
  await step(app, "POST", `/contracting/subcontracts/${EXCAVATION}/advance`, {
    voucherId: "VCH-DEMO-SUB-ADV",
  });

  const subLine = await subcontractLineIds(app, EXCAVATION);
  const line = (code: string): string => {
    const id = subLine.get(code);
    if (!id) throw new Error(`[demo-seed] subcontracts: subcontract line "${code}" is missing from ${EXCAVATION}`);
    return id;
  };

  /**
   * Two approved certificates and one still in the site engineer's hands. Every
   * cumulative quantity stays UNDER what the consultant certified to the
   * employer on the same BOQ line — which is the control this slice exists for,
   * and which the server re-checks at each of the three steps.
   */
  const certificates = [
    {
      id: "SMST-DEMO-1",
      periodFrom: "2026-05-01",
      periodTo: "2026-05-31",
      executionDate: "2026-05-31",
      workLines: [
        { code: "1", qty: "1500" },
        { code: "2", qty: "20" },
      ],
      approvedAt: "2026-06-10",
    },
    {
      id: "SMST-DEMO-2",
      periodFrom: "2026-06-01",
      periodTo: "2026-06-30",
      executionDate: "2026-06-30",
      workLines: [
        { code: "1", qty: "1300" },
        { code: "2", qty: "60" },
      ],
      approvedAt: "2026-07-10",
    },
  ] as const;

  for (const spec of certificates) {
    await stepAs(app, SITE_ENGINEER(), "POST", "/contracting/subcontract-certificates", {
      id: spec.id,
      subcontractId: EXCAVATION,
      periodFrom: spec.periodFrom,
      periodTo: spec.periodTo,
      executionDate: spec.executionDate,
      workLines: spec.workLines.map((w) => ({ subcontractLineId: line(w.code), thisPeriodQty: w.qty })),
    });
    await stepAs(app, SITE_ENGINEER(), "POST", `/contracting/subcontract-certificates/${spec.id}/measure`);
    await stepAs(app, TECHNICAL_OFFICE(), "POST", `/contracting/subcontract-certificates/${spec.id}/certify`);
    await stepAs(app, FINANCE(), "POST", `/contracting/subcontract-certificates/${spec.id}/approve`, {
      approvedAt: spec.approvedAt,
    });
  }

  /**
   * «مواد مصروفة للمقاول» — material the contractor issued to this
   * subcontractor out of the site store. The certificate's deduction is
   * PREFILLED from these confirmed consumptions rather than typed: a value the
   * quantity surveyor invents is the one the subcontractor disputes.
   */
  await step(app, "POST", "/contracting/site/consumptions", {
    id: "CON-DEMO-SUB-1",
    date: "2026-08-27",
    warehouseId: "WH-SITE-TOWER",
    subcontractId: EXCAVATION,
    notes: "مواد مصروفة لمقاول باطن الحفر — تُخصم من مستخلصه",
    lines: [{ itemId: CORE.items[2], qty: "8" }],
  });
  await step(app, "POST", "/contracting/site/consumptions/CON-DEMO-SUB-1/confirm", {});

  await stepAs(app, SITE_ENGINEER(), "POST", "/contracting/subcontract-certificates", {
    id: "SMST-DEMO-3",
    subcontractId: EXCAVATION,
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    executionDate: "2026-08-31",
    workLines: [
      { subcontractLineId: line("1"), thisPeriodQty: "900" },
      { subcontractLineId: line("2"), thisPeriodQty: "40" },
    ],
    notes: "مسودة — في انتظار حصر أعمال أغسطس.",
  });

  // The prefill is the SERVER's figure, read back off the preview and applied
  // to the draft; the screen shows it the same way and the user may override it.
  const preview = (await stepAs(app, SITE_ENGINEER(), "POST", "/contracting/subcontract-certificates/preview", {
    subcontractId: EXCAVATION,
    certificateId: "SMST-DEMO-3",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
  })) as { employerMaterialsPrefill: string };
  await stepAs(app, SITE_ENGINEER(), "PATCH", "/contracting/subcontract-certificates/SMST-DEMO-3", {
    employerMaterialsCumulative: preview.employerMaterialsPrefill,
  });

  /**
   * عمالة بالمقاولة. The ETA/NOSI distinction is RECORDED rather than implied
   * (design §09): a labour-only package that nobody reviewed is the one that is
   * reassessed as employment, and the server refuses to activate it until the
   * review is declared.
   */
  await step(app, "POST", "/contracting/subcontracts", {
    id: PLASTERING,
    contractId: TOWER_CONTRACT,
    supplierId: SUBCONTRACTOR,
    titleAr: "عقد عمالة بالمقاولة — أعمال البياض",
    kind: "labour_only",
    disguisedEmploymentReviewed: true,
    reviewNote:
      "روجعت العلاقة مع المقاول: يورّد عمالته وأدواته ويعمل بإشرافه، ولا تنطبق عليه أحكام عقد العمل (قرار المراجعة رقم ١٧ بتاريخ ٢٠٢٦/٠٣/٢٥).",
    signedDate: "2026-03-25",
    startDate: "2026-05-01",
    plannedEndDate: "2027-01-31",
    retentionPercent: "5",
    advancePercent: "0",
    advanceRecoveryPercent: "0",
    withholdingTaxPercent: "1",
    withholdSocialInsurance: true,
    deemedWagePercent: "100",
    socialInsuranceRatePercent: "18.75",
    socialInsuranceNote: "عمالة بالمقاولة — الأجر الافتراضي كامل قيمة الأعمال.",
    paymentTermDays: 30,
    defectsLiabilityMonths: 6,
    lines: [{ clientBoqLineId: clientLine("5"), qty: "6000", unitRate: "38.00", estimatedUnitCost: "31" }],
  });
  await step(app, "POST", `/contracting/subcontracts/${PLASTERING}/activate`, { activatedAt: "2026-05-01" });
}
