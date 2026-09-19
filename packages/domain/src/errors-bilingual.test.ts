import { describe, expect, it } from "vitest";

import { DuplicateAccountCodeError, AccountNotFoundError, InvalidParentAccountError, HeaderAccountNotPostableError, CircularParentAccountError, HeaderAccountHasChildrenError } from "./accounts/errors.js";
import {
  BankStatementNotFoundError,
  StatementLineNotFoundError,
  LineAlreadyMatchedError,
  LineNotMatchedError,
  InvalidStatementFileError,
  ColumnNotFoundError,
  InvalidColumnMappingError,
  StatementHasUnmatchedLinesError,
  FinalizeOverrideReasonRequiredError,
} from "./bank-reconciliation/errors.js";
import { ChequeNotFoundError, DuplicateChequeNumberError, InvalidChequeTransitionError, InvalidChequeCommandError, ReplacementAmountMismatchError } from "./cheques/errors.js";
import { DuplicateCostCenterCodeError, CostCenterNotFoundError, InvalidParentCostCenterError, CircularParentCostCenterError } from "./cost-centers/errors.js";
import { DuplicateDocumentError, MissingHookError } from "./documents/errors.js";
import { FollowUpNotFoundError } from "./installments/errors.js";
import { EmptyLandedCostTargetsError, ZeroLandedCostWeightError } from "./landed-costs/errors.js";
import { DuplicateTaxCodeError, TaxRateNotFoundError, InvalidTaxRateError, TaxGroupNotFoundError } from "./tax-rates/errors.js";
import { DuplicateTreasuryAccountCodeError, TreasuryAccountNotFoundError, NegativeCashBalanceError } from "./treasury-accounts/errors.js";

import {
  LeadNotFoundError,
  LeadNotConvertibleError,
  DuplicatePipelineStageWinError,
  PipelineStageNotFoundError,
  OpportunityNotFoundError,
  ActivityNotFoundError,
  ActivityNotPendingError,
} from "./crm/errors.js";
import { VanTripNotFoundError, VanTripNotOngoingError, SameWarehouseVanTripError } from "./field-sales/errors.js";
import {
  ItemNotFoundError,
  InvalidItemError,
  DuplicateItemUnitCodeError,
  ItemUnitNotFoundError,
  InvalidItemUnitError,
  ItemUnitInUseError,
  DuplicateItemCategoryCodeError,
  ItemCategoryNotFoundError,
  InvalidItemCategoryError,
  ItemCategoryInUseError,
  DuplicateItemSpecificationCodeError,
  ItemSpecificationNotFoundError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
} from "./items/errors.js";
import {
  DuplicateItemUnitCodeError as CatalogDuplicateItemUnitCodeError,
  ItemUnitNotFoundError as CatalogItemUnitNotFoundError,
  DuplicateItemCategoryError as CatalogDuplicateItemCategoryError,
  ItemCategoryNotFoundError as CatalogItemCategoryNotFoundError,
  InvalidItemCategoryError as CatalogInvalidItemCategoryError,
} from "./items/item-catalog.js";
import { InvalidPromotionError, PromotionNotFoundError, DuplicatePromotionError, CouponRequiredError } from "./promotions/errors.js";
import { InvalidSalesInvoiceError, SalesInvoiceNotFoundError, DuplicateSalesInvoiceError } from "./sales-invoices/errors.js";
import { InvalidSalesQuoteError, SalesQuoteNotFoundError, DuplicateSalesQuoteError } from "./sales-quotes/errors.js";

