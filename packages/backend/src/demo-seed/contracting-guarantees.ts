import type { App } from "@mezan/api";
import { step } from "./shared.js";

/**
 * خطابات الضمان — the register the design's §05 mock shows: four live letters
 * against one bank facility, their face values off balance sheet in the 9100 /
 * 9200 memorandum pair and their cash margins on it in 1340 restricted cash.
 *
 * Every letter enters through the SAME routes a user's clicks hit and is
 * ISSUED through `/issue`, so the outstanding figure on the screen is the
 * balance of a posted memorandum account and not a number written here.
 */

const TOWER = "PRJ-DEMO-1";
const FITOUT = "PRJ-DEMO-3";
const BANK_TREASURY_ID = "TR-DEMO-BANK";
const EMPLOYER = "الهيئة الهندسية للقوات المسلحة";

export async function seedContractingGuarantees(app: App): Promise<void> {
  // The facility limit is what turns a register into a ceiling report.
  await step(app, "PATCH", `/treasury-accounts/${BANK_TREASURY_ID}`, {
    guaranteeFacilityLimit: "10000000",
  });

  await step(app, "POST", "/contracting/guarantees", {
    id: "LG-DEMO-1",
    kind: "performance",
    projectId: TOWER,
    beneficiaryNameAr: EMPLOYER,
    bankTreasuryAccountId: BANK_TREASURY_ID,
    faceValue: "1247000",
    percentOfContract: "5",
    cashMarginPercent: "20",
    cashMarginAmount: "249400",
    issueDate: "2026-03-14",
    expiryDate: "2027-03-14",
    notes: "خطاب حسن تنفيذ 5% من قيمة عقد برج الأمل",
  });
  await step(app, "POST", "/contracting/guarantees/LG-DEMO-1/issue", {});

  await step(app, "POST", "/contracting/guarantees", {
    id: "LG-DEMO-2",
    kind: "advance",
    projectId: TOWER,
    beneficiaryNameAr: EMPLOYER,
    bankTreasuryAccountId: BANK_TREASURY_ID,
    faceValue: "970304",
    cashMarginPercent: "20",
    cashMarginAmount: "194061",
    issueDate: "2026-04-02",
    expiryDate: "2026-11-30",
    notes: "خطاب دفعة مقدمة يتناقص مع الاسترداد من المستخلصات",
  });
  await step(app, "POST", "/contracting/guarantees/LG-DEMO-2/issue", {});
  await step(app, "POST", "/contracting/guarantees/LG-DEMO-2/reduce", {
    date: "2026-08-06",
    amount: "60000",
    reason: "استرداد من المستخلص",
  });

  await step(app, "POST", "/contracting/guarantees", {
    id: "LG-DEMO-3",
    kind: "bid",
    tenderRef: "TND-021",
    beneficiaryNameAr: "الشركة القابضة لمياه الشرب والصرف الصحي",
    bankTreasuryAccountId: BANK_TREASURY_ID,
    faceValue: "184500",
    percentOfContract: "1.5",
    cashMarginPercent: "20",
    cashMarginAmount: "36900",
    issueDate: "2026-06-25",
    expiryDate: "2026-09-25",
    notes: "خطاب ابتدائي على مناقصة لم تُرسَ بعد",
  });
  await step(app, "POST", "/contracting/guarantees/LG-DEMO-3/issue", {});

  await step(app, "POST", "/contracting/guarantees", {
    id: "LG-DEMO-4",
    kind: "maintenance",
    projectId: FITOUT,
    beneficiaryNameAr: "شركة القاهرة للاستثمار العقاري",
    bankTreasuryAccountId: BANK_TREASURY_ID,
    faceValue: "412000",
    cashMarginPercent: "20",
    cashMarginAmount: "82400",
    issueDate: "2026-04-05",
    expiryDate: "2026-10-05",
    notes: "خطاب صيانة لمدة سنة بعد الاستلام الابتدائي",
  });
  await step(app, "POST", "/contracting/guarantees/LG-DEMO-4/issue", {});
}
