import {
  OwnerDigestBackupState,
  OwnerDigestCadence,
  OwnerDigestComparison,
  OwnerDigestCoverageState,
  OwnerDigestExceptionKind,
  OwnerDigestLanguage,
  OwnerDigestMetricKey,
  OwnerDigestSeverity,
  type OwnerDigestDTO,
  type OwnerDigestExceptionDTO,
  type OwnerDigestExceptionItemDTO,
  type OwnerDigestMetricDTO,
} from "@mezan/contracts";
import { currencyLabelAr, formatMoneyLabel } from "../collections/message.js";
import { Money } from "../money/index.js";

export interface RenderedOwnerDigest {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface Copy {
  readonly dir: "rtl" | "ltr";
  readonly align: "right" | "left";
  readonly titleDaily: (day: string) => string;
  readonly titleWeekly: (from: string, to: string) => string;
  readonly subject: (company: string, title: string) => string;
  readonly greeting: (name: string | null) => string;
  readonly figures: string;
  readonly attention: string;
  readonly allClear: string;
  readonly metric: Readonly<Record<OwnerDigestMetricKey, string>>;
  readonly comparison: Readonly<Record<OwnerDigestComparison, string>>;
  readonly notPermitted: string;
  readonly backupNotReported: string;
  readonly severity: Readonly<Record<OwnerDigestSeverity, string>>;
  readonly kindTitle: Readonly<Record<OwnerDigestExceptionKind, string>>;
  readonly describe: (exception: OwnerDigestExceptionDTO, money: (value: string) => string) => string;
  readonly shortage: string;
  readonly overage: string;
  readonly generated: (at: string) => string;
  readonly footer: string;
  readonly more: (count: number) => string;
}

const AR: Copy = {
  dir: "rtl",
  align: "right",
  titleDaily: (day) => `ملخص المالك ليوم ${day}`,
  titleWeekly: (from, to) => `ملخص المالك للأسبوع من ${from} إلى ${to}`,
  subject: (company, title) => `${title} — ${company}`,
  greeting: (name) => (name ? `مرحباً ${name}،` : "مرحباً،"),
  figures: "أرقام الفترة",
  attention: "ما يستحق انتباهك",
  allClear: "لا توجد استثناءات تتجاوز الحدود المضبوطة خلال هذه الفترة.",
  metric: {
    [OwnerDigestMetricKey.Sales]: "المبيعات",
    [OwnerDigestMetricKey.Collections]: "التحصيلات",
    [OwnerDigestMetricKey.GrossProfit]: "مجمل الربح",
    [OwnerDigestMetricKey.Cash]: "رصيد النقدية والبنوك",
  },
  comparison: {
    [OwnerDigestComparison.SameWeekdayLastWeek]: "مقارنة بنفس اليوم من الأسبوع الماضي",
    [OwnerDigestComparison.PreviousWeek]: "مقارنة بالأسبوع السابق",
    [OwnerDigestComparison.None]: "",
  },
  notPermitted: "بعض البنود غير معروضة لأنها خارج صلاحياتك أو نطاق فروعك.",
  backupNotReported: "حالة النسخ الاحتياطي غير مُبلَّغة في هذه البيئة، فلم تُفحص.",
  severity: {
    [OwnerDigestSeverity.Critical]: "عاجل",
    [OwnerDigestSeverity.Warning]: "تنبيه",
    [OwnerDigestSeverity.Notice]: "للعلم",
  },
  kindTitle: {
    [OwnerDigestExceptionKind.Void]: "فواتير ملغاة",
    [OwnerDigestExceptionKind.LargeDiscount]: "خصومات كبيرة",
    [OwnerDigestExceptionKind.BelowFloor]: "مبيعات بأقل من الحد الأدنى للسعر",
    [OwnerDigestExceptionKind.CashVariance]: "فروق نقدية",
    [OwnerDigestExceptionKind.OverdueCollections]: "مستحقات متأخرة",
    [OwnerDigestExceptionKind.LowStock]: "مخزون منخفض",
    [OwnerDigestExceptionKind.ApprovalsWaiting]: "موافقات تنتظر قراراً",
    [OwnerDigestExceptionKind.FailedEta]: "مستندات إلكترونية متعثرة",
    [OwnerDigestExceptionKind.Backup]: "النسخ الاحتياطي",
  },
  describe: (exception, money) => {
    const total = exception.amount === null ? "" : money(exception.amount);
    const threshold = exception.threshold ?? "";
    switch (exception.kind) {
      case OwnerDigestExceptionKind.Void:
        return `${exception.count} فاتورة ملغاة بإجمالي ${total}.`;
      case OwnerDigestExceptionKind.LargeDiscount:
        return `${exception.count} فاتورة بخصم ${threshold}% أو أكثر.`;
      case OwnerDigestExceptionKind.BelowFloor:
        return `${exception.count} بند بيع بأقل من الحد الأدنى للسعر.`;
      case OwnerDigestExceptionKind.CashVariance:
        return `${exception.count} فرق نقدي لا يقل عن ${money(threshold)}.`;
      case OwnerDigestExceptionKind.OverdueCollections:
        return `${total} متأخرة على ${exception.count} فاتورة لدى ${exception.secondaryCount ?? 0} عميل${exception.items[0]?.on ? `، وأقدمها استحقاقاً ${exception.items[0].on}` : ""}.`;
      case OwnerDigestExceptionKind.LowStock:
        return `${exception.count} صنف عند حد إعادة الطلب أو أقل، منها ${exception.secondaryCount ?? 0} نفد.`;
      case OwnerDigestExceptionKind.ApprovalsWaiting:
        return `${exception.count} طلب ينتظر القرار ${threshold} ساعة أو أكثر.`;
      case OwnerDigestExceptionKind.FailedEta:
        return `${exception.count} مستند لم تقبله مصلحة الضرائب أو تعذّر إرساله.`;
      case OwnerDigestExceptionKind.Backup:
        if (exception.backupState === OwnerDigestBackupState.Failed) return "فشلت آخر محاولة نسخ احتياطي.";
        return exception.items[0]?.on
          ? `آخر نسخة احتياطية ناجحة بتاريخ ${exception.items[0].on}، أي قبل أكثر من ${threshold} ساعة.`
          : "لا توجد نسخة احتياطية ناجحة مسجَّلة.";
    }
  },
  shortage: "عجز",
  overage: "زيادة",
  generated: (at) => `أُعدّ هذا الملخص في ${at}.`,
  footer: "أُرسل من ميزان. يظهر لك ما تسمح به صلاحياتك فقط.",
  more: (count) => `و${count} أخرى`,
};

const EN: Copy = {
  dir: "ltr",
  align: "left",
  titleDaily: (day) => `Owner digest for ${day}`,
  titleWeekly: (from, to) => `Owner digest for ${from} to ${to}`,
  subject: (company, title) => `${title} — ${company}`,
  greeting: (name) => (name ? `Hello ${name},` : "Hello,"),
  figures: "Figures for the period",
  attention: "What needs your attention",
  allClear: "Nothing crossed your configured thresholds during this period.",
  metric: {
    [OwnerDigestMetricKey.Sales]: "Sales",
    [OwnerDigestMetricKey.Collections]: "Collections",
    [OwnerDigestMetricKey.GrossProfit]: "Gross profit",
    [OwnerDigestMetricKey.Cash]: "Cash and bank balance",
  },
  comparison: {
    [OwnerDigestComparison.SameWeekdayLastWeek]: "Compared with the same weekday last week",
    [OwnerDigestComparison.PreviousWeek]: "Compared with the previous week",
    [OwnerDigestComparison.None]: "",
  },
  notPermitted: "Some items are not shown because they are outside your permissions or branches.",
  backupNotReported: "Backup status is not reported in this environment, so it was not checked.",
  severity: {
    [OwnerDigestSeverity.Critical]: "Urgent",
    [OwnerDigestSeverity.Warning]: "Warning",
    [OwnerDigestSeverity.Notice]: "FYI",
  },
  kindTitle: {
    [OwnerDigestExceptionKind.Void]: "Voided invoices",
    [OwnerDigestExceptionKind.LargeDiscount]: "Large discounts",
    [OwnerDigestExceptionKind.BelowFloor]: "Sales below the price floor",
    [OwnerDigestExceptionKind.CashVariance]: "Cash variances",
    [OwnerDigestExceptionKind.OverdueCollections]: "Overdue receivables",
    [OwnerDigestExceptionKind.LowStock]: "Low stock",
    [OwnerDigestExceptionKind.ApprovalsWaiting]: "Approvals waiting",
    [OwnerDigestExceptionKind.FailedEta]: "Failed e-invoicing documents",
    [OwnerDigestExceptionKind.Backup]: "Backup",
  },
  describe: (exception, money) => {
    const total = exception.amount === null ? "" : money(exception.amount);
    const threshold = exception.threshold ?? "";
    switch (exception.kind) {
      case OwnerDigestExceptionKind.Void:
        return `${exception.count} voided invoice(s) worth ${total}.`;
      case OwnerDigestExceptionKind.LargeDiscount:
        return `${exception.count} invoice(s) discounted ${threshold}% or more.`;
      case OwnerDigestExceptionKind.BelowFloor:
        return `${exception.count} sale line(s) below the price floor.`;
      case OwnerDigestExceptionKind.CashVariance:
        return `${exception.count} cash variance(s) of at least ${money(threshold)}.`;
      case OwnerDigestExceptionKind.OverdueCollections:
        return `${total} overdue across ${exception.count} invoice(s) and ${exception.secondaryCount ?? 0} customer(s)${exception.items[0]?.on ? `; the oldest fell due on ${exception.items[0].on}` : ""}.`;
      case OwnerDigestExceptionKind.LowStock:
        return `${exception.count} item(s) at or below the reorder point, ${exception.secondaryCount ?? 0} of them out of stock.`;
      case OwnerDigestExceptionKind.ApprovalsWaiting:
        return `${exception.count} request(s) waiting ${threshold} hours or more.`;
      case OwnerDigestExceptionKind.FailedEta:
        return `${exception.count} document(s) the tax authority did not accept or that could not be sent.`;
      case OwnerDigestExceptionKind.Backup:
        if (exception.backupState === OwnerDigestBackupState.Failed) return "The last backup attempt failed.";
        return exception.items[0]?.on
          ? `The last successful backup was on ${exception.items[0].on}, more than ${threshold} hours ago.`
          : "No successful backup is on record.";
    }
  },
  shortage: "shortage",
  overage: "overage",
  generated: (at) => `Prepared at ${at}.`,
  footer: "Sent by Mezan. You only see what your permissions allow.",
  more: (count) => `and ${count} more`,
};

const COPY: Readonly<Record<OwnerDigestLanguage, Copy>> = {
  [OwnerDigestLanguage.Ar]: AR,
  [OwnerDigestLanguage.En]: EN,
};

const BRAND = "#003ce1";
const INK = "#14231e";
const MUTED = "#424f48";
const BORDER = "#ddd5c3";
const PAGE = "#ece6da";
const SURFACE = "#ffffff";
const SUCCESS = "#1c6b41";
const DANGER = "#8f2a1e";
const SEVERITY_COLOR: Readonly<Record<OwnerDigestSeverity, string>> = {
  [OwnerDigestSeverity.Critical]: "#c0402f",
  [OwnerDigestSeverity.Warning]: "#8a5f18",
  [OwnerDigestSeverity.Notice]: "#2f6690",
};
const FONT = "Tahoma, 'Segoe UI', Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function moneyLabeller(digest: OwnerDigestDTO): (value: string) => string {
  const currency = digest.language === OwnerDigestLanguage.Ar ? currencyLabelAr(digest.currency) : digest.currency;
  return (value) => formatMoneyLabel(Money.fromMajor(value), currency);
}

