import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { DEFAULT_SETTINGS, InvalidSettingsError, updateSettings } from "../settings/settings.js";
import { CashFlowDirection, CashForecastSourceKind, type CashForecastItem } from "../cash-forecast/types.js";
import { buildCollectionWorklist } from "./worklist.js";
import { currencyLabelAr, formatMoneyLabel } from "./message.js";
import { ArabicCase, arabicDays } from "../text/counted-noun.js";
import { DEFAULT_STATEMENT_EMAIL_BODY, DEFAULT_STATEMENT_EMAIL_SUBJECT, renderOpenItemStatement, type OpenItemStatementInput } from "./statement.js";

const TODAY = "2026-10-28";

function receivable(reference: string, dueDate: string, amount: string): CashForecastItem {
  return {
    id: `receivable:${reference}`,
    kind: CashForecastSourceKind.Receivable,
    direction: CashFlowDirection.Inflow,
    dueDate,
    amount: Money.fromMajor(amount),
    partyId: "C1",
    partyName: "شركة النور",
    partyNameEn: null,
    reference,
    documentId: reference,
    currency: null,
    branchId: null,
    detail: null,
  };
}

const input = (over: Partial<OpenItemStatementInput> = {}): OpenItemStatementInput => ({
  customerName: "شركة النور",
  companyName: "ميزان للتجارة",
  asOfDate: TODAY,
  currency: "EGP",
  items: buildCollectionWorklist(
    [receivable("INV-7", "2026-09-01", "1250.5"), receivable("INV-9", "2026-11-15", "300")],
    TODAY,
  )[0]!.items,
  balance: Money.fromMajor("1550.5"),
  ...over,
});

function statementBeforeTemplates(statement: OpenItemStatementInput) {
  const overdue = Money.sum(statement.items.filter((i) => i.daysOverdue > 0).map((i) => i.amount));
  const ordered = [...statement.items].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const arLines = ordered.map(
    (item) =>
      `• ${item.reference ?? "رصيد سابق"} — استحقاق ${item.dueDate} — ${formatMoneyLabel(item.amount, currencyLabelAr(statement.currency))}` +
      (item.daysOverdue > 0 ? ` (متأخر ${arabicDays(item.daysOverdue, ArabicCase.Oblique)})` : ""),
  );
  const enLines = ordered.map(
    (item) =>
      `• ${item.reference ?? "Prior balance"} — due ${item.dueDate} — ${formatMoneyLabel(item.amount, statement.currency)}` +
      (item.daysOverdue > 0 ? ` (${item.daysOverdue} days overdue)` : ""),
  );
  const company = statement.companyName.trim();
  const ar = [
    `السادة ${statement.customerName}،`,
    "",
    `كشف حساب بالبنود المفتوحة حتى ${statement.asOfDate}:`,
    ...(arLines.length > 0 ? arLines : ["لا توجد بنود مفتوحة."]),
    "",
    `الرصيد المستحق: ${formatMoneyLabel(statement.balance, currencyLabelAr(statement.currency))}`,
    `منه متأخر: ${formatMoneyLabel(overdue, currencyLabelAr(statement.currency))}`,
    ...(company ? ["", company] : []),
  ].join("\n");
  const en = [
    `Dear ${statement.customerName},`,
    "",
    `Open-item statement as of ${statement.asOfDate}:`,
    ...(enLines.length > 0 ? enLines : ["No open items."]),
    "",
    `Balance due: ${formatMoneyLabel(statement.balance, statement.currency)}`,
    `Of which overdue: ${formatMoneyLabel(overdue, statement.currency)}`,
    ...(company ? ["", company] : []),
  ].join("\n");
  return {
    subject: `كشف حساب حتى ${statement.asOfDate}${company ? ` — ${company}` : ""} | Statement of account`,
    body: `${ar}\n\n— — —\n\n${en}`,
  };
}

