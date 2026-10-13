import type { App } from "@mezan/api";
import { step, BRANCH_ID, WAREHOUSE_ID, CORE } from "./shared.js";

/**
 * Leads. Each entry's `transitions` are applied in order through
 * `/crm/leads/:id/transition` before any `convert` call — the lead state
 * machine only allows qualified → converted, so a lead destined for
 * conversion must pass through contacted → qualified first.
 */
const LEADS = [
  {
    id: "LEAD-DEMO-1",
    name: "محمد سامي",
    company: "مصنع الأمل للأثاث",
    email: "m.sami@amal-furniture.example.com",
    phone: "01011122233",
    source: "website",
    expectedValue: "45000",
    interest: "خطوط إنتاج أثاث مكتبي",
    notes: "طلب عرض سعر أولي عبر الموقع الإلكتروني.",
    transitions: [] as const,
    convert: null,
  },
  {
    id: "LEAD-DEMO-2",
    name: "هالة عبد الرحمن",
    company: "شركة النيل للمقاولات",
    email: "hala.abdelrahman@nile-contracting.example.com",
    phone: "01122334455",
    source: "referral",
    expectedValue: "150000",
    interest: "توريد مواد بناء لموقع جديد",
    notes: "إحالة من عميل حالي، تم التواصل الأول.",
    transitions: ["contacted"] as const,
    convert: null,
  },
  {
    id: "LEAD-DEMO-3",
    name: "أحمد جلال",
    company: "مؤسسة الدلتا للتوريدات",
    email: "ahmed.galal@delta-supplies.example.com",
    phone: "01233445566",
    source: "phone",
    expectedValue: "85000",
    interest: "عقد توريد سنوي",
    notes: "تم التأكد من الميزانية والاحتياج، مؤهل للمتابعة.",
    transitions: ["contacted", "qualified"] as const,
    convert: null,
  },
  {
    id: "LEAD-DEMO-4",
    name: "منى إبراهيم",
    company: "شركة الواحة للصناعات الغذائية",
    email: "mona.ibrahim@waha-food.example.com",
    phone: "01344556677",
    source: "social",
    expectedValue: "60000",
    interest: "توريد مكونات غذائية بالجملة",
    notes: "مؤهل بالكامل، تم تحويله إلى عميل وفرصة بيع.",
    transitions: ["contacted", "qualified"] as const,
    convert: {
      customerId: "CUST-DEMO-LEAD4",
      customerCode: "C-0004",
      opportunityId: "OPP-DEMO-7",
      opportunityTitle: "تعاقد توريد مكونات غذائية - الواحة",
      opportunityBranchId: "BR-MAIN",
      stageId: "STAGE-QUOTE",
      expectedValue: "60000",
      probability: 40,
      expectedCloseDate: "2026-09-25",
    },
  },
  {
    id: "LEAD-DEMO-5",
    name: "كريم لطفي",
    company: null,
    email: null,
    phone: "01455667788",
    source: "other",
    expectedValue: null,
    interest: "استفسار عام",
    notes: "لا توجد ميزانية أو احتياج واضح لمتابعته.",
    transitions: ["unqualified"] as const,
    convert: null,
  },
  {
    id: "LEAD-DEMO-6",
    name: "سارة يوسف",
    company: "مجموعة سيناء للاستيراد",
    email: "sara.youssef@sinai-import.example.com",
    phone: "01566778899",
    source: "phone",
    expectedValue: "30000",
    interest: "استيراد مواد خام",
    notes: "توقف التواصل بعد عرض السعر الأول، اختار العميل مورداً آخر.",
    transitions: ["contacted", "lost"] as const,
    convert: null,
  },
] as const;

/**
 * Opportunities against real customers and real pipeline stages. `finalStageId`,
 * when set, is applied through `/crm/opportunities/:id/move-stage` AFTER
 * creation — `createOpportunity` always starts a deal `open` regardless of the
 * stage it's created in, only `moveOpportunityStage` flips `status` to
 * won/lost when the destination stage carries that flag.
 */
