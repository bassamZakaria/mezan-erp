import type { PosPaymentMethod } from "./payment-method.js";

export const POS_TERMINAL_KINDS = ["retail", "restaurant"] as const;
export type PosTerminalKind = (typeof POS_TERMINAL_KINDS)[number];

export const POS_PRINTER_KINDS = ["system", "escpos-tcp"] as const;
export type PosPrinterKind = (typeof POS_PRINTER_KINDS)[number];

export const POS_PAPER_WIDTHS = [58, 80] as const;
export type PosPaperWidth = (typeof POS_PAPER_WIDTHS)[number];

export const DEFAULT_ESCPOS_PORT = 9100;

export interface PosPrinterConfig {
  readonly kind: PosPrinterKind;
  /** `system`: the OS printer name (null = the default printer). `escpos-tcp`: `host:port`. */
  readonly address: string | null;
  readonly paperWidthMm: PosPaperWidth;
}

export interface PosTerminalMethod {
  readonly methodId: string;
  /** Null = the method's own default account; always null for cash (the drawer) and on-account. */
  readonly treasuryAccountId: string | null;
}

export interface PosTerminal {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly kind: PosTerminalKind;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly drawerTreasuryAccountId: string;
  readonly methods: readonly PosTerminalMethod[];
  readonly defaultMethodId: string;
  readonly printer: PosPrinterConfig;
  /**
   * DEC-25: the e-receipt regime registers a DEVICE, so the serial and the POS
   * credentials belong to the terminal; null falls back to the branch mapping.
   */
  readonly etaDeviceSerial: string | null;
  readonly etaPosClientId: string | null;
  /** `pososversion` / `posmodelframework`: sent as headers with every receipt from this device. */
  readonly etaPosOsVersion: string | null;
  readonly etaPosModelFramework: string | null;
  /** The sealed secret and pre-shared key are write-only; these flags are all that is ever read back. */
  readonly hasEtaPosClientSecret: boolean;
  readonly hasEtaPosPresharedKey: boolean;
  readonly active: boolean;
  /** Advanced only by the receipt counter in the store, never by a caller. */
  readonly lastReceiptSeq: number;
}

export class InvalidPosTerminalError extends Error {
  readonly code = "INVALID_POS_TERMINAL";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidPosTerminalError";
  }
}

export interface PosTerminalInput {
  readonly code: string;
  readonly name: string;
  readonly nameEn?: string | null;
  readonly kind?: PosTerminalKind;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly drawerTreasuryAccountId: string;
  readonly methods: readonly PosTerminalMethod[];
  readonly defaultMethodId: string;
  readonly printer?: PosPrinterConfig;
  readonly etaDeviceSerial?: string | null;
  readonly etaPosClientId?: string | null;
  readonly etaPosOsVersion?: string | null;
  readonly etaPosModelFramework?: string | null;
  readonly active?: boolean;
}

const CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;
const SERIAL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** `tcp://192.168.1.100` / `192.168.1.100:9100` → `192.168.1.100:9100`, or null when it is not an address. */
export function normalizeEscposAddress(raw: string): string | null {
  const stripped = raw.trim().replace(/^tcp:\/\//i, "");
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(stripped);
  if (!match) return null;
  const host = match[1] ?? "";
  const port = match[2] === undefined ? DEFAULT_ESCPOS_PORT : Number.parseInt(match[2], 10);
  if (!HOST_PATTERN.test(host) || port < 1 || port > 65535) return null;
  return `${host}:${port}`;
}

function normalizePrinter(printer: PosPrinterConfig | undefined, reasons: string[]): PosPrinterConfig {
  const config = printer ?? { kind: "system", address: null, paperWidthMm: 80 };
  if (!POS_PRINTER_KINDS.includes(config.kind)) reasons.push("نوع الطابعة غير معروف");
  if (!POS_PAPER_WIDTHS.includes(config.paperWidthMm)) reasons.push("عرض ورق الإيصال 58 أو 80 مم فقط");
  const address = blankToNull(config.address);
  if (config.kind === "escpos-tcp") {
    if (address === null) {
      reasons.push("طابعة الشبكة تحتاج عنوانها، مثل 192.168.1.100:9100");
      return { ...config, address: null };
    }
    const normalized = normalizeEscposAddress(address);
    if (normalized === null) reasons.push("عنوان طابعة الشبكة غير صالح — اكتبه بالشكل 192.168.1.100:9100");
    return { ...config, address: normalized ?? address };
  }
  if (address !== null && address.length > 120) reasons.push("اسم طابعة النظام أطول من اللازم");
  return { ...config, address };
}

/** Builds a terminal from its input, checking only what needs no other record. */
export function buildPosTerminal(id: string, input: PosTerminalInput, current?: PosTerminal): PosTerminal {
  const reasons: string[] = [];
  const code = input.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) reasons.push("كود الجهاز حروف لاتينية كبيرة وأرقام فقط (حتى 20 حرفاً)، مثل POS-001");
  if (input.name.trim() === "") reasons.push("اسم الجهاز مطلوب");
  const kind = input.kind ?? current?.kind ?? "retail";
  if (!POS_TERMINAL_KINDS.includes(kind)) reasons.push("نوع الجهاز غير معروف");
  if (input.branchId.trim() === "") reasons.push("الفرع مطلوب");
  if (input.warehouseId.trim() === "") reasons.push("المستودع مطلوب");
  if (input.drawerTreasuryAccountId.trim() === "") reasons.push("حساب الدرج النقدي مطلوب");

  const seen = new Set<string>();
  for (const method of input.methods) {
    if (seen.has(method.methodId)) reasons.push("طريقة الدفع مكررة على الجهاز");
    seen.add(method.methodId);
  }
  if (input.methods.length === 0) reasons.push("فعّل طريقة دفع واحدة على الأقل");
  if (!seen.has(input.defaultMethodId)) reasons.push("طريقة الدفع الافتراضية يجب أن تكون من الطرق المفعّلة على الجهاز");

  const etaDeviceSerial = blankToNull(input.etaDeviceSerial);
  if (etaDeviceSerial !== null && !SERIAL_PATTERN.test(etaDeviceSerial)) {
    reasons.push("الرقم التسلسلي لجهاز نقطة البيع حروف لاتينية وأرقام فقط");
  }
  const etaPosClientId = blankToNull(input.etaPosClientId);
  const etaPosOsVersion = blankToNull(input.etaPosOsVersion);
  const etaPosModelFramework = blankToNull(input.etaPosModelFramework);
  if ((etaPosClientId ?? etaPosOsVersion ?? etaPosModelFramework) !== null && etaDeviceSerial === null) {
    reasons.push("بيانات جهاز الفاتورة الإلكترونية لا تُسجَّل إلا مع الرقم التسلسلي للجهاز");
  }

  const printer = normalizePrinter(input.printer ?? current?.printer, reasons);
  if (reasons.length > 0) throw new InvalidPosTerminalError(reasons);
  const sameDevice = etaDeviceSerial !== null && current?.etaDeviceSerial === etaDeviceSerial;

  return {
    id,
    code,
    name: input.name.trim(),
    nameEn: blankToNull(input.nameEn),
    kind,
    branchId: input.branchId,
    warehouseId: input.warehouseId,
    drawerTreasuryAccountId: input.drawerTreasuryAccountId,
    methods: input.methods.map((m) => ({ methodId: m.methodId, treasuryAccountId: blankToNull(m.treasuryAccountId) })),
    defaultMethodId: input.defaultMethodId,
    printer,
    etaDeviceSerial,
    etaPosClientId,
    etaPosOsVersion,
    etaPosModelFramework,
    // The credentials belong to one device: a new serial drops the stored secrets (the store does the same).
    hasEtaPosClientSecret: sameDevice && (current?.hasEtaPosClientSecret ?? false),
    hasEtaPosPresharedKey: sameDevice && (current?.hasEtaPosPresharedKey ?? false),
    active: input.active ?? current?.active ?? true,
    lastReceiptSeq: current?.lastReceiptSeq ?? 0,
  };
}

export interface PosTerminalReferenceAccount {
  readonly id: string;
  readonly type: "cash" | "bank";
  readonly branchId: string | null;
  readonly status: "active" | "inactive";
}

