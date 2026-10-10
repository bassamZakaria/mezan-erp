import { afterEach, describe, expect, it } from "vitest";
import {
  createSqliteAuditSink,
  createSqliteFiscalPeriodRepository,
  createSqlitePeriodCloseStore,
  openSqliteConnection,
  type SqliteAuditSinkHandle,
} from "@mezan/persistence";
import {
  Money,
  PERIOD_CLOSE_OVERRIDE_PERMISSION,
  PeriodCloseCheckCode,
  PeriodCloseCheckStatus,
  type AuditEvent,
  type FiscalPeriod,
  type PeriodCloseEvaluation,
  type PeriodCloseSummary,
} from "@mezan/domain";
import { createFiscalPeriodsRoutes } from "./fiscal-periods-routes.js";
import { createPeriodCloseGuard, sealPeriodCloseSummary, verifyPeriodCloseSeal, type PeriodCloseSummaryInput } from "./period-close-guard.js";
import { NO_PERIOD_CLOSE_GUARD, createPeriodCloseRoutes } from "./period-close-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const CLOSE = "accounting.period.close";
const CLOSE_AND_OVERRIDE = `${CLOSE},${PERIOD_CLOSE_OVERRIDE_PERMISSION}`;
const WILDCARD = "*";
const REASON = "إقفال مبكر باعتماد المدير المالي";
const PERIOD_ID = "fp-2026-01";
const CLOSER = "U-CLOSER";
const SECOND_USER = "U-CONTROLLER";

interface World {
  blocking: PeriodCloseCheckCode[];
  evaluations: number;
  singleOperatorMode: boolean;
  onEvaluate: () => void;
  nextSummaryId: () => string;
}

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function sensitive(audit: SqliteAuditSinkHandle): Promise<readonly AuditEvent[]> {
  return audit.query("sensitive", 100);
}

async function setup(options: { withAudit?: boolean } = {}) {
  const { sqlite } = openSqliteConnection(":memory:");
  closers.push(() => sqlite.close());
  const repo = createSqliteFiscalPeriodRepository(sqlite);
  const store = createSqlitePeriodCloseStore(sqlite);
  const audit = createSqliteAuditSink(sqlite);
  let summarySeq = 0;
  const world: World = {
    blocking: [],
    evaluations: 0,
    singleOperatorMode: false,
    onEvaluate: () => {},
    nextSummaryId: () => `SUM-${(summarySeq += 1)}`,
  };

  async function evaluate(period: FiscalPeriod): Promise<PeriodCloseEvaluation> {
    world.evaluations += 1;
    const blocking = [...world.blocking];
    world.onEvaluate();
    return {
      periodId: period.id,
      year: period.year,
      periodNumber: period.periodNumber,
      startDate: period.startDate,
      endDate: period.endDate,
      evaluatedAt: "2026-02-01T00:00:00.000Z",
      checks: Object.values(PeriodCloseCheckCode).map((code) => ({
        code,
        status: blocking.includes(code) ? PeriodCloseCheckStatus.Fail : PeriodCloseCheckStatus.Pass,
        fix: null,
        findings: [],
      })),
      blocking,
    };
  }

  async function buildSummary({ period, evaluation, closedBy, overrideReason }: PeriodCloseSummaryInput): Promise<PeriodCloseSummary> {
    const zero = Money.zero();
    const unsigned = {
      id: world.nextSummaryId(),
      periodId: period.id,
      year: period.year,
      periodNumber: period.periodNumber,
      startDate: period.startDate,
      endDate: period.endDate,
      closedBy,
      closedAt: "2026-02-01T00:00:01.000Z",
      overrideReason,
      failedChecks: evaluation.blocking,
      checks: evaluation.checks,
      trialBalance: [],
      totals: { closingDebit: zero, closingCredit: zero, movementDebit: zero, movementCredit: zero },
    };
    return { ...unsigned, sha256: sealPeriodCloseSummary(unsigned) };
  }

  const guard = createPeriodCloseGuard({
    periods: repo,
    evaluate,
    buildSummary,
    lastClosedBy: async (periodId) => (await store.summaries.list({ periodId }))[0]?.closedBy ?? null,
    singleOperatorMode: async () => world.singleOperatorMode,
    listSummaries: async (periodId) => {
      const audited = new Set(store.queries.auditedSeals(periodId));
      return (await store.summaries.list({ periodId })).map((summary) => ({ summary, sealValid: verifyPeriodCloseSeal(summary, audited) }));
    },
    changeToken: store.critical.changeToken,
    commit: (request) => store.critical.commit({ ...request, appendAudit: (event) => audit.appendSync(event) }),
  });
  const source = () => guard;
  const periods = createFiscalPeriodsRoutes(repo, insecureHeaderAuthContextResolver, options.withAudit === false ? undefined : audit, source);
  const checklist = createPeriodCloseRoutes({ periods: repo, guard: source }, insecureHeaderAuthContextResolver);
  await periods.fetch(post("/generate-year", CLOSE, { year: 2026 }));
  const eventsBefore = (await sensitive(audit)).length;
  const closeEvents = async () => (await sensitive(audit)).filter((e) => e.action === "CLOSE" || e.action === "LOCK");
  return { sqlite, repo, store, audit, world, periods, checklist, eventsBefore, closeEvents };
}