const OPPORTUNITIES = [
  {
    id: "OPP-DEMO-1",
    title: "توريد أرز وسكر بالجملة",
    customerId: CORE.customers[0],
    branchId: "BR-MAIN",
    stageId: "STAGE-LEAD",
    expectedValue: "60000",
    probability: 10,
    expectedCloseDate: "2026-10-15",
    notes: "فرصة أولية بانتظار أول تواصل.",
    finalStageId: null,
  },
  {
    id: "OPP-DEMO-2",
    title: "عقد توريد مواد بناء لموقع جديد",
    customerId: CORE.customers[1],
    branchId: "BR-MAIN",
    stageId: "STAGE-CONTACTED",
    expectedValue: "150000",
    probability: 20,
    expectedCloseDate: "2026-10-01",
    notes: "تم التواصل الأول، بانتظار طلب عرض سعر رسمي.",
    finalStageId: null,
  },
  {
    id: "OPP-DEMO-3",
    title: "عرض سعر توريد شاي وأرز",
    customerId: CORE.customers[2],
    branchId: "BR-MAIN",
    stageId: "STAGE-QUOTE",
    expectedValue: "85000",
    probability: 40,
    expectedCloseDate: "2026-09-20",
    notes: "تم إرسال عرض سعر مفصل للعميل.",
    finalStageId: null,
  },
  {
    id: "OPP-DEMO-4",
    title: "توسعة تعاقد سنوي",
    customerId: CORE.customers[0],
    branchId: "BR-MAIN",
    stageId: "STAGE-NEGOTIATION",
    expectedValue: "220000",
    probability: 60,
    expectedCloseDate: "2026-09-10",
    notes: "مفاوضات جارية على شروط الدفع والتسليم.",
    finalStageId: null,
  },
  {
    id: "OPP-DEMO-5",
    title: "تجديد تعاقد التوريد السنوي",
    customerId: CORE.customers[1],
    branchId: "BR-MAIN",
    stageId: "STAGE-FINAL-REVIEW",
    expectedValue: "95000",
    probability: 80,
    expectedCloseDate: "2026-08-30",
    notes: "وافق العميل على كل الشروط ووقّع العقد.",
    finalStageId: "STAGE-WON",
  },
  {
    id: "OPP-DEMO-6",
    title: "توريد مواد تعبئة وتغليف",
    customerId: CORE.customers[2],
    branchId: "BR-MAIN",
    stageId: "STAGE-NEGOTIATION",
    expectedValue: "40000",
    probability: 60,
    expectedCloseDate: "2026-08-15",
    notes: "اختار العميل مورداً آخر بسعر أقل.",
    finalStageId: "STAGE-LOST",
  },
] as const;

/**
 * Activities across leads and opportunities created above, mixing types and
 * end states through `/crm/activities/:id/complete` and `/cancel`.
 */
const ACTIVITIES = [
  {
    id: "ACT-DEMO-1",
    subject: "مكالمة متابعة أولى",
    type: "call",
    relatedLeadId: "LEAD-DEMO-1",
    relatedOpportunityId: null,
    dueDate: "2026-08-28",
    notes: "تأكيد الاهتمام وتحديد ميعاد عرض المنتج.",
    outcome: null,
  },
  {
    id: "ACT-DEMO-2",
    subject: "اجتماع عرض المنتج",
    type: "meeting",
    relatedLeadId: null,
    relatedOpportunityId: "OPP-DEMO-3",
    dueDate: "2026-09-02",
    notes: "عرض تفصيلي في مقر العميل مع فريق المشتريات.",
    outcome: null,
  },
  {
    id: "ACT-DEMO-3",
    subject: "مكالمة تأهيل العميل",
    type: "call",
    relatedLeadId: "LEAD-DEMO-3",
    relatedOpportunityId: null,
    dueDate: "2026-08-12",
    notes: "تم التأكد من الميزانية والاحتياج الفعلي.",
    outcome: "complete",
  },
  {
    id: "ACT-DEMO-4",
    subject: "متابعة إرسال العقد",
    type: "todo",
    relatedLeadId: null,
    relatedOpportunityId: "OPP-DEMO-1",
    dueDate: "2026-09-10",
    notes: "إرسال مسودة العقد للمراجعة القانونية.",
    outcome: null,
  },
  {
    id: "ACT-DEMO-5",
    subject: "إرسال عرض سعر بالبريد الإلكتروني",
    type: "email",
    relatedLeadId: "LEAD-DEMO-2",
    relatedOpportunityId: null,
    dueDate: "2026-08-14",
    notes: "تم إرسال عرض السعر والملحقات الفنية.",
    outcome: "complete",
  },
  {
    id: "ACT-DEMO-6",
    subject: "اجتماع توقيع نهائي",
    type: "meeting",
    relatedLeadId: null,
    relatedOpportunityId: "OPP-DEMO-5",
    dueDate: "2026-08-29",
    notes: "أُلغي الاجتماع بعد توقيع العقد عن بُعد.",
    outcome: "cancel",
  },
] as const;