describe("#129 the statement email follows the tenant's subject and body template", () => {
  it("the shipped default template reproduces the statement text sent before templates existed", () => {
    for (const companyName of ["ميزان للتجارة", ""]) {
      expect(renderOpenItemStatement(input({ companyName }))).toEqual(statementBeforeTemplates(input({ companyName })));
      const empty = input({ companyName, items: [], balance: Money.zero() });
      expect(renderOpenItemStatement(empty)).toEqual(statementBeforeTemplates(empty));
    }
    expect(renderOpenItemStatement(input(), { subject: DEFAULT_STATEMENT_EMAIL_SUBJECT, body: DEFAULT_STATEMENT_EMAIL_BODY })).toEqual(statementBeforeTemplates(input()));
    expect(DEFAULT_SETTINGS.emailTemplateSubject).toBe(DEFAULT_STATEMENT_EMAIL_SUBJECT);
    expect(DEFAULT_SETTINGS.emailTemplateBody).toBe(DEFAULT_STATEMENT_EMAIL_BODY);
  });

  it("fills the placeholders the statement knows", () => {
    const rendered = renderOpenItemStatement(input(), {
      subject: "كشف {{customerName}} من {{companyName}}",
      body: "الرصيد {{balanceDue}} — المتأخر {{overdueAmount}} — حتى {{asOfDate}}\n{{openItems}}",
    });
    expect(rendered.subject).toBe("كشف شركة النور من ميزان للتجارة");
    expect(rendered.body).toContain("الرصيد 1,550.50 ج.م — المتأخر 1,250.50 ج.م — حتى 2026-10-28");
    expect(rendered.body).toContain("• INV-7 — استحقاق 2026-09-01");
  });

  it("a placeholder inside a customer's name is printed, never expanded", () => {
    const rendered = renderOpenItemStatement(input({ customerName: "{{balanceDue}}" }), { subject: "{{customerName}}", body: "{{customerName}}" });
    expect(rendered.body).toBe("{{balanceDue}}");
  });

  it("a token naming no placeholder renders empty, even one the object prototype carries", () => {
    expect(renderOpenItemStatement(input(), { subject: "x{{constructor}}{{toString}}{{unknown}}", body: "{{__proto__}}." }).body).toBe(".");
  });

  it("a line break in a value cannot reach the subject line", () => {
    const rendered = renderOpenItemStatement(input({ customerName: "x\r\nBcc: victim@example.com" }), { subject: "كشف {{customerName}}", body: "{{customerName}}" });
    expect(rendered.subject).not.toMatch(/[\r\n]/);
    expect(rendered.subject).toBe("كشف x Bcc: victim@example.com");
  });

  it("a blank template falls back to the default rather than sending an empty mail", () => {
    expect(renderOpenItemStatement(input(), { subject: "  ", body: "" })).toEqual(renderOpenItemStatement(input()));
  });
});

describe("#129 sender and template settings refuse header injection", () => {
  const refused = (patch: Parameters<typeof updateSettings>[1]) => {
    try {
      updateSettings(DEFAULT_SETTINGS, patch);
    } catch (err) {
      return err instanceof InvalidSettingsError ? err.message : String(err);
    }
    return null;
  };

  it("refuses a CR or LF in the sender display name", () => {
    expect(refused({ smtpFromName: "Mezan\r\nBcc: x@example.com" })).not.toBeNull();
    expect(refused({ smtpFromName: "Mezan\nX" })).not.toBeNull();
    expect(refused({ smtpFromName: "ميزان للتجارة" })).toBeNull();
  });

  it("refuses a CR or LF in the sender address and in the subject template", () => {
    expect(refused({ smtpFromEmail: "a@b.com\r\nBcc: x@example.com" })).not.toBeNull();
    expect(refused({ emailTemplateSubject: "كشف\r\nBcc: x@example.com" })).not.toBeNull();
  });

  it("#118 the over-receipt tolerance takes at most two decimals, inside 0..100", () => {
    expect(refused({ overReceiptTolerancePercent: 12.5 })).toBeNull();
    expect(refused({ overReceiptTolerancePercent: 0.25 })).toBeNull();
    expect(refused({ overReceiptTolerancePercent: 0.004 })).not.toBeNull();
    expect(refused({ overReceiptTolerancePercent: 100.5 })).not.toBeNull();
    expect(refused({ overReceiptTolerancePercent: -1 })).not.toBeNull();
  });

  it("keeps line breaks in the body template", () => {
    expect(refused({ emailTemplateBody: "سطر\nسطر" })).toBeNull();
  });
});