import { AttachmentNotFoundError, DuplicateAttachmentIdError, InvalidAttachmentError } from "./attachments/errors.js";
import {
  EtaSubmissionNotFoundError,
  DuplicateEtaSubmissionError,
  InvalidEtaTransitionError,
  EtaOfflineError,
  EtaExclusionReasonRequiredError,
} from "./eta/errors.js";
import {
  DepartmentNotFoundError,
  JobTitleNotFoundError,
  EmployeeNotFoundError,
  UserNotLinkedToEmployeeError,
  ContractNotFoundError,
  ContractNotActiveError,
  HolidayNotFoundError,
  LeaveRequestNotFoundError,
  AttendanceEntryNotFoundError,
  DuplicateAttendanceEntryError,
  LeavePolicyNotFoundError,
  DuplicateLeavePolicyError,
  UnknownLeavePolicyPresetError,
  LeaveBalanceNotFoundError,
  EmployeeAdvanceNotFoundError,
  PayrollRunNotFoundError,
  DuplicatePayrollPeriodError,
  NoPayableEmployeesError,
  NegativeNetPayError,
  TreasuryDisbursementUnavailableError,
} from "./hr/errors.js";
import {
  BomNotFoundError,
  WorkOrderNotFoundError,
  ConfigurableProductNotFoundError,
  ConfigInstanceNotFoundError,
  DuplicateManufacturingDocumentError,
  InvalidManufacturingDocumentError,
  WorkOrderStageError,
  FormulaError,
} from "./manufacturing/errors.js";
import { InvalidNotificationRuleError, NotificationRuleNotFoundError, NotificationNotFoundError } from "./notifications/errors.js";
import { InvalidTenantError, InvalidPlanError, InvalidSubscriptionError, InvalidPaymentError, InvalidPlatformUserError } from "./platform/errors.js";
import { DuplicateProjectCodeError, ProjectNotFoundError } from "./projects/errors.js";

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