/**
 * Projects always start `planned`; `statusPath` walks the real lifecycle
 * afterwards via PATCH. It is a PATH, not a destination: مخطط → مكتمل is not a
 * legal move, so a completed project is seeded the way a real one gets there.
 */
const PROJECTS = [
  {
    id: "PRJ-DEMO-1",
    code: "TOWER-A",
    nameAr: "برج الأمل السكني",
    nameEn: "Al Amal Residential Tower",
    customerId: CORE.customers[1],
    managerId: CORE.employees[0],
    startDate: "2026-03-01",
    endDate: "2027-02-28",
    budget: "1200000",
    siteAddress: "القاهرة الجديدة، التجمع الخامس",
    notes: "مشروع إنشاء برج سكني بالكامل.",
    statusPath: ["active"],
  },
  {
    id: "PRJ-DEMO-2",
    code: "WH-EXP",
    nameAr: "توسعة مستودع الوادي الأخضر",
    nameEn: "Green Valley Warehouse Expansion",
    customerId: null,
    managerId: CORE.employees[1],
    startDate: "2026-09-01",
    endDate: "2027-01-31",
    budget: "350000",
    siteAddress: "المنطقة الصناعية، العاشر من رمضان",
    notes: "توسعة مساحة التخزين للمخزن الرئيسي.",
    statusPath: [],
  },
  {
    id: "PRJ-DEMO-3",
    code: "FITOUT-BR2",
    nameAr: "تجهيز فرع جديد",
    nameEn: "New Branch Fit-Out",
    customerId: CORE.customers[2],
    managerId: CORE.employees[0],
    startDate: "2026-04-01",
    endDate: "2026-07-15",
    budget: "180000",
    siteAddress: "الإسكندرية، سموحة",
    notes: "تم تسليم الفرع وتشغيله بالكامل.",
    statusPath: ["active", "completed"],
  },
  {
    id: "PRJ-DEMO-4",
    code: "MAINT-Q3",
    nameAr: "صيانة دورية للمعدات",
    nameEn: "Q3 Equipment Maintenance",
    customerId: CORE.customers[0],
    managerId: CORE.employees[1],
    startDate: "2026-07-01",
    endDate: null,
    budget: "60000",
    siteAddress: null,
    notes: "متوقف بانتظار توريد قطع غيار.",
    statusPath: ["active", "on_hold"],
  },
  {
    id: "PRJ-DEMO-5",
    code: "OLD-SITE",
    nameAr: "مشروع موقع قديم",
    nameEn: "Legacy Site Project",
    customerId: CORE.customers[1],
    managerId: null,
    startDate: "2025-11-01",
    endDate: "2026-01-15",
    budget: "20000",
    siteAddress: null,
    notes: "تم إلغاء المشروع بعد تغيير أولويات العميل.",
    statusPath: ["active", "cancelled"],
  },
  /**
   * العقد الخاسر. Every other project here makes money, so «عقد خاسر — مخصّص
   * واجب» — the EAS 48 provision that recognises the WHOLE foreseen loss in
   * the month it is foreseen — was a flag nothing in the demo could raise.
   */
  {
    id: "PRJ-DEMO-9",
    code: "VILLAS-SZ",
    nameAr: "تشطيبات فيلات — الشيخ زايد",
    nameEn: "Sheikh Zayed Villas Fit-Out",
    customerId: CORE.customers[2],
    managerId: CORE.employees[0],
    startDate: "2026-05-01",
    endDate: "2027-04-30",
    budget: "4600000",
    siteAddress: "الشيخ زايد، الحي السادس عشر",
    notes: "سُعِّر العقد قبل موجة أسعار مواد التشطيب؛ التكلفة المقدرة تجاوزت قيمة العقد.",
    statusPath: ["active"],
  },
] as const;

