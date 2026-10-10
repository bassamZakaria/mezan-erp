import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  AccountNotFoundError,
  HeaderAccountNotPostableError,
  InactiveAccountError,
  InvalidJournalEntryError,
  InvalidJournalPartyError,
  InvalidRecurringJournalScheduleError,
  JournalEntryNotFoundError,
  Money,
  NoFiscalPeriodForDateError,
  PartyRequiredOnControlAccountError,
  PeriodNotOpenForPostingError,
  RecurringJournalPeriodAlreadyGeneratedError,
  RecurringJournalPeriodAlreadySkippedError,
  RecurringJournalTemplateNotFoundError,
  RecurringJournalTemplateStatus,
  UnbalancedEntryError,
  type RecurringJournalFrequency,
  type RecurringJournalSkip,
  createRecurringJournalTemplate,
  dueDepreciationPeriods,
  duePeriods,
  generateDueRecurringJournals,
  setRecurringJournalTemplateStatus,
  skipRecurringJournalOccurrence,
  updateRecurringJournalTemplate,
  type AccountRepository,
  type AuditSink,
  type FiscalPeriodRepository,
  type GlEventPublisher,
  type JournalPostingDeps,
  type LedgerRepository,
  type NextNumberService,
  type PartyControlKind,
  type RecurringJournalRunRepository,
  type RecurringJournalSkipRepository,
  type RecurringJournalTemplate,
  type RecurringJournalTemplateLine,
  type RecurringJournalTemplateRepository,
} from "@mezan/domain";
import {
  createRecurringJournalTemplateSchema,
  generateDueRecurringJournalsSchema,
  saveJournalEntryAsTemplateSchema,
  setRecurringJournalTemplateStatusSchema,
  skipRecurringJournalOccurrenceSchema,
  updateRecurringJournalTemplateSchema,
  type RecurringJournalFrequencyDTO,
  type RecurringJournalTemplateStatusDTO,
} from "@mezan/contracts";
import { tenantDay, tenantToday } from "./tenant-day.js";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { refuseOutOfScopeBranches } from "./branch-scope-refusal.js";

export interface RecurringJournalRoutesDeps {
  readonly templates: RecurringJournalTemplateRepository;
  readonly runs: RecurringJournalRunRepository;
  readonly skips: RecurringJournalSkipRepository;
  readonly ledger: LedgerRepository;
  readonly accounts: Pick<AccountRepository, "findById">;
  readonly periods: Pick<FiscalPeriodRepository, "findByDate">;
  readonly numbering: NextNumberService;
  readonly resolvePartyControlAccounts?: () => Promise<ReadonlyMap<string, PartyControlKind>>;
  readonly partyExists?: JournalPostingDeps["partyExists"];
  readonly projects?: JournalPostingDeps["projects"];
  readonly projectRequiredAccountIds?: JournalPostingDeps["projectRequiredAccountIds"];
  readonly audit?: AuditSink;
  readonly events?: GlEventPublisher;
  readonly now?: () => string;
  readonly idGen?: () => string;
  /** Backs the "due depreciation runs" panel — a cross-reference, not a second depreciation engine. */
  readonly dueDepreciation?: {
    readonly hasDepreciableAssets: () => Promise<boolean>;
    readonly hasRunForPeriod: (period: string) => Promise<boolean>;
  };
}

function serializeLine(line: RecurringJournalTemplateLine) {
  return {
    accountId: line.accountId,
    debit: line.debit.toString(),
    credit: line.credit.toString(),
    memo: line.memo ?? null,
    costCenterId: line.costCenterId ?? null,
    branchId: line.branchId ?? null,
    partyId: line.partyId ?? null,
    projectId: line.projectId ?? null,
    costCategory: line.costCategory ?? null,
  };
}

function serializeSkip(skip: RecurringJournalSkip) {
  return {
    id: skip.id,
    templateId: skip.templateId,
    period: skip.period,
    note: skip.note,
    skippedAt: skip.skippedAt,
    skippedBy: skip.skippedBy,
  };
}

