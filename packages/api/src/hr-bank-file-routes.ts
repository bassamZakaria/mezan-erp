import { createHash } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import {
  BANK_FILE_LAYOUTS,
  BankFileCurrencyError,
  BankFileEmptyError,
  BankFileExceptionReason,
  BankFileFormat,
  BankFileRunNotPayableError,
  BankFileTotalsMismatchError,
  buildBankFile,
  fullNameAr,
  fullNameEn,
  maskIban,
  recordSensitiveEvent,
  type AuditSink,
  type BankFile,
  type BankFileEmployee,
  type EmployeeRepository,
  type PayrollRunRepository,
  type PayslipRepository,
  type TreasuryAccount,
} from "@mezan/domain";
import { BankFileExceptionReasonDTO, BankFileFormatDTO, bankFileRequestSchema, type BankFileExportDTO, type BankFileLayoutDTO, type BankFilePreviewDTO } from "@mezan/contracts";
import { getAuthContext } from "./permission-gate.js";
import { tenantToday } from "./tenant-day.js";

export interface BankFileRoutesDeps {
  readonly runs: PayrollRunRepository;
  readonly payslips: PayslipRepository;
  readonly employees: EmployeeRepository;
  readonly treasuryAccounts?: { findById(id: string): Promise<TreasuryAccount | null> };
  readonly audit?: AuditSink;
}

type Gate = (permission: string) => MiddlewareHandler;

export const BANK_FILE_PERMISSION = "hr.payroll.bank_file";

const FORMAT_FROM_WIRE: Record<BankFileFormatDTO, BankFileFormat> = {
  [BankFileFormatDTO.GenericCsv]: BankFileFormat.GenericCsv,
  [BankFileFormatDTO.EgyptBulkTransfer]: BankFileFormat.EgyptBulkTransfer,
};

const FORMAT_TO_WIRE: Record<BankFileFormat, BankFileFormatDTO> = {
  [BankFileFormat.GenericCsv]: BankFileFormatDTO.GenericCsv,
  [BankFileFormat.EgyptBulkTransfer]: BankFileFormatDTO.EgyptBulkTransfer,
};

const REASON_TO_WIRE: Record<BankFileExceptionReason, BankFileExceptionReasonDTO> = {
  [BankFileExceptionReason.PaidInCash]: BankFileExceptionReasonDTO.PaidInCash,
  [BankFileExceptionReason.PaidByCheque]: BankFileExceptionReasonDTO.PaidByCheque,
  [BankFileExceptionReason.NoPaymentMethod]: BankFileExceptionReasonDTO.NoPaymentMethod,
  [BankFileExceptionReason.NoBankAccount]: BankFileExceptionReasonDTO.NoBankAccount,
  [BankFileExceptionReason.InvalidIban]: BankFileExceptionReasonDTO.InvalidIban,
  [BankFileExceptionReason.NonPositiveNet]: BankFileExceptionReasonDTO.NonPositiveNet,
  [BankFileExceptionReason.SubPiasterNet]: BankFileExceptionReasonDTO.SubPiasterNet,
  [BankFileExceptionReason.EmployeeMissing]: BankFileExceptionReasonDTO.EmployeeMissing,
};

function withMessageEn(err: { readonly code: string; readonly message: string; readonly messageEn?: string }) {
  return { error: err.code, message: err.message, ...(err.messageEn ? { messageEn: err.messageEn } : {}) };
}

function refusal(c: Context, err: unknown): Response | null {
  if (err instanceof BankFileRunNotPayableError || err instanceof BankFileEmptyError) return c.json(withMessageEn(err), 409);
  if (err instanceof BankFileTotalsMismatchError || err instanceof BankFileCurrencyError) return c.json(withMessageEn(err), 422);
  return null;
}

function serializeLayouts(): BankFileLayoutDTO[] {
  return Object.values(BANK_FILE_LAYOUTS).map((layout) => ({
    format: FORMAT_TO_WIRE[layout.format],
    labelAr: layout.labelAr,
    labelEn: layout.labelEn,
    descriptionAr: layout.descriptionAr,
    currencies: layout.currencies ? [...layout.currencies] : null,
    verified: layout.verified,
    columns: layout.columns.map((c) => c.title),
  }));
}

