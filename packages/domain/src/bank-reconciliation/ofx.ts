import { Money } from "../money/index.js";
import { InvalidStatementFileError } from "./errors.js";
import { normalizeDecimal, type ParsedStatementFile, type ParsedStatementRow } from "./statement-file.js";

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function block(source: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(source);
  return match ? (match[1] ?? "") : null;
}

function blocks(source: string, tag: string): string[] {
  const found: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) found.push(match[1] ?? "");
  return found;
}

function leaf(source: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(source);
  if (!match) return null;
  const value = decodeEntities((match[1] ?? "").trim());
  return value === "" ? null : value;
}

function ofxDate(raw: string | null, field: string): string | null {
  if (raw === null) return null;
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!match) {
    throw new InvalidStatementFileError(`تاريخ OFX غير صالح في ${field}: "${raw}".`, `Invalid OFX date in ${field}: "${raw}".`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function ofxAmount(raw: string | null, field: string): Money {
  if (raw === null) {
    throw new InvalidStatementFileError(`حقل المبلغ ${field} مفقود في ملف OFX.`, `The OFX amount field ${field} is missing.`);
  }
  try {
    return Money.fromMajor(normalizeDecimal(raw));
  } catch {
    throw new InvalidStatementFileError(`مبلغ OFX غير صالح في ${field}: "${raw}".`, `Invalid OFX amount in ${field}: "${raw}".`);
  }
}

export function parseOfx(raw: string): ParsedStatementFile {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!/<OFX>/i.test(text)) {
    throw new InvalidStatementFileError("الملف ليس ملف OFX (لا يحتوي على الوسم <OFX>).", "The file is not an OFX file (no <OFX> tag).");
  }
  const statement = block(text, "STMTRS") ?? block(text, "CCSTMTRS") ?? text;
  const tranList = block(statement, "BANKTRANLIST") ?? statement;
  const account = block(statement, "BANKACCTFROM") ?? block(statement, "CCACCTFROM");
  const ledgerBal = block(statement, "LEDGERBAL");

  const rows: ParsedStatementRow[] = blocks(tranList, "STMTTRN").map((trn, index) => {
    const date = ofxDate(leaf(trn, "DTPOSTED"), `STMTTRN #${index + 1} DTPOSTED`);
    if (date === null) {
      throw new InvalidStatementFileError(
        `الحركة رقم ${index + 1} في ملف OFX بلا تاريخ (DTPOSTED).`,
        `OFX transaction #${index + 1} has no posting date (DTPOSTED).`,
      );
    }
    const payee = block(trn, "PAYEE");
    const name = leaf(trn, "NAME") ?? (payee ? leaf(payee, "NAME") : null);
    const memo = leaf(trn, "MEMO");
    return {
      date,
      description: memo ?? name ?? leaf(trn, "TRNTYPE") ?? "",
      reference: leaf(trn, "CHECKNUM") ?? leaf(trn, "REFNUM") ?? leaf(trn, "FITID"),
      amount: ofxAmount(leaf(trn, "TRNAMT"), `STMTTRN #${index + 1} TRNAMT`),
      counterparty: name,
    };
  });

  return {
    rows,
    openingBalance: null,
    closingBalance: ledgerBal ? ofxAmount(leaf(ledgerBal, "BALAMT"), "LEDGERBAL") : null,
    periodStart: ofxDate(leaf(tranList, "DTSTART"), "DTSTART"),
    periodEnd: ofxDate(leaf(tranList, "DTEND"), "DTEND"),
    accountNumber: account ? leaf(account, "ACCTID") : null,
    currency: leaf(statement, "CURDEF"),
    statementNumber: null,
  };
}