/** Everything a terminal points at, resolved by the caller from the real records. */
export interface PosTerminalReferences {
  readonly branchExists: boolean;
  readonly warehouse: { readonly branchId: string; readonly active: boolean } | null;
  readonly accounts: ReadonlyMap<string, PosTerminalReferenceAccount>;
  readonly methods: ReadonlyMap<string, PosPaymentMethod>;
  /** Codes of OTHER active terminals already counting cash into this drawer. */
  readonly drawerSharedWith: readonly string[];
  /** Code of another terminal registered under the same ETA device serial, if any. */
  readonly serialTakenBy: string | null;
}

/**
 * The account a method's tenders land in on this terminal: the drawer for
 * cash, nothing for on-account, else the terminal's own choice or the
 * method's default.
 */
export function resolveTerminalMethodAccount(
  terminal: Pick<PosTerminal, "drawerTreasuryAccountId">,
  entry: PosTerminalMethod,
  method: PosPaymentMethod,
): string | null {
  if (method.kind === "cash") return terminal.drawerTreasuryAccountId;
  if (method.kind === "on_account") return null;
  return entry.treasuryAccountId ?? method.defaultTreasuryAccountId;
}

export function assertPosTerminalReferences(terminal: PosTerminal, refs: PosTerminalReferences): void {
  const reasons: string[] = [];
  if (!refs.branchExists) reasons.push("الفرع المحدد غير موجود");
  if (!refs.warehouse) reasons.push("المستودع المحدد غير موجود");
  else {
    if (refs.warehouse.branchId !== terminal.branchId) reasons.push("المستودع لا يتبع فرع الجهاز");
    if (!refs.warehouse.active) reasons.push("المستودع المحدد غير نشط");
  }

  const drawer = refs.accounts.get(terminal.drawerTreasuryAccountId);
  if (!drawer) reasons.push("حساب الدرج النقدي غير موجود");
  else {
    if (drawer.type !== "cash") reasons.push("حساب الدرج لازم يكون حساب نقدي — تُقفل عليه جرد الوردية");
    if (drawer.branchId !== terminal.branchId) reasons.push("حساب الدرج لا يتبع فرع الجهاز");
    if (drawer.status !== "active") reasons.push("حساب الدرج غير نشط");
  }
  if (terminal.active && refs.drawerSharedWith.length > 0) {
    reasons.push(`الدرج مستخدم على جهاز نشط آخر (${refs.drawerSharedWith.join("، ")}) — لكل جهاز درج مستقل حتى يُطابَق نقد كل وردية`);
  }

  for (const entry of terminal.methods) {
    const method = refs.methods.get(entry.methodId);
    if (!method) {
      reasons.push("طريقة دفع غير موجودة");
      continue;
    }
    if (!method.active) reasons.push(`طريقة الدفع «${method.nameAr}» معطّلة`);
    if ((method.kind === "cash" || method.kind === "on_account") && entry.treasuryAccountId !== null) {
      reasons.push(
        method.kind === "cash"
          ? "الدفع النقدي يدخل درج الجهاز نفسه — لا يُختار له حساب آخر"
          : "البيع الآجل لا يُربط بحساب خزينة",
      );
      continue;
    }
    const accountId = resolveTerminalMethodAccount(terminal, entry, method);
    if (method.kind === "cash" || method.kind === "on_account") continue;
    if (accountId === null) {
      reasons.push(`حدد الحساب الذي تستقبل عليه «${method.nameAr}» — لا يوجد له حساب افتراضي`);
      continue;
    }
    const account = refs.accounts.get(accountId);
    if (!account) reasons.push(`حساب «${method.nameAr}» غير موجود`);
    else {
      if (account.status !== "active") reasons.push(`حساب «${method.nameAr}» غير نشط`);
      if (method.accountType !== null && account.type !== method.accountType) {
        reasons.push(`«${method.nameAr}» تستقبل على حساب ${method.accountType === "bank" ? "بنكي" : "نقدي"} فقط`);
      }
      // A bank account may be central (the acquirer settles to one company account); a cash box may not.
      if (account.type === "cash" && account.branchId !== terminal.branchId) {
        reasons.push(`«${method.nameAr}» تستقبل على خزينة نقدية من فرع آخر — اختر خزينة من فرع الجهاز`);
      }
      if (accountId === terminal.drawerTreasuryAccountId) {
        reasons.push(`«${method.nameAr}» لا تُحصَّل في درج النقدية — وإلا زاد النقد المتوقع عند إقفال الوردية`);
      }
    }
  }

  if (refs.serialTakenBy !== null) {
    reasons.push(`الرقم التسلسلي مسجَّل بالفعل على الجهاز ${refs.serialTakenBy} — لكل جهاز رقمه لدى المصلحة`);
  }
  if (reasons.length > 0) throw new InvalidPosTerminalError(reasons);
}

