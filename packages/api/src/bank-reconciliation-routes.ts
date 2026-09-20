import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  AccountNotFoundError,
  ApprovalRequestRejectedError,
  AuditChangeAction,
  BankReconciliationService,
  BankRuleDirection,
  BankRuleMatchType,
  BankRuleNotFoundError,
  BankStatementNotFoundError,
  BankStatementSource,
  CashBalanceWouldGoNegativeError,
  ColumnNotFoundError,
  DuplicateDocumentError,
  DuplicateStatementImportError,
  EntryAccountRequiredError,
  EntryAlreadyMatchedError,
  EntryDateBeforeLineError,
  EntryNotOnTreasuryAccountError,
  FinalizeOverrideReasonRequiredError,
  HeaderAccountNotPostableError,
  InactiveAccountError,
  InvalidBankRuleError,
  InvalidColumnMappingError,
  InvalidDocumentError,
  InvalidDocumentTransitionError,
  InvalidEntryAccountError,
  InvalidStatementBalanceError,
  InvalidStatementFileError,
  LineAlreadyMatchedError,
  LineNotMatchedError,
  LineNotOnStatementError,
  MatchAmountMismatchError,
  MatchCurrencyMismatchError,
  Money,
  NoEntriesSelectedError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  StatementAccountMismatchError,
  StatementAlreadyFinalizedError,
  StatementCurrencyMismatchError,
  StatementDifferenceNotZeroError,
  StatementFileFormat,
  StatementHasUnmatchedLinesError,
  StatementLineNotFoundError,
  StatementOutOfBranchScopeError,
  SuggestionNotFoundError,
  SuggestionNotPendingError,
  TreasuryAccountNumberMissingError,
  TreasuryAccountOutOfBranchScopeError,
  TreasuryAccountUnpostableError,
  UnbalancedEntryError,
  ZeroAmountLineError,
  type AuditSink,
  type BankRule,
  type BankRuleInput,
  type BankStatement,
  type BankReconciliationServiceDeps,
  type MatchedStatementLine,
  type ReconciliationPosition,
  type ReviewItem,
  type StatementLine,
  type TreasuryLedgerCandidate,
} from "@mezan/domain";
import {
  importBankStatementSchema,
  importStatementFileSchema,
  matchStatementLineSchema,
  matchManyEntriesSchema,
  createEntryFromLineSchema,
  finalizeStatementSchema,
  bankRuleInputSchema,
  addManualLineSchema,
  bankStatementListQuerySchema,
  StatementFileFormatCode,
  StatementSourceCode,
} from "@mezan/contracts";
import { branchScopeOf, callerRoleCodes, callerUserId, createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { recordAdminEvent, recordFieldChanges } from "./admin-audit.js";

export type BankReconciliationRoutesDeps = BankReconciliationServiceDeps & {
  /** Generates ids (statement id, statement-line id) when the request omits them. Defaults to a UUID. */
  readonly idGen?: () => string;
  readonly audit?: AuditSink;
};

const RULE_AUDIT_FIELDS = [
  "name",
  "treasuryAccountId",
  "pattern",
  "matchType",
  "direction",
  "accountId",
  "costCenterId",
  "priority",
  "active",
] as const satisfies readonly (keyof BankRule)[];

const ruleEntity = (id: string) => ({ module: "treasury", entityType: "bank_rule", entityId: id });

function asEnum<T extends string>(values: Record<string, T>, value: string): T {
  const found = Object.values(values).find((v) => v === value);
  if (found === undefined) throw new RangeError(`Unknown value "${value}"`);
  return found;
}

function money(value: Money | null): string | null {
  return value === null ? null : value.toString();
}

function serializeCandidate(c: TreasuryLedgerCandidate) {
  return {
    entryId: c.entryId,
    entryNo: c.entryNo,
    docNo: c.docNo ?? null,
    date: c.date,
    amount: c.amount.toString(),
    description: c.description,
    reference: c.reference ?? null,
    counterparty: c.counterparty ?? null,
    currency: c.currency ?? null,
    baseAmount: c.baseAmount ? c.baseAmount.toString() : null,
  };
}

function serializeRule(r: BankRule) {
  return {
    id: r.id,
    name: r.name,
    treasuryAccountId: r.treasuryAccountId,
    pattern: r.pattern,
    matchType: r.matchType,
    direction: r.direction,
    accountId: r.accountId,
    costCenterId: r.costCenterId,
    priority: r.priority,
    active: r.active,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function serializePosition(p: ReconciliationPosition) {
  return {
    openingBalance: p.openingBalance.toString(),
    closingBalance: p.closingBalance.toString(),
    clearedBalance: p.clearedBalance.toString(),
    difference: p.difference.toString(),
    statementLinesTotal: p.statementLinesTotal.toString(),
    statementArithmeticGap: p.statementArithmeticGap.toString(),
    unmatchedLines: { count: p.unmatchedLines.count, total: p.unmatchedLines.total.toString() },
    bookBalance: money(p.bookBalance),
    bookDifference: money(p.bookDifference),
    outstandingBook: {
      count: p.outstandingBook.count,
      total: p.outstandingBook.total.toString(),
      items: p.outstandingBook.items.map(serializeCandidate),
    },
    unexplainedBookDifference: money(p.unexplainedBookDifference),
  };
}

function serializeReviewItem(item: ReviewItem) {
  return {
    lineId: item.lineId,
    suggestions: item.suggestions.map(({ record, entries }) => ({
      id: record.id,
      lineId: record.lineId,
      entryIds: record.entryIds,
      entries: entries.map(serializeCandidate),
      score: record.score,
      amountScore: record.amountScore,
      dateScore: record.dateScore,
      referenceScore: record.referenceScore,
      counterpartyScore: record.counterpartyScore,
      dateDeltaDays: record.dateDeltaDays,
      status: record.status,
    })),
    rule: item.rule ? serializeRule(item.rule) : null,
  };
}

function serializeStatement(s: BankStatement) {
  return {
    id: s.id,
    treasuryAccountId: s.treasuryAccountId,
    branchId: s.branchId,
    currency: s.currency,
    source: s.source,
    statementNumber: s.statementNumber,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    openingBalance: s.openingBalance.toString(),
    closingBalance: s.closingBalance.toString(),
    status: s.status,
    importedAt: s.importedAt,
    finalizedAt: s.finalizedAt,
    unmatchedAtFinalize: s.unmatchedAtFinalize ?? null,
    finalizeOverrideReason: s.finalizeOverrideReason ?? null,
    finalizedBy: s.finalizedBy ?? null,
    differenceAtFinalize: s.differenceAtFinalize ? s.differenceAtFinalize.toString() : null,
  };
}

function serializeLine(l: MatchedStatementLine) {
  return {
    id: l.id,
    statementId: l.statementId,
    date: l.date,
    description: l.description,
    reference: l.reference,
    amount: l.amount.toString(),
    status: l.status,
    matchedEntryId: l.matchedEntryId,
    matchedEntryNo: l.matchedEntryNo,
    matchedAt: l.matchedAt,
    counterparty: l.counterparty ?? null,
    matchedEntryIds: l.matchedEntryIds ?? [],
    matchedEntryNos: l.matchedEntryNos,
    matchSource: l.matchSource ?? null,
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  const refuse = (e: Error & { code: string; messageEn?: string }, status: 403 | 404 | 409 | 422, extra: Record<string, unknown> = {}) =>
    c.json({ error: e.code, message: e.message, ...(e.messageEn ? { messageEn: e.messageEn } : {}), ...extra }, status);
  if (
    err instanceof BankStatementNotFoundError ||
    err instanceof StatementLineNotFoundError ||
    err instanceof SuggestionNotFoundError ||
    err instanceof BankRuleNotFoundError
  ) {
    return refuse(err, 404);
  }
  if (
    err instanceof LineAlreadyMatchedError ||
    err instanceof LineNotMatchedError ||
    err instanceof StatementAlreadyFinalizedError ||
    err instanceof EntryAlreadyMatchedError ||
    err instanceof SuggestionNotPendingError ||
    err instanceof DuplicateDocumentError ||
    err instanceof InvalidDocumentTransitionError ||
    err instanceof ApprovalRequestRejectedError
  ) {
    return refuse(err, 409);
  }
  if (err instanceof DuplicateStatementImportError) {
    return refuse(err, 409, { existingStatementId: err.existingStatementId, existingStatementNumber: err.existingStatementNumber });
  }
  if (err instanceof StatementOutOfBranchScopeError || err instanceof TreasuryAccountOutOfBranchScopeError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 403);
  }
  if (err instanceof StatementHasUnmatchedLinesError) {
    return refuse(err, 422, { unmatchedCount: err.unmatchedCount });
  }
  if (err instanceof StatementDifferenceNotZeroError) {
    return refuse(err, 422, { difference: err.difference });
  }
  if (
    err instanceof FinalizeOverrideReasonRequiredError ||
    err instanceof InvalidStatementFileError ||
    err instanceof ColumnNotFoundError ||
    err instanceof InvalidColumnMappingError ||
    err instanceof InvalidStatementBalanceError ||
    err instanceof LineNotOnStatementError ||
    err instanceof EntryNotOnTreasuryAccountError ||
    err instanceof MatchAmountMismatchError ||
    err instanceof MatchCurrencyMismatchError ||
    err instanceof StatementCurrencyMismatchError ||
    err instanceof StatementAccountMismatchError ||
    err instanceof TreasuryAccountNumberMissingError ||
    err instanceof NoEntriesSelectedError ||
    err instanceof InvalidBankRuleError ||
    err instanceof EntryAccountRequiredError ||
    err instanceof InvalidEntryAccountError ||
    err instanceof EntryDateBeforeLineError ||
    err instanceof ZeroAmountLineError ||
    err instanceof TreasuryAccountUnpostableError ||
    err instanceof CashBalanceWouldGoNegativeError ||
    err instanceof InvalidDocumentError ||
    err instanceof UnbalancedEntryError ||
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError
  ) {
    return refuse(err as Error & { code: string; messageEn?: string }, 422);
  }
  throw err;
}

function ruleInputOf(d: {
  name: string;
  treasuryAccountId: string | null;
  pattern: string;
  matchType: string;
  direction: string;
  accountId: string;
  costCenterId: string | null;
  priority: number;
  active: boolean;
}): BankRuleInput {
  return {
    name: d.name,
    treasuryAccountId: d.treasuryAccountId,
    pattern: d.pattern,
    matchType: asEnum(BankRuleMatchType, d.matchType),
    direction: asEnum(BankRuleDirection, d.direction),
    accountId: d.accountId,
    costCenterId: d.costCenterId,
    priority: d.priority,
    active: d.active,
  };
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) ?? {};
  } catch {
    return {};
  }
}

/**
 * Bank reconciliation routes (docs/archive/catalog/04 §"تسوية كشوف البنك"), mounted
 * under `/bank-statements`:
 *   GET    /bank-statements                                       list                         reconciliation.view
 *   GET    /bank-statements/rules                                 bank rules                   reconciliation.view
 *   POST   /bank-statements/rules                                 add a rule                   reconciliation.manage
 *   PUT    /bank-statements/rules/:ruleId                         edit a rule                  reconciliation.manage
 *   DELETE /bank-statements/rules/:ruleId                         delete a rule                reconciliation.manage
 *   GET    /bank-statements/:id                                   one + lines + position       reconciliation.view
 *   GET    /bank-statements/:id/review                            «للمراجعة» + position         reconciliation.view
 *   GET    /bank-statements/column-mapping/:accountId             the account's saved mapping  reconciliation.view
 *   GET    /bank-statements/:id/candidates                        matchable GL movements       reconciliation.view
 *   POST   /bank-statements/import                                import CSV / Excel-as-CSV    reconciliation.import
 *   POST   /bank-statements/import-file                           import OFX / MT940           reconciliation.import
 *   POST   /bank-statements/:id/auto-match                        score, suggest, apply ≥ 90   reconciliation.match
 *   POST   /bank-statements/:id/suggestions/:sid/accept           accept a suggestion          reconciliation.match
 *   POST   /bank-statements/:id/suggestions/:sid/reject           reject a suggestion          reconciliation.match
 *   POST   /bank-statements/:id/lines/:lineId/match               manual 1:1 match             reconciliation.match
 *   POST   /bank-statements/:id/lines/:lineId/match-many          1:N match (exact sum)        reconciliation.match
 *   POST   /bank-statements/:id/lines/:lineId/unmatch             manual unmatch               reconciliation.match
 *   POST   /bank-statements/:id/lines/:lineId/create-entry        book a charge / interest     reconciliation.post_entry
 *   POST   /bank-statements/:id/lines                             add a line the file missed   reconciliation.create
 *   POST   /bank-statements/:id/finalize                          lock the statement           reconciliation.finalize
 */
export function createBankReconciliationRoutes(
  deps: BankReconciliationRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  /**
   * One service per request, carrying the CALLER's own branch authority. A
   * single shared instance has no caller, so every statement of every branch
   * was reachable by anyone holding the permission.
   */
  const serviceFor = (c: Context): BankReconciliationService =>
    new BankReconciliationService({ ...deps, branchScope: branchScopeOf(c) });

  /**
   * Resolve one line's matched entry number. The routes that return a SINGLE
   * line carry it too, so the screen shows «القيد: JE-000038» the moment a
   * match is made rather than a UUID until the next full refetch.
   */
  const one = async (service: BankReconciliationService, line: StatementLine): Promise<MatchedStatementLine> =>
    (await service.withEntryNumbers([line]))[0] as MatchedStatementLine;

  const validation = (c: Context, error: { flatten(): unknown }) =>
    c.json({ error: "VALIDATION_ERROR", details: error.flatten() }, 400);

  app.get("/", gate("treasury.reconciliation.view"), async (c) => {
    const service = serviceFor(c);
    const parsed = bankStatementListQuerySchema.safeParse({
      treasuryAccountId: c.req.query("treasuryAccountId"),
      status: c.req.query("status"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) return validation(c, parsed.error);
    const rows = await service.listWithSummaries(parsed.data);
    return c.json(rows.map(({ statement, summary }) => ({ ...serializeStatement(statement), matchSummary: summary })));
  });

  app.get("/rules", gate("treasury.reconciliation.view"), async (c) => {
    const service = serviceFor(c);
    return c.json((await service.listRules()).map(serializeRule));
  });

  app.post("/rules", gate("treasury.reconciliation.manage"), async (c) => {
    const service = serviceFor(c);
    const parsed = bankRuleInputSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    try {
      const rule = await service.createRule(ruleInputOf(parsed.data), idGen());
      await recordFieldChanges(deps.audit, c, {
        entity: ruleEntity(rule.id),
        action: AuditChangeAction.Create,
        before: null,
        after: rule,
        fields: RULE_AUDIT_FIELDS,
      });
      return c.json(serializeRule(rule), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.put("/rules/:ruleId", gate("treasury.reconciliation.manage"), async (c) => {
    const service = serviceFor(c);
    const parsed = bankRuleInputSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    try {
      const before = (await service.listRules()).find((r) => r.id === c.req.param("ruleId")) ?? null;
      const rule = await service.updateRule(c.req.param("ruleId"), ruleInputOf(parsed.data));
      await recordFieldChanges(deps.audit, c, {
        entity: ruleEntity(rule.id),
        action: AuditChangeAction.Update,
        before,
        after: rule,
        fields: RULE_AUDIT_FIELDS,
        warnOn: ["accountId", "active"],
      });
      return c.json(serializeRule(rule));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/rules/:ruleId", gate("treasury.reconciliation.manage"), async (c) => {
    const service = serviceFor(c);
    try {
      const before = (await service.listRules()).find((r) => r.id === c.req.param("ruleId")) ?? null;
      await service.deleteRule(c.req.param("ruleId"));
      await recordAdminEvent(deps.audit, c, {
        ...ruleEntity(c.req.param("ruleId")),
        action: "DELETE",
        details: before ? { rule: serializeRule(before) } : null,
      });
      return c.json({ deleted: true });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/column-mapping/:treasuryAccountId", gate("treasury.reconciliation.view"), async (c) => {
    const service = serviceFor(c);
    const mapping = await service.getColumnMapping(c.req.param("treasuryAccountId"));
    if (!mapping) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(mapping);
  });

  /**
   * The treasury movements this statement's lines can be matched against.
   * Without it the manual-match control was a free-text box asking the user to
   * TYPE a journal-entry id: a field naming a domain entity that bound to no
   * entity, so a typo matched a line to an id that does not exist.
   */
  app.get("/:id/candidates", gate("treasury.reconciliation.view"), async (c) => {
    const service = serviceFor(c);
    try {
      const candidates = await service.matchCandidates(c.req.param("id"));
      return c.json(candidates.map(serializeCandidate));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id/review", gate("treasury.reconciliation.view"), async (c) => {
    const service = serviceFor(c);
    try {
      const id = c.req.param("id");
      const [position, items] = [await service.reconciliation(id), await service.review(id)];
      return c.json({ position: serializePosition(position), items: items.map(serializeReviewItem) });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate("treasury.reconciliation.view"), async (c) => {
    const service = serviceFor(c);
    const statement = await service.findById(c.req.param("id"));
    if (!statement) return c.json({ error: "NOT_FOUND" }, 404);
    const lines = await service.listLinesWithEntryNumbers(statement.id);
    const summary = await service.matchSummary(statement.id);
    const position = await service.reconciliation(statement.id);
    return c.json({
      ...serializeStatement(statement),
      lines: lines.map(serializeLine),
      matchSummary: summary,
      position: serializePosition(position),
    });
  });

  app.post("/import", gate("treasury.reconciliation.import"), async (c) => {
    const service = serviceFor(c);
    const parsed = importBankStatementSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    const d = parsed.data;
    try {
      const { statement, lines } = await service.importStatement({
        id: d.id ?? idGen(),
        treasuryAccountId: d.treasuryAccountId,
        rawCsv: d.rawCsv,
        mapping: {
          dateColumn: d.mapping.dateColumn,
          descriptionColumn: d.mapping.descriptionColumn,
          amountColumn: d.mapping.amountColumn ?? null,
          debitColumn: d.mapping.debitColumn ?? null,
          creditColumn: d.mapping.creditColumn ?? null,
          referenceColumn: d.mapping.referenceColumn ?? null,
          dateFormat: d.mapping.dateFormat ?? "YYYY-MM-DD",
        },
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        openingBalance: Money.fromMajor(d.openingBalance),
        closingBalance: Money.fromMajor(d.closingBalance),
        statementNumber: d.statementNumber ?? null,
        source: d.source === StatementSourceCode.Excel ? BankStatementSource.Excel : BankStatementSource.Csv,
      });
      const withNumbers = await service.withEntryNumbers(lines);
      return c.json({ ...serializeStatement(statement), lines: withNumbers.map(serializeLine) }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/import-file", gate("treasury.reconciliation.import"), async (c) => {
    const service = serviceFor(c);
    const parsed = importStatementFileSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    const d = parsed.data;
    try {
      const { statement, lines } = await service.importStatementFile({
        id: d.id ?? idGen(),
        treasuryAccountId: d.treasuryAccountId,
        format: d.format === StatementFileFormatCode.Ofx ? StatementFileFormat.Ofx : StatementFileFormat.Mt940,
        content: d.content,
        periodStart: d.periodStart ?? null,
        periodEnd: d.periodEnd ?? null,
        openingBalance: d.openingBalance ? Money.fromMajor(d.openingBalance) : null,
        closingBalance: d.closingBalance ? Money.fromMajor(d.closingBalance) : null,
        statementNumber: d.statementNumber ?? null,
      });
      const withNumbers = await service.withEntryNumbers(lines);
      return c.json({ ...serializeStatement(statement), lines: withNumbers.map(serializeLine) }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/auto-match", gate("treasury.reconciliation.match"), async (c) => {
    const service = serviceFor(c);
    try {
      return c.json(await service.autoMatch(c.req.param("id"), { actor: callerUserId(c) ?? null }));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/suggestions/:suggestionId/accept", gate("treasury.reconciliation.match"), async (c) => {
    const service = serviceFor(c);
    try {
      const line = await service.acceptSuggestion(c.req.param("id"), c.req.param("suggestionId"), callerUserId(c) ?? null);
      return c.json(serializeLine(await one(service, line)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/suggestions/:suggestionId/reject", gate("treasury.reconciliation.match"), async (c) => {
    const service = serviceFor(c);
    try {
      const record = await service.rejectSuggestion(c.req.param("id"), c.req.param("suggestionId"), callerUserId(c) ?? null);
      return c.json({ id: record.id, status: record.status, decidedAt: record.decidedAt, decidedBy: record.decidedBy });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/lines/:lineId/match", gate("treasury.reconciliation.match"), async (c) => {
    const service = serviceFor(c);
    const parsed = matchStatementLineSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    try {
      const line = await service.matchLine(c.req.param("id"), c.req.param("lineId"), parsed.data.entryId);
      return c.json(serializeLine(await one(service, line)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/lines/:lineId/match-many", gate("treasury.reconciliation.match"), async (c) => {
    const service = serviceFor(c);
    const parsed = matchManyEntriesSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    try {
      const line = await service.matchLineToEntries(c.req.param("id"), c.req.param("lineId"), parsed.data.entryIds);
      return c.json(serializeLine(await one(service, line)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/lines/:lineId/unmatch", gate("treasury.reconciliation.match"), async (c) => {
    const service = serviceFor(c);
    try {
      const line = await service.unmatchLine(c.req.param("id"), c.req.param("lineId"));
      return c.json(serializeLine(await one(service, line)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * Books the line as a bank-charge or interest voucher dated the line's own
   * day (a later `date` is allowed, an earlier one refused), then matches the
   * line to it. 202 when an approval chain holds the voucher: the line stays
   * open until the voucher posts.
   */
  app.post("/:id/lines/:lineId/create-entry", gate("treasury.reconciliation.post_entry"), async (c) => {
    const service = serviceFor(c);
    const parsed = createEntryFromLineSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    const d = parsed.data;
    try {
      const result = await service.createEntry(c.req.param("id"), c.req.param("lineId"), {
        accountId: d.accountId ?? null,
        ...(d.costCenterId !== undefined ? { costCenterId: d.costCenterId } : {}),
        ruleId: d.ruleId ?? null,
        memo: d.memo ?? null,
        date: d.date ?? null,
        actor: callerUserId(c),
        actorRoles: callerRoleCodes(c),
      });
      const body = {
        held: result.held,
        voucherId: result.voucherId,
        voucherNo: result.voucherNo,
        entryId: result.held ? null : result.entryId,
        line: serializeLine(await one(service, result.line)),
        ruleId: result.rule?.id ?? null,
      };
      return c.json(body, result.held ? 202 : 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/lines", gate("treasury.reconciliation.create"), async (c) => {
    const service = serviceFor(c);
    const parsed = addManualLineSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    const d = parsed.data;
    try {
      const line = await service.addManualLine({
        id: d.id ?? idGen(),
        statementId: c.req.param("id"),
        date: d.date,
        description: d.description,
        reference: d.reference ?? null,
        amount: Money.fromMajor(d.amount),
      });
      return c.json(serializeLine(await one(service, line)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * Refused with 422 while any line is unmatched or the difference is not
   * zero. `{ "force": true, "reason": "..." }` closes it anyway and records the
   * override on the statement (D82).
   */
  app.post("/:id/finalize", gate("treasury.reconciliation.finalize"), async (c) => {
    const service = serviceFor(c);
    const parsed = finalizeStatementSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    try {
      const statement = await service.finalize(c.req.param("id"), {
        force: parsed.data.force === true,
        reason: parsed.data.reason,
        actor: callerUserId(c),
      });
      if (statement.finalizeOverrideReason) {
        await recordAdminEvent(deps.audit, c, {
          module: "treasury",
          entityType: "bank_statement",
          entityId: statement.id,
          action: "FINALIZE_OVERRIDE",
          severity: "WARNING",
          details: {
            reason: statement.finalizeOverrideReason,
            unmatchedAtFinalize: statement.unmatchedAtFinalize ?? 0,
            differenceAtFinalize: statement.differenceAtFinalize?.toString() ?? null,
          },
        });
      }
      return c.json(serializeStatement(statement));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