function serializeTemplate(template: RecurringJournalTemplate) {
  return {
    id: template.id,
    nameAr: template.nameAr,
    nameEn: template.nameEn,
    memo: template.memo,
    frequency: template.frequency,
    dayOfPeriod: template.dayOfPeriod,
    yearlyMonth: template.yearlyMonth,
    startDate: template.startDate,
    endDate: template.endDate,
    autoReverseNextPeriod: template.autoReverseNextPeriod,
    status: template.status,
    lines: template.lines.map(serializeLine),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

/**
 * The wire enums (`@mezan/contracts`) and the domain enums share the exact
 * same string values by construction (contracts must not depend on the
 * domain — `money-string.ts`), but TS enums are nominal, so the boundary
 * needs an explicit — cheap — re-tag rather than a value conversion.
 */
function toDomainFrequency(value: RecurringJournalFrequencyDTO): RecurringJournalFrequency {
  return value as unknown as RecurringJournalFrequency;
}
function toDomainStatus(value: RecurringJournalTemplateStatusDTO): RecurringJournalTemplateStatus {
  return value as unknown as RecurringJournalTemplateStatus;
}

function parseLine(line: { accountId: string; debit: string; credit: string; memo?: string | null; costCenterId?: string | null; branchId?: string | null; partyId?: string | null; projectId?: string | null; costCategory?: RecurringJournalTemplateLine["costCategory"] }): RecurringJournalTemplateLine {
  return {
    accountId: line.accountId,
    debit: Money.fromMajor(line.debit),
    credit: Money.fromMajor(line.credit),
    memo: line.memo ?? null,
    costCenterId: line.costCenterId ?? null,
    branchId: line.branchId ?? null,
    partyId: line.partyId ?? null,
    projectId: line.projectId ?? null,
    costCategory: line.costCategory ?? null,
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof RecurringJournalTemplateNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof JournalEntryNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidRecurringJournalScheduleError || err instanceof InvalidJournalEntryError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof RecurringJournalPeriodAlreadyGeneratedError || err instanceof RecurringJournalPeriodAlreadySkippedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof UnbalancedEntryError) {
    return c.json({ error: err.code, message: err.message, totalDebit: err.totalDebit.toString(), totalCredit: err.totalCredit.toString() }, 422);
  }
  if (err instanceof PartyRequiredOnControlAccountError || err instanceof InvalidJournalPartyError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, accountId: err.accountId }, 422);
  }
  if (
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * `/gl/recurring` — templates, the due worklist, idempotent generation and
 * history (ENH-E2-02). Draft-only: `generate-due` creates journal ENTRIES
 * through the same `createJournalEntry` a hand-written journal uses, so every
 * D205/D226/period-lock invariant the GL engine already enforces applies here
 * unchanged.
 */
export function createRecurringJournalRoutes(deps: RecurringJournalRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  async function postingDeps(c: Context): Promise<JournalPostingDeps> {
    return {
      ledger: deps.ledger,
      accounts: deps.accounts,
      periods: deps.periods,
      numbering: deps.numbering,
      projects: deps.projects,
      projectRequiredAccountIds: deps.projectRequiredAccountIds,
      partyControlAccounts: await deps.resolvePartyControlAccounts?.(),
      partyExists: deps.partyExists,
      audit: deps.audit,
      events: deps.events,
      now: deps.now,
      actor: getAuthContext(c)?.userId ?? "system",
    };
  }

  app.get("/templates", gate("accounting.recurring.view"), async (c) => {
    return c.json((await deps.templates.list()).map(serializeTemplate));
  });

  app.get("/templates/:id", gate("accounting.recurring.view"), async (c) => {
    const template = await deps.templates.findById(c.req.param("id"));
    if (!template) return c.json({ error: "RECURRING_JOURNAL_TEMPLATE_NOT_FOUND" }, 404);
    return c.json(serializeTemplate(template));
  });

  app.get("/templates/:id/runs", gate("accounting.recurring.view"), async (c) => {
    return c.json(await deps.runs.listByTemplate(c.req.param("id")));
  });

  app.post("/templates", gate("accounting.recurring.manage"), async (c) => {
    const parsed = createRecurringJournalTemplateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const branchRefusal = refuseOutOfScopeBranches(c, parsed.data.lines.map((line) => line.branchId));
    if (branchRefusal) return branchRefusal;
    try {
      const template = await createRecurringJournalTemplate(
        {
          id: parsed.data.id,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn ?? null,
          memo: parsed.data.memo,
          frequency: toDomainFrequency(parsed.data.frequency),
          dayOfPeriod: parsed.data.dayOfPeriod,
          yearlyMonth: parsed.data.yearlyMonth,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          autoReverseNextPeriod: parsed.data.autoReverseNextPeriod,
          lines: parsed.data.lines.map(parseLine),
        },
        { templates: deps.templates, accounts: deps.accounts, partyControlAccounts: await deps.resolvePartyControlAccounts?.(), partyExists: deps.partyExists, now: deps.now },
      );
      return c.json(serializeTemplate(template), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/templates/:id", gate("accounting.recurring.manage"), async (c) => {
    const parsed = updateRecurringJournalTemplateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const branchRefusal = refuseOutOfScopeBranches(c, parsed.data.lines.map((line) => line.branchId));
    if (branchRefusal) return branchRefusal;
    try {
      const template = await updateRecurringJournalTemplate(
        c.req.param("id"),
        {
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn ?? null,
          memo: parsed.data.memo,
          frequency: toDomainFrequency(parsed.data.frequency),
          dayOfPeriod: parsed.data.dayOfPeriod,
          yearlyMonth: parsed.data.yearlyMonth,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          autoReverseNextPeriod: parsed.data.autoReverseNextPeriod,
          lines: parsed.data.lines.map(parseLine),
        },
        { templates: deps.templates, accounts: deps.accounts, partyControlAccounts: await deps.resolvePartyControlAccounts?.(), partyExists: deps.partyExists, now: deps.now },
      );
      return c.json(serializeTemplate(template));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/templates/:id/status", gate("accounting.recurring.manage"), async (c) => {
    const parsed = setRecurringJournalTemplateStatusSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const template = await setRecurringJournalTemplateStatus(c.req.param("id"), toDomainStatus(parsed.data.status), {
        templates: deps.templates,
        now: deps.now,
      });
      return c.json(serializeTemplate(template));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * "Save as template" on JournalsScreen: the schedule is asked for, the
   * lines come straight off the entry already on the ledger — never re-typed.
   */
  app.post("/templates/from-entry/:entryId", gate("accounting.recurring.manage"), async (c) => {
    const parsed = saveJournalEntryAsTemplateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const entry = await deps.ledger.findById(c.req.param("entryId"));
    if (!entry) return c.json({ error: "JOURNAL_ENTRY_NOT_FOUND" }, 404);
    try {
      const template = await createRecurringJournalTemplate(
        {
          id: parsed.data.id,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn ?? null,
          memo: entry.memo,
          frequency: toDomainFrequency(parsed.data.frequency),
          dayOfPeriod: parsed.data.dayOfPeriod,
          yearlyMonth: parsed.data.yearlyMonth,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          autoReverseNextPeriod: parsed.data.autoReverseNextPeriod,
          lines: entry.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo ?? null,
            costCenterId: l.costCenterId ?? null,
            branchId: l.branchId ?? null,
            partyId: l.partyId ?? null,
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
          })),
        },
        { templates: deps.templates, accounts: deps.accounts, partyControlAccounts: await deps.resolvePartyControlAccounts?.(), partyExists: deps.partyExists, now: deps.now },
      );
      return c.json(serializeTemplate(template), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /** The worklist: every active template's outstanding periods as of `asOfDate` (default: today) — a skipped period is not outstanding. */
  app.get("/due", gate("accounting.recurring.view"), async (c) => {
    const asOfDate = await tenantDay(c, c.req.query("asOfDate")) ?? (await tenantToday(c, deps.now));
    const templates = await deps.templates.list();
    const due: { templateId: string; nameAr: string; nameEn: string | null; periods: string[] }[] = [];
    for (const template of templates) {
      if (template.status !== RecurringJournalTemplateStatus.Active) continue;
      const outstanding: string[] = [];
      for (const period of duePeriods(template, asOfDate)) {
        if (await deps.runs.findByTemplateAndPeriod(template.id, period)) continue;
        if (await deps.skips.findByTemplateAndPeriod(template.id, period)) continue;
        outstanding.push(period);
      }
      if (outstanding.length > 0) due.push({ templateId: template.id, nameAr: template.nameAr, nameEn: template.nameEn, periods: outstanding });
    }
    return c.json({ asOfDate, due });
  });

  app.post("/generate-due", gate("accounting.recurring.manage"), async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = generateDueRecurringJournalsSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const asOfDate = parsed.data.asOfDate ? await tenantDay(c, parsed.data.asOfDate) : await tenantToday(c, deps.now);
      const { generated, failed } = await generateDueRecurringJournals(
        { ...(await postingDeps(c)), templates: deps.templates, runs: deps.runs, skips: deps.skips, idGen },
        { asOfDate, templateIds: parsed.data.templateIds },
      );
      return c.json({ asOfDate, generated, failed }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/runs", gate("accounting.recurring.view"), async (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    return c.json(await deps.runs.list(Number.isFinite(limit) ? limit : undefined));
  });

  /**
   * "Skip this occurrence" — the operator's answer to a period they never
   * want drafted (a waived rent month, a depreciation run handled by hand).
   * Refuses a period a run already covers (409) and a period already skipped
   * (409, the atomic claim losing a race); both are reported, never silently
   * swallowed, so a double-click never reads as success twice.
   */
  app.post("/templates/:id/skip", gate("accounting.recurring.manage"), async (c) => {
    const parsed = skipRecurringJournalOccurrenceSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const skip = await skipRecurringJournalOccurrence(
        c.req.param("id"),
        parsed.data.period,
        parsed.data.note ?? null,
        {
          templates: deps.templates,
          runs: deps.runs,
          skips: deps.skips,
          audit: deps.audit,
          now: deps.now,
          actor: getAuthContext(c)?.userId ?? "system",
          idGen,
        },
      );
      return c.json(serializeSkip(skip), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/templates/:id/skips", gate("accounting.recurring.view"), async (c) => {
    return c.json((await deps.skips.listByTemplate(c.req.param("id"))).map(serializeSkip));
  });

  app.get("/skips", gate("accounting.recurring.view"), async (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    return c.json((await deps.skips.list(Number.isFinite(limit) ? limit : undefined)).map(serializeSkip));
  });

  /** Due depreciation runs, cross-linked into DepreciationRunsScreen — not a second depreciation engine. */
  app.get("/depreciation-due", gate("accounting.recurring.view"), async (c) => {
    if (!deps.dueDepreciation) return c.json({ periods: [] });
    const asOfDate = await tenantToday(c, deps.now);
    const periods = await dueDepreciationPeriods(deps.dueDepreciation, asOfDate);
    return c.json({ periods });
  });

  return app;
}