function serializePreview(runId: string, file: BankFile): BankFilePreviewDTO {
  return {
    runId,
    format: FORMAT_TO_WIRE[file.format],
    verified: file.verified,
    valueDate: file.valueDate,
    currency: file.currency,
    lines: file.lines.map((l) => ({
      sequence: l.sequence,
      employeeId: l.employeeId,
      employeeCode: l.employeeCode,
      nameAr: l.nameAr,
      nameLatin: l.nameLatin,
      ibanMasked: maskIban(l.iban),
      amount: l.amount.toString(),
      reference: l.reference,
    })),
    exceptions: file.exceptions.map((e) => ({
      employeeId: e.employeeId,
      employeeCode: e.employeeCode,
      nameAr: e.nameAr,
      amount: e.amount.toString(),
      reason: REASON_TO_WIRE[e.reason],
    })),
    totals: {
      runNet: file.totals.runNet.toString(),
      bankTotal: file.totals.bankTotal.toString(),
      exceptionsTotal: file.totals.exceptionsTotal.toString(),
      lineCount: file.totals.lineCount,
      exceptionCount: file.totals.exceptionCount,
    },
  };
}

/** Mounted inside the payroll router; every path here is under `/payroll`. */
export function mountBankFileRoutes(app: Hono, deps: BankFileRoutesDeps, gate: Gate): void {
  async function build(c: Context, format: BankFileFormat, valueDate: string | undefined, treasuryAccountId: string | null | undefined): Promise<BankFile | Response> {
    const run = await deps.runs.findById(c.req.param("id") ?? "");
    if (!run) return c.json({ error: "PAYROLL_RUN_NOT_FOUND", message: "مسير الرواتب غير موجود.", messageEn: "The payroll run was not found." }, 404);
    let debitAccount: string | null = null;
    if (treasuryAccountId) {
      const account = await deps.treasuryAccounts?.findById(treasuryAccountId);
      if (!account || account.type !== "bank") {
        return c.json(
          { error: "BANK_FILE_DEBIT_ACCOUNT_INVALID", message: "اختر حساب خزينة بنكيًا يُخصم منه التحويل.", messageEn: "Choose a bank treasury account to debit the transfer from." },
          422,
        );
      }
      debitAccount = account.bankAccountNumber;
    }
    const [payslips, employees] = await Promise.all([deps.payslips.listByRunId(run.id), deps.employees.list()]);
    const byId = new Map<string, BankFileEmployee>(
      employees.map((e) => [
        e.id,
        { id: e.id, code: e.code, nameAr: fullNameAr(e), nameLatin: fullNameEn(e), salaryPaymentMethod: e.salaryPaymentMethod, bankAccount: e.bankAccount },
      ]),
    );
    try {
      return buildBankFile({ run, payslips, employees: byId, format, valueDate: valueDate ?? (await tenantToday(c)), debitAccount });
    } catch (err) {
      const refused = refusal(c, err);
      if (refused) return refused;
      throw err;
    }
  }

  app.get("/payroll/bank-file/layouts", gate("hr.payroll.view"), (c) => c.json(serializeLayouts()));

  app.get("/payroll/runs/:id/bank-file/preview", gate(BANK_FILE_PERMISSION), async (c) => {
    const parsed = bankFileRequestSchema.safeParse({
      format: c.req.query("format") ?? BankFileFormatDTO.GenericCsv,
      valueDate: c.req.query("valueDate") || undefined,
      treasuryAccountId: c.req.query("treasuryAccountId") || undefined,
    });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const built = await build(c, FORMAT_FROM_WIRE[parsed.data.format], parsed.data.valueDate, parsed.data.treasuryAccountId);
    if (built instanceof Response) return built;
    return c.json(serializePreview(c.req.param("id"), built));
  });

  app.post("/payroll/runs/:id/bank-file", gate(BANK_FILE_PERMISSION), async (c) => {
    const parsed = bankFileRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const built = await build(c, FORMAT_FROM_WIRE[parsed.data.format], parsed.data.valueDate, parsed.data.treasuryAccountId);
    if (built instanceof Response) return built;
    if (built.lines.length === 0) {
      const empty = new BankFileEmptyError();
      return c.json(withMessageEn(empty), 409);
    }
    const sha256 = createHash("sha256").update(built.content, "utf8").digest("hex");
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: "hr",
        entityType: "PAYROLL_RUN",
        entityId: c.req.param("id"),
        action: "BANK_FILE_EXPORTED",
        actor: getAuthContext(c)?.userId ?? "system",
        severity: "WARNING",
        details: {
          format: built.format,
          valueDate: built.valueDate,
          lineCount: built.totals.lineCount,
          bankTotal: built.totals.bankTotal.toString(),
          exceptionCount: built.totals.exceptionCount,
          exceptionsTotal: built.totals.exceptionsTotal.toString(),
          runNet: built.totals.runNet.toString(),
          treasuryAccountId: parsed.data.treasuryAccountId ?? null,
          sha256,
        },
      });
    }
    const body: BankFileExportDTO = { ...serializePreview(c.req.param("id"), built), fileName: built.fileName, mimeType: built.mimeType, content: built.content, sha256 };
    return c.json(body);
  });
}