function post(path: string, permissions: string, body?: unknown, userId = CLOSER) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { "x-permissions": permissions, "x-user-id": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path: string, permissions: string) {
  return new Request(`http://local${path}`, { headers: { "x-permissions": permissions } });
}

async function statusOf(repo: { findById(id: string): Promise<FiscalPeriod | null> }) {
  return (await repo.findById(PERIOD_ID))?.status;
}

describe("closing a period runs the pre-close checks (D176 C-3)", () => {
  it("closes a clear period: one CLOSE event carrying the summary's seal, and no override on it", async () => {
    const { periods, repo, store, closeEvents } = await setup();
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    expect(res.status).toBe(200);
    expect(await statusOf(repo)).toBe("closed");
    const [summary, ...others] = await store.summaries.list({ periodId: PERIOD_ID });
    expect(others).toEqual([]);
    expect(summary).toMatchObject({ closedBy: CLOSER, overrideReason: null });
    const events = await closeEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "CLOSE", severity: "WARNING", entityId: PERIOD_ID, actor: CLOSER });
    expect(events[0]?.details).toMatchObject({ overridden: false, failedChecks: [], reason: null, sha256: summary?.sha256, previousStatus: "open", status: "closed" });
  });

  it("refuses with 409 while a check fails, in Arabic and English, and leaves the period open and the trail untouched", async () => {
    const { periods, repo, world, closeEvents } = await setup();
    world.blocking = [PeriodCloseCheckCode.Drafts, PeriodCloseCheckCode.SubledgerTies];
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; messageEn: string; failedChecks: string[]; checklist: { canOverride: boolean; blocking: string[] } };
    expect(body.error).toBe("PERIOD_CLOSE_BLOCKED");
    expect(body.message).toMatch(/[؀-ۿ]/);
    expect(body.messageEn).toContain("cannot be closed");
    expect(body.failedChecks).toEqual(["drafts", "subledger_ties"]);
    expect(body.checklist).toMatchObject({ canOverride: true, blocking: ["drafts", "subledger_ties"] });
    expect(await statusOf(repo)).toBe("open");
    expect(await closeEvents()).toEqual([]);
  });

  it("refuses an override reason from a caller without the override permission with 403", async () => {
    const { periods, repo, world } = await setup();
    world.blocking = [PeriodCloseCheckCode.Drafts];
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE, { overrideReason: REASON }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string; checklist: { canOverride: boolean } };
    expect(body.error).toBe("PERIOD_CLOSE_OVERRIDE_NOT_PERMITTED");
    expect(body.message).toMatch(/[؀-ۿ]/);
    expect(body.checklist.canOverride).toBe(false);
    expect(await statusOf(repo)).toBe("open");
  });

  it("closes over a failing check for a permitted caller: ONE event, written with the close, naming the checks, the reason and the seal", async () => {
    const { periods, repo, store, world, closeEvents } = await setup();
    world.blocking = [PeriodCloseCheckCode.BankStatements, PeriodCloseCheckCode.Depreciation];
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { overrideReason: `  ${REASON}  ` }));
    expect(res.status).toBe(200);
    expect(await statusOf(repo)).toBe("closed");
    const [summary] = await store.summaries.list({ periodId: PERIOD_ID });
    expect(summary).toMatchObject({ overrideReason: REASON, failedChecks: ["bank_statements", "depreciation"] });
    const events = await closeEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.details).toMatchObject({
      overridden: true,
      failedChecks: ["bank_statements", "depreciation"],
      reason: REASON,
      sha256: summary?.sha256,
      year: 2026,
      periodNumber: 1,
    });
  });

  it("rejects a reason too short to be one, and a body that tries to supply its own verdict", async () => {
    const { periods, repo, world } = await setup();
    world.blocking = [PeriodCloseCheckCode.Drafts];
    expect((await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { overrideReason: "ok" }))).status).toBe(400);
    expect((await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { blocking: [], failedChecks: [], checks: [] }))).status).toBe(400);
    expect(await statusOf(repo)).toBe("open");
  });
});

