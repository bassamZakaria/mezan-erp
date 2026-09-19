import { Money } from "../money/index.js";
import { InvalidStatementFileError } from "./errors.js";
import { normalizeDecimal, type ParsedStatementFile, type ParsedStatementRow } from "./statement-file.js";

interface Field {
  readonly tag: string;
  readonly value: string;
}

function fieldsOf(raw: string): Field[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = /\{4:\s*\n?([\s\S]*?)\n?-\}/.exec(text);
  const lines = (body ? body[1] ?? "" : text).split("\n");
  const fields: { tag: string; value: string[] }[] = [];
  for (const line of lines) {
    const match = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (match) {
      fields.push({ tag: match[1]!, value: [match[2] ?? ""] });
    } else if (fields.length > 0 && line.trim() !== "" && line.trim() !== "-") {
      fields[fields.length - 1]!.value.push(line);
    }
  }
  return fields.map((f) => ({ tag: f.tag, value: f.value.join("\n") }));
}

function swiftDate(yymmdd: string, field: string): string {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(yymmdd);
  if (!match) {
    throw new InvalidStatementFileError(`تاريخ MT940 غير صالح في ${field}: "${yymmdd}".`, `Invalid MT940 date in ${field}: "${yymmdd}".`);
  }
  const yy = Number.parseInt(match[1]!, 10);
  const year = yy < 80 ? 2000 + yy : 1900 + yy;
  return `${year}-${match[2]}-${match[3]}`;
}

function swiftAmount(raw: string, field: string): Money {
  try {
    return Money.fromMajor(normalizeDecimal(raw));
  } catch {
    throw new InvalidStatementFileError(`مبلغ MT940 غير صالح في ${field}: "${raw}".`, `Invalid MT940 amount in ${field}: "${raw}".`);
  }
}

function balance(value: string, field: string): { date: string; amount: Money; currency: string } {
  const match = /^([CD])(\d{6})([A-Z]{3})([\d,.]+)/.exec(value.trim());
  if (!match) {
    throw new InvalidStatementFileError(`رصيد MT940 غير صالح في ${field}: "${value}".`, `Invalid MT940 balance in ${field}: "${value}".`);
  }
  const amount = swiftAmount(match[4]!, field);
  return { date: swiftDate(match[2]!, field), amount: match[1] === "D" ? amount.negate() : amount, currency: match[3]! };
}

function counterpartyFrom86(info: string): string | null {
  const structured = [...info.matchAll(/\?3[23]([^?]*)/g)].map((m) => (m[1] ?? "").replace(/\n/g, "").trim());
  if (structured.length > 0) return structured.join(" ").trim() || null;
  const named = /(?:\/NAME\/|NAME:)([^/\n]+)/i.exec(info);
  return named ? named[1]!.trim() : null;
}

function describe86(info: string): string {
  if (/\?\d{2}/.test(info)) {
    const parts = [...info.matchAll(/\?2\d([^?]*)/g)].map((m) => (m[1] ?? "").replace(/\n/g, "").trim());
    const joined = parts.join(" ").trim();
    if (joined !== "") return joined;
  }
  return info.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

export function parseMt940(raw: string): ParsedStatementFile {
  const fields = fieldsOf(raw);
  if (!fields.some((f) => f.tag === "61" || f.tag.startsWith("60"))) {
    throw new InvalidStatementFileError(
      "الملف ليس كشف MT940 (لا يحتوي على الحقلين :60F: أو :61:).",
      "The file is not an MT940 statement (no :60F: or :61: field).",
    );
  }

  let opening: { date: string; amount: Money; currency: string } | null = null;
  let closing: { date: string; amount: Money; currency: string } | null = null;
  let accountNumber: string | null = null;
  let statementNumber: string | null = null;
  const rows: ParsedStatementRow[] = [];
  let pending: { date: string; amount: Money; reference: string | null; supplementary: string } | null = null;

  const flush = (info: string | null) => {
    if (!pending) return;
    const description = info ? describe86(info) : pending.supplementary;
    rows.push({
      date: pending.date,
      description: description !== "" ? description : pending.supplementary,
      reference: pending.reference,
      amount: pending.amount,
      counterparty: info ? counterpartyFrom86(info) : null,
    });
    pending = null;
  };

  fields.forEach((field, index) => {
    const label = `:${field.tag}: #${index + 1}`;
    if (field.tag === "25") {
      accountNumber = accountNumber ?? (field.value.trim() || null);
    } else if (field.tag === "28C" || field.tag === "28") {
      statementNumber = statementNumber ?? (field.value.trim() || null);
    } else if (field.tag.startsWith("60")) {
      flush(null);
      opening = opening ?? balance(field.value, label);
    } else if (field.tag.startsWith("62")) {
      flush(null);
      closing = balance(field.value, label);
    } else if (field.tag === "61") {
      flush(null);
      const [first = "", ...rest] = field.value.split("\n");
      const match = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]+)([A-Z])([A-Z0-9]{3})(.*)$/.exec(first.trim());
      if (!match) {
        throw new InvalidStatementFileError(`سطر حركة MT940 غير صالح ${label}: "${first}".`, `Invalid MT940 statement line ${label}: "${first}".`);
      }
      const mark = match[3]!;
      const magnitude = swiftAmount(match[5]!, label);
      const debit = mark === "D" || mark === "RC";
      const tail = match[8] ?? "";
      const [customerRef = "", bankRef = ""] = tail.split("//");
      const reference = customerRef.trim() !== "" && customerRef.trim().toUpperCase() !== "NONREF" ? customerRef.trim() : bankRef.trim() || null;
      pending = {
        date: swiftDate(match[1]!, label),
        amount: debit ? magnitude.negate() : magnitude,
        reference,
        supplementary: rest.join(" ").trim() || `${match[6]}${match[7]}`,
      };
    } else if (field.tag === "86") {
      flush(field.value);
    }
  });
  flush(null);

  const first = rows[0]?.date ?? null;
  const last = rows.reduce<string | null>((max, r) => (max === null || r.date > max ? r.date : max), null);
  const earliest = rows.reduce<string | null>((min, r) => (min === null || r.date < min ? r.date : min), first);
  const open = opening as { date: string; amount: Money; currency: string } | null;
  const close = closing as { date: string; amount: Money; currency: string } | null;
  return {
    rows,
    openingBalance: open?.amount ?? null,
    closingBalance: close?.amount ?? null,
    periodStart: earliest ?? open?.date ?? null,
    periodEnd: close?.date ?? last,
    accountNumber,
    currency: open?.currency ?? close?.currency ?? null,
    statementNumber,
  };
}
