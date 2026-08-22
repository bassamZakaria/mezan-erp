/**
 * Installments (خطط الأقساط، docs/catalog/05) — schedule generation from an
 * invoice, the plan as a document-framework consumer, معالجة المتأخرات
 * overdue batch (late-fee stubbed, see `overdue.ts`), and متابعة التحصيل
 * collection follow-ups.
 */

export {
  INSTALLMENT_FREQUENCIES,
  generateInstallmentSchedule,
  type InstallmentFrequency,
  type GenerateInstallmentScheduleInput,
  type GeneratedInstallment,
  type GeneratedSchedule,
} from "./schedule.js";

export {
  DOC_TYPE as INSTALLMENT_PLAN_DOC_TYPE,
  INSTALLMENT_LINE_STATUSES,
  installmentPlanDocumentType,
  type InstallmentLineStatus,
  type InstallmentLine,
  type InstallmentPlanDocument,
} from "./installment-plan-document.js";

export {
  processOverdueInstallments,
  type LateFeeConfig,
  type OverdueProcessingResult,
} from "./overdue.js";

export {
  FOLLOW_UP_TYPES,
  FOLLOW_UP_STATUSES,
  createFollowUp,
  completeFollowUp,
  cancelFollowUp,
  requireFollowUp,
  type FollowUpType,
  type FollowUpStatus,
  type CollectionFollowUp,
  type CollectionFollowUpRepository,
  type CollectionFollowUpListFilter,
  type CreateFollowUpCommand,
} from "./follow-up.js";

export {
  InvalidInstallmentScheduleError,
  FollowUpNotFoundError,
  InvalidFollowUpTransitionError,
} from "./errors.js";