describe("the close is one atomic step", () => {
  it("two callers overriding the same month at once: one closes, one is told it is already closed, and the trail holds exactly one event", async () => {
    const { periods, repo, store, world, closeEvents } = await setup();
    world.blocking = [PeriodCloseCheckCode.Drafts];
    const responses = await Promise.all([
      periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }, "U-TILL-1")),
      periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }, "U-TILL-2")),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await statusOf(repo)).toBe("closed");
    expect(await closeEvents()).toHaveLength(1);
    expect(await store.summaries.list({ periodId: PERIOD_ID })).toHaveLength(1);
  });

  it("a summary that cannot be written leaves the period OPEN and writes no event — the month is never closed unsealed", async () => {
    const { periods, repo, store, world, closeEvents } = await setup();
    await periods.fetch(post("/fp-2026-02/close", CLOSE));
    const [taken] = await store.summaries.list({ periodId: "fp-2026-02" });
    world.nextSummaryId = () => taken?.id ?? "";
    const eventsBefore = (await closeEvents()).length;

    const res = await periods.request(post(`/${PERIOD_ID}/close`, CLOSE));
    expect(res.status).toBe(500);
    expect(await statusOf(repo)).toBe("open");
    expect(await closeEvents()).toHaveLength(eventsBefore);
    expect(await store.summaries.list({ periodId: PERIOD_ID })).toEqual([]);
  });

  it("an audit row that cannot be written leaves the period open and no summary behind", async () => {
    const { sqlite, periods, repo, store } = await setup();
    sqlite.exec(`CREATE TRIGGER refuse_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT, 'audit store unavailable'); END;`);
    const res = await periods.request(post(`/${PERIOD_ID}/close`, CLOSE));
    expect(res.status).toBe(500);
    expect(await statusOf(repo)).toBe("open");
    expect(await store.summaries.list({ periodId: PERIOD_ID })).toEqual([]);
  });

  it("a document saved between the checks and the close forces the checks to be read again, and they now refuse", async () => {
    const { periods, repo, store, world } = await setup();
    world.onEvaluate = () => {
      if (world.evaluations !== 1) return;
      store.fxRuns.record({ asOfDate: "2026-01-31", currencies: ["USD"], entryId: null, ranBy: "someone-else", ranAt: "2026-02-01T00:00:00.000Z" });
      world.blocking = [PeriodCloseCheckCode.Drafts];
    };
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("PERIOD_CLOSE_BLOCKED");
    expect(world.evaluations).toBe(2);
    expect(await statusOf(repo)).toBe("open");
  });

  it("gives up with a coded 409 when the books will not hold still, having closed nothing", async () => {
    const { periods, repo, store, world, closeEvents } = await setup();
    world.onEvaluate = () => store.fxRuns.record({ asOfDate: "2026-01-31", currencies: ["USD"], entryId: null, ranBy: "busy", ranAt: "2026-02-01T00:00:00.000Z" });
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; messageEn: string };
    expect(body.error).toBe("PERIOD_CLOSE_CONTENDED");
    expect(body.message).toMatch(/[؀-ۿ]/);
    expect(body.messageEn).toContain("Try again");
    expect(world.evaluations).toBe(3);
    expect(await statusOf(repo)).toBe("open");
    expect(await closeEvents()).toEqual([]);
  });

  it("runs inside a transaction the caller already holds, as a savepoint", async () => {
    const { sqlite, periods, repo, closeEvents } = await setup();
    sqlite.exec("BEGIN");
    const res = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    expect(res.status).toBe(200);
    sqlite.exec("ROLLBACK");
    expect(await statusOf(repo)).toBe("open");
    expect(await closeEvents()).toEqual([]);
  });
});