function signedMoney(value: string, money: (value: string) => string): string {
  const parsed = Money.fromMajor(value);
  return parsed.scaled > 0n ? `+${money(value)}` : money(value);
}

function generatedLabel(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function titleOf(digest: OwnerDigestDTO, copy: Copy): string {
  return digest.period.cadence === OwnerDigestCadence.Weekly ? copy.titleWeekly(digest.period.from, digest.period.to) : copy.titleDaily(digest.period.to);
}

function itemLine(kind: OwnerDigestExceptionKind, item: OwnerDigestExceptionItemDTO, copy: Copy, money: (value: string) => string): string {
  const parts: string[] = [];
  if (item.reference) parts.push(item.reference);
  if (kind !== OwnerDigestExceptionKind.OverdueCollections && item.party) parts.push(item.party);
  if (kind !== OwnerDigestExceptionKind.OverdueCollections && item.amount !== null) {
    const parsed = Money.fromMajor(item.amount);
    const label = money(item.amount);
    parts.push(kind === OwnerDigestExceptionKind.CashVariance ? `${parsed.scaled < 0n ? copy.shortage : copy.overage} ${label}` : label);
  }
  if (kind !== OwnerDigestExceptionKind.OverdueCollections && item.detail) parts.push(item.detail);
  return parts.join(" · ");
}

function visibleItems(exception: OwnerDigestExceptionDTO): OwnerDigestExceptionItemDTO[] {
  return exception.kind === OwnerDigestExceptionKind.OverdueCollections || exception.kind === OwnerDigestExceptionKind.Backup
    ? []
    : exception.items;
}

function metricChange(metric: OwnerDigestMetricDTO, money: (value: string) => string): { text: string; color: string } | null {
  if (metric.change === null) return null;
  const change = Money.fromMajor(metric.change);
  if (change.scaled === 0n) return { text: "=", color: MUTED };
  return change.scaled > 0n ? { text: `▲ ${signedMoney(metric.change, money)}`, color: SUCCESS } : { text: `▼ ${money(metric.change)}`, color: DANGER };
}

function ltr(value: string): string {
  return `<span dir="ltr" style="unicode-bidi:embed;">${escapeHtml(value)}</span>`;
}

function metricsHtml(digest: OwnerDigestDTO, copy: Copy, money: (value: string) => string): string {
  const rows = digest.metrics
    .map((metric) => {
      const change = metricChange(metric, money);
      return `<tr>
<td align="${copy.align}" style="padding:10px 12px;border-bottom:1px solid ${BORDER};font:14px ${FONT};color:${MUTED};text-align:${copy.align};">${escapeHtml(copy.metric[metric.key])}</td>
<td align="${copy.align}" style="padding:10px 12px;border-bottom:1px solid ${BORDER};font:bold 15px ${FONT};color:${INK};text-align:${copy.align};">${ltr(money(metric.current))}</td>
<td align="${copy.align}" style="padding:10px 12px;border-bottom:1px solid ${BORDER};font:13px ${FONT};color:${change?.color ?? MUTED};text-align:${copy.align};">${change ? ltr(change.text) : ""}</td>
</tr>`;
    })
    .join("\n");
  const note = copy.comparison[digest.comparison];
  return `<tr><td style="padding:18px 20px 6px 20px;font:bold 16px ${FONT};color:${INK};text-align:${copy.align};" align="${copy.align}">${escapeHtml(copy.figures)}</td></tr>
<tr><td style="padding:0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${copy.dir}">${rows}</table></td></tr>
${note ? `<tr><td align="${copy.align}" style="padding:6px 20px 0 20px;font:12px ${FONT};color:${MUTED};text-align:${copy.align};">${escapeHtml(note)}</td></tr>` : ""}`;
}

function exceptionHtml(exception: OwnerDigestExceptionDTO, copy: Copy, money: (value: string) => string): string {
  const color = SEVERITY_COLOR[exception.severity];
  const items = visibleItems(exception);
  const lines = items
    .map((item) => itemLine(exception.kind, item, copy, money))
    .filter((line) => line !== "")
    .map((line) => `<div style="padding-top:4px;font:13px ${FONT};color:${MUTED};">${escapeHtml(line)}</div>`)
    .join("");
  const remainder = exception.count - items.length;
  const more = items.length > 0 && remainder > 0 ? `<div style="padding-top:4px;font:12px ${FONT};color:${MUTED};">${escapeHtml(copy.more(remainder))}</div>` : "";
  const edge = copy.dir === "rtl" ? "border-right" : "border-left"; // rtl-allow-physical
  return `<tr><td style="padding:6px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${copy.dir}"><tr>
<td align="${copy.align}" style="${edge}:4px solid ${color};background:${PAGE};padding:10px 12px;text-align:${copy.align};">
<div style="font:bold 14px ${FONT};color:${INK};"><span style="color:${color};">${escapeHtml(copy.severity[exception.severity])}</span> · ${escapeHtml(copy.kindTitle[exception.kind])}</div>
<div style="padding-top:4px;font:14px ${FONT};color:${INK};">${escapeHtml(copy.describe(exception, money))}</div>${lines}${more}
</td></tr></table></td></tr>`;
}

function coverageNotes(digest: OwnerDigestDTO, copy: Copy): string[] {
  const notes: string[] = [];
  if (digest.coverage.some((entry) => entry.state === OwnerDigestCoverageState.NotPermitted)) notes.push(copy.notPermitted);
  if (digest.coverage.some((entry) => entry.state === OwnerDigestCoverageState.NotReported)) notes.push(copy.backupNotReported);
  return notes;
}

export function renderOwnerDigest(digest: OwnerDigestDTO): RenderedOwnerDigest {
  const copy = COPY[digest.language];
  const money = moneyLabeller(digest);
  const title = titleOf(digest, copy);
  const notes = coverageNotes(digest, copy);
  const subject = copy.subject(digest.companyName, title);

  const textLines: string[] = [title, digest.companyName, "", copy.greeting(digest.recipientName), "", copy.figures];
  for (const metric of digest.metrics) {
    const change = metricChange(metric, money);
    textLines.push(`- ${copy.metric[metric.key]}: ${money(metric.current)}${change ? ` (${change.text})` : ""}`);
  }
  const comparison = copy.comparison[digest.comparison];
  if (comparison) textLines.push(comparison);
  textLines.push("", copy.attention);
  if (digest.exceptions.length === 0) textLines.push(copy.allClear);
  for (const exception of digest.exceptions) {
    textLines.push(`* [${copy.severity[exception.severity]}] ${copy.kindTitle[exception.kind]}: ${copy.describe(exception, money)}`);
    for (const item of visibleItems(exception)) {
      const line = itemLine(exception.kind, item, copy, money);
      if (line) textLines.push(`    - ${line}`);
    }
  }
  if (notes.length > 0) textLines.push("", ...notes);
  textLines.push("", copy.generated(generatedLabel(digest.generatedAt)), copy.footer);

  const exceptionRows = digest.exceptions.length === 0
    ? `<tr><td align="${copy.align}" style="padding:6px 20px;font:14px ${FONT};color:${SUCCESS};text-align:${copy.align};">${escapeHtml(copy.allClear)}</td></tr>`
    : digest.exceptions.map((exception) => exceptionHtml(exception, copy, money)).join("\n");
  const noteRows = notes
    .map((note) => `<tr><td align="${copy.align}" style="padding:6px 20px 0 20px;font:12px ${FONT};color:${MUTED};text-align:${copy.align};">${escapeHtml(note)}</td></tr>`)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="${digest.language}" dir="${copy.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body dir="${copy.dir}" style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" dir="${copy.dir}" style="background:${PAGE};">
<tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${SURFACE}" dir="${copy.dir}" style="width:100%;max-width:600px;background:${SURFACE};">
<tr><td align="${copy.align}" bgcolor="${BRAND}" style="background:${BRAND};padding:18px 20px;text-align:${copy.align};">
<div style="font:bold 18px ${FONT};color:#ffffff;">${escapeHtml(title)}</div>
<div style="padding-top:4px;font:13px ${FONT};color:#dee9ff;">${escapeHtml(digest.companyName)}</div>
</td></tr>
<tr><td align="${copy.align}" style="padding:16px 20px 0 20px;font:14px ${FONT};color:${INK};text-align:${copy.align};">${escapeHtml(copy.greeting(digest.recipientName))}</td></tr>
${metricsHtml(digest, copy, money)}
<tr><td align="${copy.align}" style="padding:18px 20px 6px 20px;font:bold 16px ${FONT};color:${INK};text-align:${copy.align};">${escapeHtml(copy.attention)}</td></tr>
${exceptionRows}
${noteRows}
<tr><td align="${copy.align}" style="padding:18px 20px;font:12px ${FONT};color:${MUTED};text-align:${copy.align};">${escapeHtml(copy.generated(generatedLabel(digest.generatedAt)))}<br>${escapeHtml(copy.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text: textLines.join("\n"), html };
}