/** guards D280 — every converted domain refusal reaches the Arabic UI in Arabic, with the English kept beside it. */
describe("domain errors are bilingual (D280)", () => {
  const cases: readonly [string, Error & { code: string; messageEn?: string }][] = [
    // accounts
    ["DuplicateAccountCodeError", new DuplicateAccountCodeError("1300")],
    ["AccountNotFoundError", new AccountNotFoundError("1300")],
    ["InvalidParentAccountError", new InvalidParentAccountError('الحساب الأصل "1300-1" غير موجود.', 'Parent account "1300-1" was not found.')],
    ["HeaderAccountNotPostableError", new HeaderAccountNotPostableError("1000")],
    ["CircularParentAccountError", new CircularParentAccountError("1300")],
    ["HeaderAccountHasChildrenError", new HeaderAccountHasChildrenError("1000")],
    // bank-reconciliation
    ["BankStatementNotFoundError", new BankStatementNotFoundError("stmt-1")],
    ["StatementLineNotFoundError", new StatementLineNotFoundError("line-1")],
    ["LineAlreadyMatchedError", new LineAlreadyMatchedError("line-1")],
    ["LineNotMatchedError", new LineNotMatchedError("line-1")],
    ["InvalidStatementFileError", new InvalidStatementFileError("ملف الكشف فارغ.", "The statement file is empty.")],
    ["ColumnNotFoundError", new ColumnNotFoundError("Amount")],
    [
      "InvalidColumnMappingError",
      new InvalidColumnMappingError(
        "يجب أن يحدد تخطيط الأعمدة `amountColumn` وحده أو `debitColumn`+`creditColumn` معاً، وليس الاثنين ولا لا شيء.",
        "A column mapping must set exactly one of `amountColumn` or both `debitColumn`+`creditColumn`.",
      ),
    ],
    ["StatementHasUnmatchedLinesError", new StatementHasUnmatchedLinesError("stmt-1", 3)],
    ["FinalizeOverrideReasonRequiredError", new FinalizeOverrideReasonRequiredError("stmt-1")],
    // cheques
    ["ChequeNotFoundError", new ChequeNotFoundError("chq-1")],
    ["DuplicateChequeNumberError", new DuplicateChequeNumberError("incoming", "CHQ-1001")],
    ["InvalidChequeTransitionError", new InvalidChequeTransitionError("chq-1", "pending", "collected")],
    ["InvalidChequeCommandError", new InvalidChequeCommandError("لا يمكن تخصيص شيك مرتد على فاتورة.", "A bounced cheque cannot be allocated to an invoice.")],
    ["ReplacementAmountMismatchError", new ReplacementAmountMismatchError("chq-1")],
    // cost-centers
    ["DuplicateCostCenterCodeError", new DuplicateCostCenterCodeError("CC-001")],
    ["CostCenterNotFoundError", new CostCenterNotFoundError("cc-1")],
    ["InvalidParentCostCenterError", new InvalidParentCostCenterError('مركز التكلفة الأصل "cc-9" غير موجود.', 'Parent cost center "cc-9" was not found.')],
    ["CircularParentCostCenterError", new CircularParentCostCenterError("cc-1")],
    // documents
    ["DuplicateDocumentError", new DuplicateDocumentError("JOURNAL_ENTRY", "j-1")],
    ["MissingHookError", new MissingHookError("JOURNAL_ENTRY", "gl")],
    // installments
    ["FollowUpNotFoundError", new FollowUpNotFoundError("fu-1")],
    // landed-costs
    ["EmptyLandedCostTargetsError", new EmptyLandedCostTargetsError()],
    ["ZeroLandedCostWeightError", new ZeroLandedCostWeightError("BY_QUANTITY")],
    // tax-rates
    ["DuplicateTaxCodeError", new DuplicateTaxCodeError("VAT14")],
    ["TaxRateNotFoundError", new TaxRateNotFoundError("t1")],
    ["InvalidTaxRateError", new InvalidTaxRateError("نسبة الضريبة يجب أن تكون رقماً بين 0 و100، والقيمة المُدخلة 150.", "Tax rate must be a number between 0 and 100, got 150.")],
    ["TaxGroupNotFoundError", new TaxGroupNotFoundError("tg-1")],
    // treasury-accounts
    ["DuplicateTreasuryAccountCodeError", new DuplicateTreasuryAccountCodeError("TA-001")],
    ["TreasuryAccountNotFoundError", new TreasuryAccountNotFoundError("ta-1")],
    ["NegativeCashBalanceError", new NegativeCashBalanceError("ta-1")],

    // crm
    ["LeadNotFoundError", new LeadNotFoundError("lead-1")],
    ["LeadNotConvertibleError", new LeadNotConvertibleError("lead-1")],
    ["DuplicatePipelineStageWinError", new DuplicatePipelineStageWinError()],
    ["PipelineStageNotFoundError", new PipelineStageNotFoundError("stage-1")],
    ["OpportunityNotFoundError", new OpportunityNotFoundError("opp-1")],
    ["ActivityNotFoundError", new ActivityNotFoundError("act-1")],
    ["ActivityNotPendingError", new ActivityNotPendingError("act-1")],
    // field-sales
    ["VanTripNotFoundError", new VanTripNotFoundError("trip-1")],
    ["VanTripNotOngoingError", new VanTripNotOngoingError("trip-1", "settled")],
    ["SameWarehouseVanTripError", new SameWarehouseVanTripError("wh-1")],
    // items
    ["ItemNotFoundError", new ItemNotFoundError("itm-1")],
    ["InvalidItemError", new InvalidItemError(["اسم الصنف بالعربية مطلوب"])],
    ["DuplicateItemUnitCodeError", new DuplicateItemUnitCodeError("PCS")],
    ["ItemUnitNotFoundError", new ItemUnitNotFoundError("PCS")],
    ["InvalidItemUnitError", new InvalidItemUnitError(["وحدة غير صالحة"])],
    ["ItemUnitInUseError", new ItemUnitInUseError("PCS", 3)],
    ["DuplicateItemCategoryCodeError", new DuplicateItemCategoryCodeError("CAT-1")],
    ["ItemCategoryNotFoundError", new ItemCategoryNotFoundError("cat-1")],
    ["InvalidItemCategoryError", new InvalidItemCategoryError(["فئة غير صالحة"])],
    ["ItemCategoryInUseError", new ItemCategoryInUseError("CAT-1", 2)],
    ["DuplicateItemSpecificationCodeError", new DuplicateItemSpecificationCodeError("COLOR")],
    ["ItemSpecificationNotFoundError", new ItemSpecificationNotFoundError("COLOR")],
    ["InvalidItemSpecificationError", new InvalidItemSpecificationError(["مواصفة غير صالحة"])],
    ["ItemSpecificationInUseError", new ItemSpecificationInUseError("COLOR", 5)],
    // items/item-catalog.js (a separate, same-named error set — see report for why both exist)
    ["item-catalog.js DuplicateItemUnitCodeError", new CatalogDuplicateItemUnitCodeError("PCS")],
    ["item-catalog.js ItemUnitNotFoundError", new CatalogItemUnitNotFoundError("PCS")],
    ["item-catalog.js DuplicateItemCategoryError", new CatalogDuplicateItemCategoryError("cat-1")],
    ["item-catalog.js ItemCategoryNotFoundError", new CatalogItemCategoryNotFoundError("cat-1")],
    ["item-catalog.js InvalidItemCategoryError", new CatalogInvalidItemCategoryError("لا يمكن أن تكون الفئة أباً لنفسها.", "A category cannot be its own parent.")],
    // promotions
    ["InvalidPromotionError", new InvalidPromotionError(["كود العرض مطلوب."])],
    ["PromotionNotFoundError", new PromotionNotFoundError("promo-1")],
    ["DuplicatePromotionError", new DuplicatePromotionError("SUMMER10")],
    ["CouponRequiredError", new CouponRequiredError("SUMMER10")],
    // sales-invoices
    ["InvalidSalesInvoiceError", new InvalidSalesInvoiceError(["العميل مطلوب."])],
    ["SalesInvoiceNotFoundError", new SalesInvoiceNotFoundError("inv-1")],
    ["DuplicateSalesInvoiceError", new DuplicateSalesInvoiceError("inv-1")],
    // sales-quotes
    ["InvalidSalesQuoteError", new InvalidSalesQuoteError(["العميل مطلوب."])],
    ["SalesQuoteNotFoundError", new SalesQuoteNotFoundError("qt-1")],
    ["DuplicateSalesQuoteError", new DuplicateSalesQuoteError("qt-1")],

    // attachments
    ["AttachmentNotFoundError", new AttachmentNotFoundError("att-1")],
    ["DuplicateAttachmentIdError", new DuplicateAttachmentIdError("att-1")],
    ["InvalidAttachmentError", new InvalidAttachmentError(["اسم الملف مطلوب"])],
    // eta
    ["EtaSubmissionNotFoundError", new EtaSubmissionNotFoundError("sub-1")],
    ["DuplicateEtaSubmissionError", new DuplicateEtaSubmissionError("INV-1")],
    ["InvalidEtaTransitionError", new InvalidEtaTransitionError("accepted", "exclude")],
    ["EtaOfflineError", new EtaOfflineError()],
    ["EtaExclusionReasonRequiredError", new EtaExclusionReasonRequiredError()],
    // hr
    ["DepartmentNotFoundError", new DepartmentNotFoundError("DEPT-1")],
    ["JobTitleNotFoundError", new JobTitleNotFoundError("JT-1")],
    ["EmployeeNotFoundError", new EmployeeNotFoundError("EMP-1")],
    ["UserNotLinkedToEmployeeError", new UserNotLinkedToEmployeeError("user-1")],
    ["ContractNotFoundError", new ContractNotFoundError("CT-1")],
    ["ContractNotActiveError", new ContractNotActiveError("CT-1")],
    ["HolidayNotFoundError", new HolidayNotFoundError("HOL-1")],
    ["LeaveRequestNotFoundError", new LeaveRequestNotFoundError("LR-1")],
    ["AttendanceEntryNotFoundError", new AttendanceEntryNotFoundError("ATT-1")],
    ["DuplicateAttendanceEntryError", new DuplicateAttendanceEntryError("EMP-1", "2026-09-19")],
    ["LeavePolicyNotFoundError", new LeavePolicyNotFoundError("LP-1")],
    ["DuplicateLeavePolicyError", new DuplicateLeavePolicyError("annual")],
    ["UnknownLeavePolicyPresetError", new UnknownLeavePolicyPresetError("EG_LABOUR_2027")],
    ["LeaveBalanceNotFoundError", new LeaveBalanceNotFoundError("LB-1")],
    ["EmployeeAdvanceNotFoundError", new EmployeeAdvanceNotFoundError("ADV-1")],
    ["PayrollRunNotFoundError", new PayrollRunNotFoundError("PR-1")],
    ["DuplicatePayrollPeriodError", new DuplicatePayrollPeriodError(2026, 9, "MAIN")],
    ["NoPayableEmployeesError", new NoPayableEmployeesError("PR-1")],
    ["NegativeNetPayError", new NegativeNetPayError("EMP-1", "5000.00", "6000.00")],
    ["TreasuryDisbursementUnavailableError", new TreasuryDisbursementUnavailableError()],
    // manufacturing
    ["BomNotFoundError", new BomNotFoundError("BOM-1")],
    ["WorkOrderNotFoundError", new WorkOrderNotFoundError("WO-1")],
    ["ConfigurableProductNotFoundError", new ConfigurableProductNotFoundError("CFG-1")],
    ["ConfigInstanceNotFoundError", new ConfigInstanceNotFoundError("CI-1")],
    ["DuplicateManufacturingDocumentError", new DuplicateManufacturingDocumentError("WO-1")],
    ["InvalidManufacturingDocumentError", new InvalidManufacturingDocumentError(["الكمية المخططة يجب أن تكون أكبر من صفر"])],
    ["WorkOrderStageError", new WorkOrderStageError("issue", "not_started")],
    ["FormulaError", new FormulaError("EVAL", "division by zero")],
    // notifications
    ["InvalidNotificationRuleError", new InvalidNotificationRuleError(["اسم القاعدة مطلوب."])],
    ["NotificationRuleNotFoundError", new NotificationRuleNotFoundError("rule-1")],
    ["NotificationNotFoundError", new NotificationNotFoundError("n-1")],
    // platform
    ["InvalidTenantError", new InvalidTenantError(["المعرّف مطلوب"])],
    ["InvalidPlanError", new InvalidPlanError(["الاسم بالعربية مطلوب"])],
    ["InvalidSubscriptionError", new InvalidSubscriptionError(["عدد المقاعد الإضافية يجب أن يكون رقمًا صحيحًا لا يقل عن 0"])],
    ["InvalidPaymentError", new InvalidPaymentError(["المرجع مطلوب"])],
    ["InvalidPlatformUserError", new InvalidPlatformUserError(["البريد الإلكتروني مطلوب"])],
    // projects
    ["DuplicateProjectCodeError", new DuplicateProjectCodeError("PRJ-01")],
    ["ProjectNotFoundError", new ProjectNotFoundError("prj-1")],
  ];

  it.each(cases)("%s: an Arabic message with no bare Latin word in it, and English beside it", (_name, error) => {
    expect(error.message).toMatch(ARABIC);
    expect(
      error.message
        .replace(/"[^"]*"/g, "")
        .replace(/`[^`]*`/g, "")
        .replace(/'[^']*'/g, ""),
    ).not.toMatch(LATIN_WORD);
    if (error.messageEn !== undefined) {
      expect(error.messageEn).toMatch(LATIN_WORD);
    }
    expect(error.code).toMatch(/^[A-Z_]+$/);
  });
});