export interface BranchEtaDevice {
  readonly deviceSerialNumber: string | null;
  readonly posClientId: string | null;
  readonly hasPosClientSecret: boolean;
  readonly posOsVersion?: string | null;
  readonly posModelFramework?: string | null;
  readonly hasPosPresharedKey?: boolean;
}

export interface EffectiveEtaDevice {
  readonly source: "terminal" | "branch";
  readonly serial: string;
  readonly posClientId: string | null;
  readonly hasSecret: boolean;
  /** All four device headers plus the token credentials — the transmit leg sends nothing without them. */
  readonly complete: boolean;
}

/** DEC-25: the terminal's own device, else the branch's, else none. */
export function effectiveEtaDevice(terminal: PosTerminal, branch: BranchEtaDevice | null): EffectiveEtaDevice | null {
  if (terminal.etaDeviceSerial !== null) {
    return {
      source: "terminal",
      serial: terminal.etaDeviceSerial,
      posClientId: terminal.etaPosClientId,
      hasSecret: terminal.hasEtaPosClientSecret,
      complete:
        terminal.etaPosClientId !== null &&
        terminal.hasEtaPosClientSecret &&
        terminal.etaPosOsVersion !== null &&
        terminal.etaPosModelFramework !== null &&
        terminal.hasEtaPosPresharedKey,
    };
  }
  if (branch?.deviceSerialNumber) {
    return {
      source: "branch",
      serial: branch.deviceSerialNumber,
      posClientId: branch.posClientId,
      hasSecret: branch.hasPosClientSecret,
      complete:
        !!branch.posClientId &&
        branch.hasPosClientSecret &&
        !!branch.posOsVersion &&
        !!branch.posModelFramework &&
        branch.hasPosPresharedKey === true,
    };
  }
  return null;
}

export const POS_TERMINAL_ISSUES = ["inactive", "setup_broken", "eta_device_missing", "eta_credentials_missing"] as const;
export type PosTerminalIssue = (typeof POS_TERMINAL_ISSUES)[number];

/**
 * Readiness is computed on every read from the records as they are NOW: a
 * drawer or method disabled after the terminal was saved must turn it amber,
 * not leave the green it earned at its last save.
 */
export function posTerminalIssues(
  terminal: PosTerminal,
  branch: BranchEtaDevice | null,
  refs?: Pick<PosTerminalReferences, "accounts" | "methods">,
): PosTerminalIssue[] {
  const issues: PosTerminalIssue[] = [];
  if (!terminal.active) issues.push("inactive");
  if (refs && setupBroken(terminal, refs)) issues.push("setup_broken");
  const device = effectiveEtaDevice(terminal, branch);
  if (device === null) issues.push("eta_device_missing");
  else if (!device.complete) issues.push("eta_credentials_missing");
  return issues;
}

function setupBroken(terminal: PosTerminal, refs: Pick<PosTerminalReferences, "accounts" | "methods">): boolean {
  const drawer = refs.accounts.get(terminal.drawerTreasuryAccountId);
  if (!drawer || drawer.type !== "cash" || drawer.status !== "active") return true;
  const defaultMethod = refs.methods.get(terminal.defaultMethodId);
  if (!defaultMethod || !defaultMethod.active) return true;
  return terminal.methods.some((entry) => {
    const method = refs.methods.get(entry.methodId);
    if (!method || !method.active) return true;
    if (method.kind === "cash" || method.kind === "on_account") return false;
    const accountId = resolveTerminalMethodAccount(terminal, entry, method);
    const account = accountId === null ? undefined : refs.accounts.get(accountId);
    return !account || account.status !== "active";
  });
}