describe("a router with nothing to check with, or nowhere to record, refuses", () => {
  it("answers a coded 503 in both languages when no guard is supplied, and closes nothing", async () => {
    const { repo, audit } = await setup();
    const bare = createFiscalPeriodsRoutes(repo, insecureHeaderAuthContextResolver, audit, NO_PERIOD_CLOSE_GUARD);
    for (const action of ["close", "lock"]) {
      const res = await bare.fetch(post(`/${PERIOD_ID}/${action}`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string; message: string; messageEn: string };
      expect(body.error).toBe("PERIOD_CLOSE_CHECKS_UNAVAILABLE");
      expect(body.message).toMatch(/[؀-ۿ]/);
      expect(body.messageEn).toContain("not available");
    }
    expect(await statusOf(repo)).toBe("open");
    const checklist = createPeriodCloseRoutes({ periods: repo, guard: NO_PERIOD_CLOSE_GUARD }, insecureHeaderAuthContextResolver);
    expect((await checklist.fetch(get(`/${PERIOD_ID}/checks`, "accounting.period.view"))).status).toBe(503);
  });

  it("answers a coded 503 when there is no audit sink — for a clean close as much as for an override", async () => {
    const { periods, repo, world } = await setup({ withAudit: false });
    const clean = await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    expect(clean.status).toBe(503);
    const body = (await clean.json()) as { error: string; message: string; messageEn: string };
    expect(body.error).toBe("PERIOD_CLOSE_UNAUDITABLE");
    expect(body.message).toMatch(/[؀-ۿ]/);
    expect(body.messageEn).toContain("audit trail");
    world.blocking = [PeriodCloseCheckCode.Drafts];
    expect((await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }))).status).toBe(503);
    expect(await statusOf(repo)).toBe("open");
  });
});

describe("locking is held to the same checks, and overriding it takes a second person", () => {
  it("refuses a bare lock while a check fails; the closer may not override it; another permitted user may, with one LOCK event", async () => {
    const { periods, repo, world, closeEvents } = await setup();
    await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    world.blocking = [PeriodCloseCheckCode.Drafts];

    expect((await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE_AND_OVERRIDE))).status).toBe(409);

    const sameUser = await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }));
    expect(sameUser.status).toBe(403);
    const refusal = (await sameUser.json()) as { error: string; message: string; messageEn: string };
    expect(refusal.error).toBe("PERIOD_LOCK_OVERRIDE_SAME_USER");
    expect(refusal.message).toMatch(/[؀-ۿ]/);
    expect(refusal.messageEn).toContain("different user");
    expect(await statusOf(repo)).toBe("closed");

    const second = await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }, SECOND_USER));
    expect(second.status).toBe(200);
    expect(await statusOf(repo)).toBe("locked");
    const locks = (await closeEvents()).filter((e) => e.action === "LOCK");
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ actor: SECOND_USER });
    expect(locks[0]?.details).toMatchObject({ overridden: true, failedChecks: ["drafts"], reason: REASON, singleOperatorMode: false });
  });

  it("the single-operator switch lets only the wildcard admin lock their own close over a failing check, and the LOCK event says so", async () => {
    const { periods, repo, world, closeEvents } = await setup();
    await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    await periods.fetch(post("/fp-2026-02/close", CLOSE));
    expect((await periods.fetch(post("/fp-2026-02/lock", CLOSE))).status).toBe(200);

    world.blocking = [PeriodCloseCheckCode.Drafts];
    world.singleOperatorMode = true;
    const notAdmin = await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }));
    expect(notAdmin.status).toBe(403);
    expect(((await notAdmin.json()) as { error: string }).error).toBe("PERIOD_LOCK_OVERRIDE_SAME_USER");
    expect(await statusOf(repo)).toBe("closed");

    expect((await periods.fetch(post(`/${PERIOD_ID}/lock`, WILDCARD, { overrideReason: REASON }))).status).toBe(200);
    expect(await statusOf(repo)).toBe("locked");
    const locks = (await closeEvents()).filter((e) => e.action === "LOCK" && e.entityId === PERIOD_ID);
    expect(locks).toHaveLength(1);
    expect(locks[0]?.details).toMatchObject({ overridden: true, singleOperatorMode: true });
  });

  it("a locked period stays terminal: neither close nor lock reaches the checks, even with an override", async () => {
    const { periods, repo, world } = await setup();
    await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE));
    const evaluationsBefore = world.evaluations;
    for (const action of ["close", "lock"]) {
      const res = await periods.fetch(post(`/${PERIOD_ID}/${action}`, CLOSE_AND_OVERRIDE, { overrideReason: REASON }, SECOND_USER));
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe("INVALID_PERIOD_TRANSITION");
    }
    expect(world.evaluations).toBe(evaluationsBefore);
    expect(await statusOf(repo)).toBe("locked");
  });

  it("locking an open period is refused as a transition before any check runs, and an unknown period is a 404", async () => {
    const { periods, world } = await setup();
    expect((await periods.fetch(post(`/${PERIOD_ID}/lock`, CLOSE))).status).toBe(422);
    expect(world.evaluations).toBe(0);
    expect((await periods.fetch(post("/nope/close", CLOSE))).status).toBe(404);
  });
});

