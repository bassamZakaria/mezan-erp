import { Money } from "../money/index.js";
import { InvalidDunningPolicyError, type BilingualReason } from "./errors.js";
import { DunningChannel, type DunningPolicy, type DunningStep } from "./types.js";

export const DUNNING_PLACEHOLDERS = [
  "customerName",
  "companyName",
  "documentNumber",
  "amount",
  "dueDate",
  "daysOverdue",
  "daysOverdueLabel",
  "totalOverdue",
] as const;

export const MAX_DUNNING_STEPS = 8;

export function defaultDunningSteps(): DunningStep[] {
  return [
    {
      id: "step-1",
      level: 1,
      daysOverdue: 7,
      channel: DunningChannel.Email,
      subjectAr: "تذكير ودي: فاتورة {{documentNumber}} مستحقة السداد",
      subjectEn: "Friendly reminder: invoice {{documentNumber}} is overdue",
      bodyAr:
        "السادة {{customerName}}،\n\nنود تذكيركم بأن الفاتورة رقم {{documentNumber}} بمبلغ {{amount}} كانت مستحقة في {{dueDate}}، وقد تأخر سدادها {{daysOverdueLabel}}.\nإذا كنتم قد سددتم بالفعل فنرجو تجاهل هذه الرسالة، وإلا فنرجو التكرم بالسداد في أقرب وقت.\n\nمع خالص الشكر،\n{{companyName}}",
      bodyEn:
        "Dear {{customerName}},\n\nThis is a friendly reminder that invoice {{documentNumber}} for {{amount}} was due on {{dueDate}} ({{daysOverdueLabel}} ago).\nIf you have already paid, please disregard this message.\n\nThank you,\n{{companyName}}",
      active: true,
    },
    {
      id: "step-2",
      level: 2,
      daysOverdue: 30,
      channel: DunningChannel.WhatsApp,
      subjectAr: "متابعة سداد الفاتورة {{documentNumber}}",
      subjectEn: "Follow-up on invoice {{documentNumber}}",
      bodyAr:
        "السادة {{customerName}}، تحية طيبة.\nالفاتورة رقم {{documentNumber}} بمبلغ {{amount}} متأخرة {{daysOverdueLabel}} عن تاريخ استحقاقها {{dueDate}}. إجمالي المتأخر على حسابكم {{totalOverdue}}.\nنرجو إفادتنا بموعد السداد.\n{{companyName}}",
      bodyEn:
        "Dear {{customerName}}, invoice {{documentNumber}} for {{amount}} is {{daysOverdueLabel}} past its due date {{dueDate}}. Your total overdue balance is {{totalOverdue}}. Please let us know when payment will be made.\n{{companyName}}",
      active: true,
    },
    {
      id: "step-3",
      level: 3,
      daysOverdue: 60,
      channel: DunningChannel.Email,
      subjectAr: "إشعار نهائي بالمستحقات المتأخرة على حسابكم",
      subjectEn: "Final notice: overdue balance on your account",
      bodyAr:
        "السادة {{customerName}}،\n\nرغم تذكيراتنا السابقة، ما زالت الفاتورة رقم {{documentNumber}} بمبلغ {{amount}} غير مسددة منذ {{daysOverdueLabel}}، وإجمالي المتأخر على حسابكم {{totalOverdue}}.\nنرجو السداد خلال سبعة أيام من تاريخ هذه الرسالة تجنباً لإيقاف التعامل الآجل.\n\n{{companyName}}",
      bodyEn:
        "Dear {{customerName}},\n\nDespite our earlier reminders, invoice {{documentNumber}} for {{amount}} remains unpaid {{daysOverdueLabel}} after it fell due; your total overdue balance is {{totalOverdue}}.\nPlease settle within seven days of this notice to avoid suspension of credit terms.\n\n{{companyName}}",
      active: true,
    },
  ];
}

export function defaultDunningPolicy(): DunningPolicy {
  return {
    steps: defaultDunningSteps(),
    autoSendEnabled: false,
    minimumOverdueAmount: Money.zero(),
    pauseWhilePromisePending: true,
    lastScheduledRunDate: null,
    updatedAt: null,
    updatedBy: null,
  };
}

const CHANNELS = new Set<string>(Object.values(DunningChannel));

export interface DunningPolicyValidationOptions {
  readonly smsAvailable: boolean;
}

export function assertValidDunningPolicy(policy: DunningPolicy, options: DunningPolicyValidationOptions): DunningPolicy {
  const reasons: BilingualReason[] = [];
  if (policy.steps.length > MAX_DUNNING_STEPS) reasons.push({ ar: `لا يمكن أن تزيد مراحل التحصيل عن ${MAX_DUNNING_STEPS}`, en: `There can be at most ${MAX_DUNNING_STEPS} dunning steps` });
  if (policy.minimumOverdueAmount.scaled < 0n) reasons.push({ ar: "الحد الأدنى للمبلغ المتأخر لا يمكن أن يكون سالباً", en: "The minimum overdue amount cannot be negative" });
  const ids = new Set<string>();
  const days = new Set<number>();
  for (const step of policy.steps) {
    if (step.id.trim() === "") reasons.push({ ar: "كل مرحلة تحتاج معرّفاً", en: "Every step needs an id" });
    if (ids.has(step.id)) reasons.push({ ar: `معرّف المرحلة «${step.id}» مكرر`, en: `Step id "${step.id}" is duplicated` });
    ids.add(step.id);
    if (!Number.isInteger(step.daysOverdue) || step.daysOverdue < 1 || step.daysOverdue > 3650) {
      reasons.push({ ar: `أيام التأخير في المرحلة ${step.level} يجب أن تكون بين 1 و3650`, en: `Days overdue in step ${step.level} must be between 1 and 3650` });
    }
    if (days.has(step.daysOverdue)) reasons.push({ ar: `مرحلتان على نفس عدد أيام التأخير (${step.daysOverdue})`, en: `Two steps share the same days overdue (${step.daysOverdue})` });
    days.add(step.daysOverdue);
    if (!CHANNELS.has(step.channel)) reasons.push({ ar: `قناة غير معروفة في المرحلة ${step.level}`, en: `Unknown channel in step ${step.level}` });
    if (step.channel === DunningChannel.Sms && !options.smsAvailable) {
      reasons.push({ ar: "قناة SMS غير متاحة قبل ربط مزوّد رسائل", en: "The SMS channel is unavailable until a messaging provider is connected" });
    }
    if (step.bodyAr.trim() === "") reasons.push({ ar: `نص الرسالة العربي مطلوب في المرحلة ${step.level}`, en: `The Arabic message text is required in step ${step.level}` });
    if (step.channel === DunningChannel.Email && step.subjectAr.trim() === "") {
      reasons.push({ ar: `عنوان البريد العربي مطلوب في المرحلة ${step.level}`, en: `The Arabic email subject is required in step ${step.level}` });
    }
  }
  if (reasons.length > 0) throw new InvalidDunningPolicyError(reasons);
  const ordered = [...policy.steps].sort((a, b) => a.daysOverdue - b.daysOverdue).map((step, index) => ({ ...step, level: index + 1 }));
  return { ...policy, steps: ordered };
}

export function stepReached(policy: DunningPolicy, daysOverdue: number): DunningStep | null {
  let reached: DunningStep | null = null;
  for (const step of policy.steps) {
    if (!step.active) continue;
    if (step.daysOverdue <= daysOverdue && (!reached || step.daysOverdue > reached.daysOverdue)) reached = step;
  }
  return reached;
}
