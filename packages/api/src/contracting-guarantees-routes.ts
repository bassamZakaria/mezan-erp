import { postingRefusalResponse } from "./posting-refusal.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { readReversalRequest, reversalRefusalResponse } from "./document-reversal.js";
import {
  GuaranteeAmountExceedsValueError,
  GuaranteeBankAccountInvalidError,
  GuaranteeChargeAccountNotFoundError,
  GuaranteeNotDraftError,
  GuaranteeNotFoundError,
  GuaranteeNothingToReverseError,
  GuaranteePostingFromDocumentError,
  GuaranteeService,
  InvalidGuaranteeError,
  InvalidGuaranteeTransitionError,
  Money,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  VatPeriodAlreadyFiledError,
  computeGuaranteeSummary,
  daysToExpiry,
  derivedGuaranteeStatus,
  isExpiringWithin,
  type GuaranteeServiceDeps,
  type GuaranteeSummary,
  type LetterOfGuarantee,
  type Project,
  type ProjectRepository,
  type TreasuryAccount,
  type TreasuryAccountRepository,
} from "@mezan/domain";
import {
  callGuaranteeSchema,
  createGuaranteeSchema,
  reduceGuaranteeSchema,
  releaseGuaranteeSchema,
  updateGuaranteeSchema,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

/**
 * خطابات الضمان — the register, its bank-facility report and the four status
 * moves that post to the ledger (design §05).
 *
 * PERMISSIONS: the register has its OWN three codes, not the treasury's.
 * `treasury.cash_voucher.create` is held by the cashier at the counter, and it
 * was letting that person release a performance bond — the employer's entire
 * security on the job — and forfeit it, backdated and unlogged. Releasing or
 * calling a letter is separated from issuing and reducing one, because giving
 * the ceiling away is a different act from using it.
 */
const VIEW = "contracting.guarantee.view";
const WRITE = "contracting.guarantee.manage";
const RELEASE = "contracting.guarantee.release";

export interface ContractingGuaranteesRoutesDeps extends GuaranteeServiceDeps {
  /** Treasury accounts in full, for the facility limits the summary reports. */
  readonly treasuryAccountsList: Pick<TreasuryAccountRepository, "list">;
  /** Project names for the by-project breakdown. Omitted, the rows fall back to ids. */
  readonly projectsList?: Pick<ProjectRepository, "list">;
}

function serialize(guarantee: LetterOfGuarantee, today: string) {
  return {
    id: guarantee.id,
    docNo: guarantee.docNo,
    kind: guarantee.kind,
    projectId: guarantee.projectId,
    contractId: guarantee.contractId,
    tenderRef: guarantee.tenderRef,
    beneficiaryNameAr: guarantee.beneficiaryNameAr,
    bankTreasuryAccountId: guarantee.bankTreasuryAccountId,
    bankNameAr: guarantee.bankNameAr,
    faceValue: guarantee.faceValue.toString(),
    percentOfContract: guarantee.percentOfContract,
    cashMarginPercent: guarantee.cashMarginPercent,
    cashMarginAmount: guarantee.cashMarginAmount.toString(),
    issueDate: guarantee.issueDate,
    expiryDate: guarantee.expiryDate,
    status: guarantee.status,
    derivedStatus: derivedGuaranteeStatus(guarantee, today),
    daysToExpiry: daysToExpiry(guarantee, today),
    currentValue: guarantee.currentValue.toString(),
    reductions: guarantee.reductions.map((r) => ({
      date: r.date,
      amount: r.amount.toString(),
      reason: r.reason,
      sourceRef: r.sourceRef,
      userId: r.userId,
    })),
    restorations: guarantee.restorations.map((r) => ({
      date: r.date,
      amount: r.amount.toString(),
      reason: r.reason,
      sourceRef: r.sourceRef,
      userId: r.userId,
    })),
    closedDate: guarantee.closedDate,
    closedBy: guarantee.closedBy,
    closedAmount: guarantee.closedAmount.toString(),
    notes: guarantee.notes,
  };
}

/** WHO is acting — stamped on the row and named in the audit trail. */
function actorId(c: Context): string {
  return getAuthContext(c)?.userId ?? "anonymous";
}

function serializeSummary(summary: GuaranteeSummary) {
  return {
    asOfDate: summary.asOfDate,
    totalOutstanding: summary.totalOutstanding.toString(),
    restrictedCash: summary.restrictedCash.toString(),
    totalFacilityLimit: summary.totalFacilityLimit.toString(),
    totalAvailable: summary.totalAvailable.toString(),
    expiringWithin30Days: summary.expiringWithin30Days,
    byBank: summary.byBank.map((b) => ({
      bankTreasuryAccountId: b.bankTreasuryAccountId,
      bankNameAr: b.bankNameAr,
      outstanding: b.outstanding.toString(),
      restrictedCash: b.restrictedCash.toString(),
      facilityLimit: b.facilityLimit === null ? null : b.facilityLimit.toString(),
      available: b.available === null ? null : b.available.toString(),
      count: b.count,
    })),
    byProject: summary.byProject.map((p) => ({
      projectId: p.projectId,
      projectNameAr: p.projectNameAr,
      outstanding: p.outstanding.toString(),
      restrictedCash: p.restrictedCash.toString(),
      count: p.count,
    })),
  };
}

function handleDomainError(c: Context, err: unknown) {
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof GuaranteeNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof GuaranteeChargeAccountNotFoundError) {
    return c.json({ error: err.code, message: err.message, accountId: err.accountId }, 422);
  }
  if (err instanceof InvalidGuaranteeError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof GuaranteeBankAccountInvalidError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof GuaranteeAmountExceedsValueError) {
    return c.json({ error: err.code, message: err.message, requested: err.requested, available: err.available }, 422);
  }
  if (err instanceof GuaranteeNotDraftError) {
    return c.json({ error: err.code, message: err.message, status: err.status }, 409);
  }
  if (err instanceof GuaranteeNothingToReverseError || err instanceof GuaranteePostingFromDocumentError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  const reversalRefusal = reversalRefusalResponse(c, err);
  if (reversalRefusal) return reversalRefusal;
  if (err instanceof InvalidGuaranteeTransitionError) {
    return c.json({ error: err.code, message: err.message, from: err.from, to: err.to }, 409);
  }
  // A closed month is a refusal the accountant has to read, never a 500.
  if (err instanceof PeriodNotOpenForPostingError || err instanceof NoFiscalPeriodForDateError) {
    return c.json({ error: "FISCAL_PERIOD_CLOSED", message: err.message }, 409);
  }
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: "VAT_PERIOD_FILED", message: err.message }, 409);
  }
  throw err;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createContractingGuaranteesRoutes(
  deps: ContractingGuaranteesRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = new GuaranteeService(deps);

  async function summaryFor(horizonDays: number): Promise<GuaranteeSummary> {
    const [guarantees, banks, projects] = await Promise.all([
      deps.guarantees.list(),
      deps.treasuryAccountsList.list() as Promise<TreasuryAccount[]>,
      (deps.projectsList?.list() ?? Promise.resolve([])) as Promise<Project[]>,
    ]);
    return computeGuaranteeSummary(guarantees, banks, projects, service.asOf(), horizonDays);
  }

  app.get("/summary", gate(VIEW), async (c) => {
    const horizon = positiveInt(c.req.query("expiringWithinDays"), 30);
    return c.json(serializeSummary(await summaryFor(horizon)));
  });

  app.get("/expiring", gate(VIEW), async (c) => {
    const days = positiveInt(c.req.query("days"), 30);
    const today = service.asOf();
    const rows = (await deps.guarantees.list()).filter((g) => isExpiringWithin(g, today, days));
    rows.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    return c.json(rows.map((g) => serialize(g, today)));
  });

  app.get("/", gate(VIEW), async (c) => {
    const today = service.asOf();
    const projectId = c.req.query("projectId");
    const status = c.req.query("status");
    const expiringWithinDays = c.req.query("expiringWithinDays");
    let rows = await deps.guarantees.list();
    if (projectId) rows = rows.filter((g) => g.projectId === projectId);
    if (status) {
      // Filtering on «منتهي» means the DERIVED status — an expired letter
      // still carries its stored `active`/`reduced` until it is released.
      rows = rows.filter((g) => (status === "expired" ? derivedGuaranteeStatus(g, today) === "expired" : g.status === status));
    }
    if (expiringWithinDays !== undefined) {
      const days = positiveInt(expiringWithinDays, 30);
      rows = rows.filter((g) => isExpiringWithin(g, today, days));
    }
    return c.json(rows.map((g) => serialize(g, today)));
  });

  app.post("/", gate(WRITE), async (c) => {
    const parsed = createGuaranteeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const body = parsed.data;
      const guarantee = await service.createDraft({
        id: body.id,
        kind: body.kind,
        projectId: body.projectId ?? null,
        contractId: body.contractId ?? null,
        tenderRef: body.tenderRef ?? null,
        beneficiaryNameAr: body.beneficiaryNameAr,
        bankTreasuryAccountId: body.bankTreasuryAccountId,
        faceValue: Money.fromMajor(body.faceValue),
        percentOfContract: body.percentOfContract ?? null,
        cashMarginPercent: body.cashMarginPercent,
        cashMarginAmount: body.cashMarginAmount !== undefined ? Money.fromMajor(body.cashMarginAmount) : undefined,
        issueDate: body.issueDate,
        expiryDate: body.expiryDate,
        notes: body.notes ?? null,
      });
      return c.json(serialize(guarantee, service.asOf()), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate(VIEW), async (c) => {
    const guarantee = await service.find(c.req.param("id"));
    if (!guarantee) return c.json({ error: "GUARANTEE_NOT_FOUND", message: "خطاب الضمان غير موجود." }, 404);
    return c.json(serialize(guarantee, service.asOf()));
  });

  app.patch("/:id", gate(WRITE), async (c) => {
    const parsed = updateGuaranteeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const existing = await service.find(c.req.param("id"));
    if (!existing) return c.json({ error: "GUARANTEE_NOT_FOUND", message: "خطاب الضمان غير موجود." }, 404);
    try {
      const body = parsed.data;
      const guarantee = await service.updateDraft(existing.id, {
        kind: body.kind,
        projectId: body.projectId,
        contractId: body.contractId,
        tenderRef: body.tenderRef,
        beneficiaryNameAr: body.beneficiaryNameAr,
        bankTreasuryAccountId: body.bankTreasuryAccountId,
        faceValue: body.faceValue !== undefined ? Money.fromMajor(body.faceValue) : undefined,
        percentOfContract: body.percentOfContract,
        cashMarginPercent: body.cashMarginPercent,
        cashMarginAmount: body.cashMarginAmount !== undefined ? Money.fromMajor(body.cashMarginAmount) : undefined,
        issueDate: body.issueDate,
        expiryDate: body.expiryDate,
        notes: body.notes,
      });
      return c.json(serialize(guarantee, service.asOf()));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  async function act(c: Context, run: (id: string) => Promise<LetterOfGuarantee>): Promise<Response> {
    const existing = await service.find(c.req.param("id") ?? "");
    if (!existing) return c.json({ error: "GUARANTEE_NOT_FOUND", message: "خطاب الضمان غير موجود." }, 404);
    try {
      return c.json(serialize(await run(existing.id), service.asOf()));
    } catch (err) {
      return handleDomainError(c, err);
    }
  }

  app.post("/:id/issue", gate(WRITE), (c) => act(c, (id) => service.issue(id, { userId: actorId(c) })));

  app.post("/:id/reduce", gate(WRITE), async (c) => {
    const parsed = reduceGuaranteeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const body = parsed.data;
    return act(c, (id) =>
      service.reduce(id, {
        date: body.date,
        amount: Money.fromMajor(body.amount),
        reason: body.reason,
        sourceRef: body.sourceRef ?? null,
        userId: actorId(c),
      }),
    );
  });

  app.post("/:id/release", gate(RELEASE), async (c) => {
    const parsed = releaseGuaranteeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const body = parsed.data;
    return act(c, (id) => service.release(id, { date: body.date, userId: actorId(c) }));
  });

  app.post("/:id/call", gate(RELEASE), async (c) => {
    const parsed = callGuaranteeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const body = parsed.data;
    return act(c, (id) =>
      service.call(id, {
        date: body.date,
        amount: body.amount !== undefined ? Money.fromMajor(body.amount) : undefined,
        chargeAccountId: body.chargeAccountId ?? null,
        userId: actorId(c),
      }),
    );
  });

  app.post("/:id/reverse-last", gate(RELEASE), async (c) => {
    const { date, memo } = await readReversalRequest(c);
    return act(c, (id) => service.reverseLastPosting(id, { reversalId: randomUUID(), date, memo, userId: actorId(c) }));
  });

  return app;
}