describe("GET /period-close/:periodId/checks and /summaries", () => {
  it("serves the checklist with the period status and whether THIS caller may override", async () => {
    const { checklist, world } = await setup();
    world.blocking = [PeriodCloseCheckCode.TrialBalance];
    const viewer = (await (await checklist.fetch(get(`/${PERIOD_ID}/checks`, "accounting.period.view"))).json()) as { blocking: string[]; canOverride: boolean; periodStatus: string; checks: unknown[] };
    expect(viewer).toMatchObject({ blocking: ["trial_balance"], canOverride: false, periodStatus: "open" });
    expect(viewer.checks).toHaveLength(Object.values(PeriodCloseCheckCode).length);
    const overrider = (await (await checklist.fetch(get(`/${PERIOD_ID}/checks`, CLOSE_AND_OVERRIDE))).json()) as { canOverride: boolean };
    expect(overrider.canOverride).toBe(true);
  });

  it("needs accounting.period.view and 404s an unknown period", async () => {
    const { checklist } = await setup();
    expect((await checklist.fetch(get(`/${PERIOD_ID}/checks`, "sales.invoice.view"))).status).toBe(403);
    expect((await checklist.fetch(get("/nope/checks", "accounting.period.view"))).status).toBe(404);
  });

  it("verifies each summary's seal on read: intact, altered after the fact, and never recorded in the audit trail", async () => {
    const { sqlite, periods, checklist, store } = await setup();
    await periods.fetch(post(`/${PERIOD_ID}/close`, CLOSE));
    const read = async () => (await (await checklist.fetch(get(`/${PERIOD_ID}/summaries`, "accounting.period.view"))).json()) as { sealValid: boolean; sha256: string }[];
    expect((await read()).map((s) => s.sealValid)).toEqual([true]);

    const [original] = await store.summaries.list({ periodId: PERIOD_ID });
    if (!original) throw new Error("the close wrote no summary");
    expect(verifyPeriodCloseSeal(original, new Set([original.sha256]))).toBe(true);
    expect(verifyPeriodCloseSeal({ ...original, closedBy: "someone-else" }, new Set([original.sha256]))).toBe(false);
    expect(verifyPeriodCloseSeal({ ...original, checks: [] }, new Set([original.sha256]))).toBe(false);
    expect(verifyPeriodCloseSeal(original, new Set())).toBe(false);

    sqlite.exec(`DROP TRIGGER period_close_summary_no_update`);
    sqlite.prepare(`UPDATE period_close_summary SET override_reason = ? WHERE id = ?`).run("rewritten later", original.id);
    expect((await read()).map((s) => s.sealValid)).toEqual([false]);
  });
});
