import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  BankReconciliationService,
  Money,
  BankStatementNotFoundError,
  ColumnNotFoundError,
  InvalidColumnMappingError,
  InvalidStatementFileError,
  LineAlreadyMatchedError,
  LineNotMatchedError,
  StatementAlreadyFinalizedError,
  StatementLineNotFoundError,
  type BankStatement,
  type BankReconciliationServiceDeps,
  type StatementLine,
} from "@mezan/domain";
import {
  importBankStatementSchema,
  matchStatementLineSchema,
  addManualLineSchema,
  bankStatementListQuerySchema,
} from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

export type BankReconciliationRoutesDeps = BankReconciliationServiceDeps & {
  /** Generates ids (statement id, statement-line id) when the request omits them. Defaults to a UUID. */
  readonly idGen?: () => string;
};

function serializeStatement(s: BankStatement) {
  return {
    id: s.id,
    treasuryAccountId: s.treasuryAccountId,
    source: s.source,
    statementNumber: s.statementNumber,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    openingBalance: s.openingBalance.toString(),
    closingBalance: s.closingBalance.toString(),
    status: s.status,
    importedAt: s.importedAt,
    finalizedAt: s.finalizedAt,
  };
}

function serializeLine(l: StatementLine) {
  return {
    id: l.id,
    statementId: l.statementId,
    date: l.date,
    description: l.description,
    reference: l.reference,
    amount: l.amount.toString(),
    status: l.status,
    matchedEntryId: l.matchedEntryId,
    matchedAt: l.matchedAt,
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof BankStatementNotFoundError || err instanceof StatementLineNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof LineAlreadyMatchedError || err instanceof LineNotMatchedError || err instanceof StatementAlreadyFinalizedError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidStatementFileError || err instanceof ColumnNotFoundError || err instanceof InvalidColumnMappingError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * Bank reconciliation routes (docs/catalog/04 §"تسوية كشوف البنك"), mounted
 * under `/bank-statements`:
 *   GET  /bank-statements                          list                       reconciliation.view
 *   GET  /bank-statements/:id                       one + lines + match summary reconciliation.view
 *   GET  /bank-statements/column-mapping/:accountId the account's saved mapping reconciliation.view
 *   GET  /bank-statements/:id/candidates            matchable GL movements     reconciliation.view
 *   POST /bank-statements/import                    import a CSV statement     reconciliation.import
 *   POST /bank-statements/:id/auto-match             auto-suggest & apply       reconciliation.match
 *   POST /bank-statements/:id/lines/:lineId/match    manual match               reconciliation.match
 *   POST /bank-statements/:id/lines/:lineId/unmatch  manual unmatch             reconciliation.match
 *   POST /bank-statements/:id/lines                  add a line the CSV missed  reconciliation.create
 *   POST /bank-statements/:id/finalize               lock the statement         reconciliation.finalize
 */
export function createBankReconciliationRoutes(
  deps: BankReconciliationRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());
  const service = new BankReconciliationService(deps);

  app.get("/", gate("treasury.reconciliation.view"), async (c) => {
    const parsed = bankStatementListQuerySchema.safeParse({
      treasuryAccountId: c.req.query("treasuryAccountId"),
      status: c.req.query("status"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const rows = await service.listWithSummaries(parsed.data);
    return c.json(rows.map(({ statement, summary }) => ({ ...serializeStatement(statement), matchSummary: summary })));
  });

  app.get("/column-mapping/:treasuryAccountId", gate("treasury.reconciliation.view"), async (c) => {
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
    try {
      const candidates = await service.matchCandidates(c.req.param("id"));
      return c.json(
        candidates.map((candidate) => ({
          entryId: candidate.entryId,
          entryNo: candidate.entryNo,
          date: candidate.date,
          amount: candidate.amount.toString(),
          description: candidate.description,
        })),
      );
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate("treasury.reconciliation.view"), async (c) => {
    const statement = await service.findById(c.req.param("id"));
    if (!statement) return c.json({ error: "NOT_FOUND" }, 404);
    const lines = await service.listLines(statement.id);
    const summary = await service.matchSummary(statement.id);
    return c.json({ ...serializeStatement(statement), lines: lines.map(serializeLine), matchSummary: summary });
  });

  app.post("/import", gate("treasury.reconciliation.import"), async (c) => {
    const parsed = importBankStatementSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
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
      });
      return c.json({ ...serializeStatement(statement), lines: lines.map(serializeLine) }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/auto-match", gate("treasury.reconciliation.match"), async (c) => {
    try {
      const result = await service.autoMatch(c.req.param("id"));
      return c.json(result);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/lines/:lineId/match", gate("treasury.reconciliation.match"), async (c) => {
    const parsed = matchStatementLineSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const line = await service.matchLine(c.req.param("id"), c.req.param("lineId"), parsed.data.entryId);
      return c.json(serializeLine(line));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/lines/:lineId/unmatch", gate("treasury.reconciliation.match"), async (c) => {
    try {
      const line = await service.unmatchLine(c.req.param("id"), c.req.param("lineId"));
      return c.json(serializeLine(line));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/lines", gate("treasury.reconciliation.create"), async (c) => {
    const parsed = addManualLineSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
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
      return c.json(serializeLine(line), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/finalize", gate("treasury.reconciliation.finalize"), async (c) => {
    try {
      const statement = await service.finalize(c.req.param("id"));
      return c.json(serializeStatement(statement));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