/**
 * Asset categories. GL account ids match the system-default fixed-assets
 * accounts seeded by the core chart of accounts (docs/archive/catalog/07
 * "تصنيفات الأصول": 1500/1510/1520 assets, 5400 depreciation expense, 1590
 * accumulated depreciation, 4500/5450 gain/loss on disposal).
 */
const ASSET_CATEGORIES = [
  {
    id: "ASSET-CAT-DEMO-1",
    code: "FA-01",
    nameAr: "معدات وآلات",
    nameEn: "Equipment & Machinery",
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 10,
    assetAccountId: "1510",
    depreciationExpenseAccountId: "5400",
    accumulatedDepreciationAccountId: "1590",
    gainOnDisposalAccountId: "4500",
    lossOnDisposalAccountId: "5450",
  },
  {
    id: "ASSET-CAT-DEMO-2",
    code: "FA-02",
    nameAr: "مركبات",
    nameEn: "Vehicles",
    defaultUsefulLifeMonths: 96,
    defaultSalvagePercent: 15,
    assetAccountId: "1520",
    depreciationExpenseAccountId: "5400",
    accumulatedDepreciationAccountId: "1590",
    gainOnDisposalAccountId: "4500",
    lossOnDisposalAccountId: "5450",
  },
  {
    id: "ASSET-CAT-DEMO-3",
    code: "FA-03",
    nameAr: "أجهزة حاسب ومعدات مكتبية",
    nameEn: "Computers & Office Equipment",
    defaultUsefulLifeMonths: 36,
    defaultSalvagePercent: 5,
    assetAccountId: "1510",
    depreciationExpenseAccountId: "5400",
    accumulatedDepreciationAccountId: "1590",
    gainOnDisposalAccountId: "4500",
    lossOnDisposalAccountId: "5450",
  },
] as const;

/**
 * Assets spread across all three categories with varied acquisition dates,
 * so their computed depreciation schedules differ. `salvageValue` is left
 * unset on some to exercise the category-default derivation in `createAsset`.
 */
const ASSETS = [
  {
    id: "ASSET-DEMO-1",
    code: "AST-0001",
    nameAr: "رافعة شوكية كهربائية",
    nameEn: "Electric Forklift",
    categoryId: "ASSET-CAT-DEMO-1",
    scope: "warehouse",
    branchId: null,
    warehouseId: WAREHOUSE_ID,
    acquisitionDate: "2024-03-15",
    acquisitionCost: "180000",
    salvageValue: null,
  },
  {
    id: "ASSET-DEMO-2",
    code: "AST-0002",
    nameAr: "سيارة نقل بضائع",
    nameEn: "Delivery Truck",
    categoryId: "ASSET-CAT-DEMO-2",
    scope: "branch",
    branchId: BRANCH_ID,
    warehouseId: null,
    acquisitionDate: "2023-06-01",
    acquisitionCost: "650000",
    salvageValue: "90000",
  },
  {
    id: "ASSET-DEMO-3",
    code: "AST-0003",
    nameAr: "سيارة توزيع صغيرة",
    nameEn: "Small Distribution Van",
    categoryId: "ASSET-CAT-DEMO-2",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2025-01-10",
    acquisitionCost: "420000",
    salvageValue: null,
  },
  {
    id: "ASSET-DEMO-4",
    code: "AST-0004",
    nameAr: "أجهزة حاسب آلي للمكاتب",
    nameEn: "Office Computers",
    categoryId: "ASSET-CAT-DEMO-3",
    scope: "branch",
    branchId: BRANCH_ID,
    warehouseId: null,
    acquisitionDate: "2025-09-01",
    acquisitionCost: "95000",
    salvageValue: null,
  },
  {
    id: "ASSET-DEMO-5",
    code: "AST-0005",
    nameAr: "طابعات ومعدات مكتبية",
    nameEn: "Printers & Office Gear",
    categoryId: "ASSET-CAT-DEMO-3",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2022-05-20",
    acquisitionCost: "36000",
    salvageValue: null,
  },
  {
    id: "ASSET-DEMO-6",
    code: "AST-0006",
    nameAr: "معدات تعبئة وتغليف",
    nameEn: "Packaging Equipment",
    categoryId: "ASSET-CAT-DEMO-1",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2026-02-01",
    acquisitionCost: "250000",
    salvageValue: "25000",
  },
] as const;

/** Seed profile module — see `./shared.ts`. Local and test environments only. */


