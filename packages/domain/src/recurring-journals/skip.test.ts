import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { AuditEvent, AuditSink, AuditStream } from "../audit/index.js";
import { skipRecurringJournalOccurrence } from "./skip.js";
import {
  RecurringJournalFrequency,
  RecurringJournalPeriodAlreadyGeneratedError,
  RecurringJournalPeriodAlreadySkippedError,
  RecurringJournalTemplateNotFoundError,
  RecurringJournalTemplateStatus,
  type RecurringJournalRun,
  type RecurringJournalSkip,
  type RecurringJournalTemplate,
} from "./types.js";

function template(overrides: Partial<RecurringJournalTemplate> = {}): RecurringJournalTemplate {
  return {
    id: "tpl-1",
    nameAr: "إيجار المكتب",
    nameEn: "Office rent",
    memo: "إيجار",
    frequency: RecurringJournalFrequency.Monthly,
    dayOfPeriod: 1,
    yearlyMonth: null,
    startDate: "2026-01-01",
    endDate: null,
    autoReverseNextPeriod: false,
    status: RecurringJournalTemplateStatus.Active,
    lines: [
      { accountId: "5100", debit: Money.fromMajor("1000"), credit: Money.zero() },
      { accountId: "1100", debit: Money.zero(), credit: Money.fromMajor("1000") },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class FakeTemplates {
  constructor(private readonly rows: Map<string, RecurringJournalTemplate>) {}
  async findById(id: string): Promise<RecurringJournalTemplate | null> {
    return this.rows.get(id) ?? null;
  }
}

class FakeRuns {
  constructor(private readonly rows: Map<string, RecurringJournalRun>) {}
  async findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalRun | null> {
    return this.rows.get(`${templateId}:${period}`) ?? null;
  }
}

class FakeSkips {
  readonly rows = new Map<string, RecurringJournalSkip>();
  async findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalSkip | null> {
    return this.rows.get(`${templateId}:${period}`) ?? null;
  }
  async listByTemplate(templateId: string): Promise<readonly RecurringJournalSkip[]> {
    return [...this.rows.values()].filter((s) => s.templateId === templateId);
  }
  async list(): Promise<readonly RecurringJournalSkip[]> {
    return [...this.rows.values()];
  }
  async save(skip: RecurringJournalSkip): Promise<boolean> {
    const key = `${skip.templateId}:${skip.period}`;
    if (this.rows.has(key)) return false;
    this.rows.set(key, skip);
    return true;
  }
}

class RecordingAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async query(stream: AuditStream): Promise<readonly AuditEvent[]> {
    return this.events.filter((e) => e.stream === stream);
  }
}

describe("skipRecurringJournalOccurrence", () => {
  it("claims the period, and writes a sensitive audit event naming the template and period", async () => {
    const templates = new FakeTemplates(new Map([["tpl-1", template()]]));
    const runs = new FakeRuns(new Map());
    const skips = new FakeSkips();
    const audit = new RecordingAuditSink();
    let idSeq = 0;

    const skip = await skipRecurringJournalOccurrence("tpl-1", "2026-02", "مالك أعفى الإيجار هذا الشهر", {
      templates,
      runs,
      skips,
      audit,
      now: () => "2026-02-01T00:00:00.000Z",
      actor: "user-1",
      idGen: () => `skip-${++idSeq}`,
    });

    expect(skip).toEqual({
      id: "skip-1",
      templateId: "tpl-1",
      period: "2026-02",
      note: "مالك أعفى الإيجار هذا الشهر",
      skippedAt: "2026-02-01T00:00:00.000Z",
      skippedBy: "user-1",
    });

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      stream: "sensitive",
      module: "accounting",
      entityType: "RECURRING_JOURNAL_TEMPLATE",
      entityId: "tpl-1",
      action: "RECURRING_JOURNAL_OCCURRENCE_SKIPPED",
      actor: "user-1",
      details: { templateId: "tpl-1", templateNameAr: "إيجار المكتب", period: "2026-02", note: "مالك أعفى الإيجار هذا الشهر" },
    });
  });

  it("refuses a period a run already covers — a generated entry can never be retro-skipped", async () => {
    const templates = new FakeTemplates(new Map([["tpl-1", template()]]));
    const runs = new FakeRuns(
      new Map([
        [
          "tpl-1:2026-02",
          {
            id: "run-1",
            templateId: "tpl-1",
            period: "2026-02",
            generation: 1,
            journalEntryId: "je-1",
            journalEntryNo: "JE-0001",
            reversalJournalEntryId: null,
            reversalJournalEntryNo: null,
            generatedAt: "2026-02-01T00:00:00.000Z",
            generatedBy: "system",
          },
        ],
      ]),
    );
    const skips = new FakeSkips();

    await expect(
      skipRecurringJournalOccurrence("tpl-1", "2026-02", null, { templates, runs, skips, idGen: () => "skip-1" }),
    ).rejects.toBeInstanceOf(RecurringJournalPeriodAlreadyGeneratedError);
    expect(skips.rows.size).toBe(0);
  });

  it("refuses a period already skipped — the atomic claim, not a pre-check, decides a concurrent double-call", async () => {
    const templates = new FakeTemplates(new Map([["tpl-1", template()]]));
    const runs = new FakeRuns(new Map());
    const skips = new FakeSkips();
    let idSeq = 0;

    await skipRecurringJournalOccurrence("tpl-1", "2026-02", null, {
      templates,
      runs,
      skips,
      idGen: () => `skip-${++idSeq}`,
    });

    await expect(
      skipRecurringJournalOccurrence("tpl-1", "2026-02", "second attempt", {
        templates,
        runs,
        skips,
        idGen: () => `skip-${++idSeq}`,
      }),
    ).rejects.toBeInstanceOf(RecurringJournalPeriodAlreadySkippedError);
  });

  it("refuses an unknown template", async () => {
    const templates = new FakeTemplates(new Map());
    const runs = new FakeRuns(new Map());
    const skips = new FakeSkips();

    await expect(
      skipRecurringJournalOccurrence("missing", "2026-02", null, { templates, runs, skips, idGen: () => "skip-1" }),
    ).rejects.toBeInstanceOf(RecurringJournalTemplateNotFoundError);
  });
});
