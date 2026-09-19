import type { Money } from "../money/index.js";
import type { MappedStatementRow } from "./csv.js";

export enum StatementFileFormat {
  Ofx = "ofx",
  Mt940 = "mt940",
}

export interface ParsedStatementRow extends MappedStatementRow {
  readonly counterparty: string | null;
}

export interface ParsedStatementFile {
  readonly rows: readonly ParsedStatementRow[];
  readonly openingBalance: Money | null;
  readonly closingBalance: Money | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly accountNumber: string | null;
  readonly currency: string | null;
  readonly statementNumber: string | null;
}

export function normalizeDecimal(raw: string): string {
  let value = raw.trim().replace(/\s/g, "");
  let negative = false;
  if (value.startsWith("(") && value.endsWith(")")) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > lastDot) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else {
    value = value.replace(/,/g, "");
  }
  if (value.endsWith(".")) value = value.slice(0, -1);
  if (value.startsWith(".")) value = `0${value}`;
  return `${negative ? "-" : ""}${value}`;
}