export async function seedCrm(app: App): Promise<void> {
  for (const lead of LEADS) {
    await step(app, "POST", "/crm/leads", {
      id: lead.id,
      name: lead.name,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      expectedValue: lead.expectedValue,
      interest: lead.interest,
      notes: lead.notes,
    });
    for (const status of lead.transitions) {
      await step(app, "POST", `/crm/leads/${lead.id}/transition`, { status });
    }
    if (lead.convert) {
      await step(app, "POST", `/crm/leads/${lead.id}/convert`, {
        createCustomer: true,
        customer: { id: lead.convert.customerId, code: lead.convert.customerCode },
        createOpportunity: true,
        opportunity: {
          id: lead.convert.opportunityId,
          title: lead.convert.opportunityTitle,
          branchId: lead.convert.opportunityBranchId,
          stageId: lead.convert.stageId,
          expectedValue: lead.convert.expectedValue,
          probability: lead.convert.probability,
          expectedCloseDate: lead.convert.expectedCloseDate,
        },
      });
    }
  }

  for (const opportunity of OPPORTUNITIES) {
    await step(app, "POST", "/crm/opportunities", {
      id: opportunity.id,
      title: opportunity.title,
      customerId: opportunity.customerId,
      branchId: opportunity.branchId,
      stageId: opportunity.stageId,
      expectedValue: opportunity.expectedValue,
      probability: opportunity.probability,
      expectedCloseDate: opportunity.expectedCloseDate,
      notes: opportunity.notes,
    });
    if (opportunity.finalStageId) {
      await step(app, "POST", `/crm/opportunities/${opportunity.id}/move-stage`, { stageId: opportunity.finalStageId });
    }
  }

  for (const activity of ACTIVITIES) {
    await step(app, "POST", "/crm/activities", {
      id: activity.id,
      subject: activity.subject,
      type: activity.type,
      relatedLeadId: activity.relatedLeadId,
      relatedOpportunityId: activity.relatedOpportunityId,
      dueDate: activity.dueDate,
      notes: activity.notes,
    });
    if (activity.outcome === "complete") {
      await step(app, "POST", `/crm/activities/${activity.id}/complete`, {});
    } else if (activity.outcome === "cancel") {
      await step(app, "POST", `/crm/activities/${activity.id}/cancel`, {});
    }
  }

  for (const project of PROJECTS) {
    await step(app, "POST", "/projects", {
      id: project.id,
      code: project.code,
      nameAr: project.nameAr,
      nameEn: project.nameEn,
      customerId: project.customerId,
      managerId: project.managerId,
      startDate: project.startDate,
      endDate: project.endDate,
      budget: project.budget,
      siteAddress: project.siteAddress,
      notes: project.notes,
    });
    for (const status of project.statusPath) {
      await step(app, "PATCH", `/projects/${project.id}`, { status });
    }
  }

  for (const category of ASSET_CATEGORIES) {
    await step(app, "POST", "/assets/categories", {
      id: category.id,
      code: category.code,
      nameAr: category.nameAr,
      nameEn: category.nameEn,
      defaultUsefulLifeMonths: category.defaultUsefulLifeMonths,
      defaultSalvagePercent: category.defaultSalvagePercent,
      assetAccountId: category.assetAccountId,
      depreciationExpenseAccountId: category.depreciationExpenseAccountId,
      accumulatedDepreciationAccountId: category.accumulatedDepreciationAccountId,
      gainOnDisposalAccountId: category.gainOnDisposalAccountId,
      lossOnDisposalAccountId: category.lossOnDisposalAccountId,
    });
  }

  for (const asset of ASSETS) {
    await step(app, "POST", "/assets", {
      id: asset.id,
      code: asset.code,
      nameAr: asset.nameAr,
      nameEn: asset.nameEn,
      categoryId: asset.categoryId,
      scope: asset.scope,
      branchId: asset.branchId,
      warehouseId: asset.warehouseId,
      acquisitionDate: asset.acquisitionDate,
      acquisitionCost: asset.acquisitionCost,
      salvageValue: asset.salvageValue ?? undefined,
    });
  }

  const mayRun = (await step(app, "POST", "/assets/depreciation/runs", { period: "2026-05" })) as { id: string };
  await step(app, "POST", `/assets/depreciation/runs/${mayRun.id}/post`, {});
}
