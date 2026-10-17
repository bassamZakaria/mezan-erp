import { ScanCommandPrefix } from "./segments";

export enum ScanCommandKind {
  Empty = "empty",
  Barcode = "barcode",
  Multiplier = "multiplier",
  SetTotal = "set-total",
  Invalid = "invalid",
}

export type ScanCommand =
  | { readonly kind: ScanCommandKind.Empty }
  | { readonly kind: ScanCommandKind.Barcode; readonly barcode: string }
  | { readonly kind: ScanCommandKind.Multiplier; readonly qty: string }
  | { readonly kind: ScanCommandKind.SetTotal; readonly qty: string }
  | { readonly kind: ScanCommandKind.Invalid };

const QUANTITY = /^\d{1,9}(\.\d{1,6})?$/;
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

function latinDigits(value: string): string {
  return value.replace(ARABIC_DIGITS, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function isPositive(qty: string): boolean {
  return /[1-9]/.test(qty);
}

export function parseScanInput(raw: string): ScanCommand {
  const text = latinDigits(raw.trim());
  if (text === "") return { kind: ScanCommandKind.Empty };
  const prefix = text.charAt(0);
  if (prefix === ScanCommandPrefix.Multiplier || prefix === ScanCommandPrefix.SetTotal) {
    const qty = text.slice(1).trim();
    if (!QUANTITY.test(qty)) return { kind: ScanCommandKind.Invalid };
    if (prefix === ScanCommandPrefix.Multiplier) return isPositive(qty) ? { kind: ScanCommandKind.Multiplier, qty } : { kind: ScanCommandKind.Invalid };
    return { kind: ScanCommandKind.SetTotal, qty };
  }
  return { kind: ScanCommandKind.Barcode, barcode: text };
}

export function appendKeypadDigit(current: string, key: string): string {
  if (key === ".") return current.includes(".") ? current : current === "" ? "0." : `${current}.`;
  if (current === "0") return key;
  const next = `${current}${key}`;
  return QUANTITY.test(next) || /^\d{1,9}\.$/.test(next) ? next : current;
}
