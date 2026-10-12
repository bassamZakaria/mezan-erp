import { z } from "zod";
import { auditEventSchema, auditSeveritySchema, auditStreamSchema } from "./audit.js";

/**
 * تقارير الرقابة والأمان — the wire contract for `/security-reports`.
 *
 * WHY THIS EXISTS. All 27 routes in `reports-routes.ts` are operational: what
 * was sold, bought, held and owed. Not one of them answers "who did something
 * they should not have". The only forensic surface was `GET /audit`, a raw
 * filtered log an auditor had to interrogate by guessing `action` strings — so
 * every control the product enforces (escalation refusals, lockouts, admin PIN
 * resets, post-posting voids, approval-config edits) was recorded and never
 * reported on. A control nobody reports on is a control that does not exist.
 *
 * Every schema here is a QUERY over the append-only audit trail plus, for the
 * new-accounts report, the user register. Nothing is computed that the books do
 * not already record: where the ledger is silent the field is `null` and the
 * `gaps` list says so out loud, because a plausible substitute in an audit
 * report is itself the finding.
 */

/** `YYYY-MM-DD`, the only date form these reports accept. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ يجب أن يكون بصيغة YYYY-MM-DD");

/**
 * NO `limit` FIELD, ON ANY OF THESE, DELIBERATELY.
 *
 * A caller-supplied limit is not a limit; it is a request. These reports count
 * events, and a count computed over "however many rows the browser asked for"
 * is a number with no meaning that still renders as a fact. Every bound below
 * is recomputed server-side, and what the server could not read is declared in
 * `coverage` instead of being silently dropped.
 */
export const securityExceptionsQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  actor: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  severity: auditSeveritySchema.optional(),
});

export const postPostingChangesQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  actor: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  changeType: z
    .enum(["VOID", "REVERSE", "PERIOD_REOPENED", "NUMBERING_ADJUSTED"])
    .optional(),
});

export const afterHoursQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  actor: z.string().min(1).optional(),
  stream: auditStreamSchema.optional(),
  severity: auditSeveritySchema.optional(),
});

export const newAccountsQuerySchema = z.object({
  /** Look-back window in days. Clamped server-side to 1..365; the default is 90. */
  days: z.coerce.number().int().positive().optional(),
  createdBy: z.string().min(1).optional(),
});

/**
 * How much of the trail the report actually read.
 *
 * `matched` is the true number of rows in range — the query port reports it
 * independently of paging — while `scanned` is how many were aggregated before
 * the server-side scan ceiling stopped it. When `truncated` is true the totals
 * below it are a floor, not a total, and the screen must say so. Reporting a
 * partial aggregate as if it were complete is how an exception report ends up
 * exonerating somebody.
 */
export const reportCoverageSchema = z.object({
  matched: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  scanLimit: z.number().int().positive(),
});

/**
 * A question the auditor asked that this build's records cannot answer.
 *
 * Carried in the response rather than left blank: a column that silently
 * disappears reads as "nothing to report", which is the opposite of the truth.
 */
export const reportGapSchema = z.object({
  key: z.string().min(1),
  labelAr: z.string().min(1),
  detailAr: z.string().min(1),
});

export const reportColumnSchema = z.object({
  key: z.string().min(1),
  labelAr: z.string().min(1),
  format: z.enum(["text", "qty", "date", "datetime"]).optional(),
});

export const reportKpiSchema = z.object({
  key: z.string().min(1),
  labelAr: z.string().min(1),
  value: z.number(),
  tone: z.enum(["default", "warning", "danger"]).optional(),
});

/** One `(actor, action)` cell of تقرير الاستثناءات الأمنية. */
export const securityExceptionRowSchema = z.object({
  actor: z.string().min(1),
  action: z.string().min(1),
  actionLabelAr: z.string().min(1),
  module: z.string(),
  count: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
  firstAt: z.string().min(1),
  lastAt: z.string().min(1),
});

/**
 * One named security control and whether it fired in the period.
 *
 * Rows only appear for actions that HAPPENED, so a watch-list entry at zero is
 * the useful reading: it says the control reported, and reported nothing —
 * distinct from a control that was never wired, which is what the أحداث الأمان
 * tab used to look like on a live tenant.
 */
export const securityWatchlistEntrySchema = z.object({
  action: z.string().min(1),
  labelAr: z.string().min(1),
  count: z.number().int().nonnegative(),
  actorCount: z.number().int().nonnegative(),
  lastAt: z.string().nullable(),
});

export const unrecordedSecurityEventSchema = z.object({
  at: z.string().min(1),
  module: z.string().min(1),
  action: z.string().min(1),
  severity: z.string().min(1),
  actor: z.string().min(1),
  entityId: z.string().nullable(),
  reason: z.string(),
});

export const unrecordedSecurityEventsSchema = z.object({
  count: z.number().int().nonnegative(),
  recent: z.array(unrecordedSecurityEventSchema),
});

export const securityExceptionsReportSchema = z.object({
  id: z.literal("security.exceptions"),
  titleAr: z.string().min(1),
  params: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    actor: z.string().nullable(),
    action: z.string().nullable(),
    severity: auditSeveritySchema.nullable(),
  }),
  columns: z.array(reportColumnSchema),
  rows: z.array(securityExceptionRowSchema),
  groups: z.array(
    z.object({
      key: z.string().min(1),
      labelAr: z.string().min(1),
      rows: z.array(securityExceptionRowSchema),
      totals: z.object({ count: z.number().int().nonnegative(), critical: z.number().int().nonnegative() }),
    }),
  ),
  grandTotals: z.object({ count: z.number().int().nonnegative(), critical: z.number().int().nonnegative() }),
  watchlist: z.array(securityWatchlistEntrySchema),
  kpis: z.array(reportKpiSchema),
  recent: z.array(auditEventSchema),
  unrecorded: unrecordedSecurityEventsSchema,
  coverage: reportCoverageSchema,
  gaps: z.array(reportGapSchema),
});

export const postPostingChangeRowSchema = z.object({
  /**
   * A COMPOSITE KEY, NOT AN ID. `AuditEvent` carries no identifier — the
   * append-only table has a rowid and the read port does not project it — so
   * this is `timestamp|actor|action|entityType|entityId`, stable for rendering
   * and for React keys, and NOT usable to address a single audit row.
   */
  rowKey: z.string().min(1),
  timestamp: z.string().min(1),
  actor: z.string().min(1),
  module: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().nullable(),
  docNo: z.string().nullable(),
  action: z.string().min(1),
  changeType: z.enum(["VOID", "REVERSE", "PERIOD_REOPENED", "NUMBERING_ADJUSTED"]),
  changeTypeLabelAr: z.string().min(1),
  severity: auditSeveritySchema,
  branchId: z.string().nullable(),
  /** The reversing document, when the event named one. */
  reversalId: z.string().nullable(),
  /**
   * NULL ON EVERY DOCUMENT VOID AND REVERSAL IN THIS BUILD — see the `gaps`
   * list. No cancel/reverse path captures a reason, so this column reads back
   * whatever `details.reason` a future one records and nothing more.
   */
  reason: z.string().nullable(),
});

export const postPostingChangesReportSchema = z.object({
  id: z.literal("security.post_posting_changes"),
  titleAr: z.string().min(1),
  params: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    actor: z.string().nullable(),
    entityType: z.string().nullable(),
    changeType: z.string().nullable(),
  }),
  columns: z.array(reportColumnSchema),
  rows: z.array(postPostingChangeRowSchema),
  groups: z.array(
    z.object({
      key: z.string().min(1),
      labelAr: z.string().min(1),
      rows: z.array(postPostingChangeRowSchema),
      totals: z.object({ count: z.number().int().nonnegative(), withoutReason: z.number().int().nonnegative() }),
    }),
  ),
  grandTotals: z.object({ count: z.number().int().nonnegative(), withoutReason: z.number().int().nonnegative() }),
  kpis: z.array(reportKpiSchema),
  coverage: reportCoverageSchema,
  gaps: z.array(reportGapSchema),
});

/**
 * The working day these reports measure "outside" against.
 *
 * `source` is part of the contract, not decoration: `"settings"` means the shop
 * configured it, `"default"` means nobody did and the server assumed. An
 * after-hours finding computed against an assumed working day is an allegation
 * against a person, so the screen has to be able to say which it is.
 */
export const workingHoursSchema = z.object({
  timezone: z.string().min(1),
  timezoneResolved: z.boolean(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().min(0).max(24),
  /**
   * `startHour + standardDailyWorkHours`, CLAMPED AT 24. A configured working
   * day long enough to run past midnight is treated as ending at midnight
   * rather than wrapping into the next day, because wrapping would silently
   * clear the small hours — the window an after-hours report exists to watch.
   */
  standardDailyWorkHours: z.number().positive(),
  weekendDays: z.array(z.number().int().min(0).max(6)),
  weekStartDay: z.number().int().min(0).max(6),
  startHourSource: z.enum(["settings", "default"]),
  weekendSource: z.enum(["settings", "default"]),
});

export const afterHoursRowSchema = z.object({
  /** A composite render key, not an id — see `postPostingChangeRowSchema.rowKey`. */
  rowKey: z.string().min(1),
  timestamp: z.string().min(1),
  localDate: z.string().min(1),
  localTime: z.string().min(1),
  weekday: z.number().int().min(0).max(6),
  weekdayLabelAr: z.string().min(1),
  outsideReason: z.enum(["WEEKEND", "BEFORE_HOURS", "AFTER_HOURS"]),
  outsideReasonLabelAr: z.string().min(1),
  actor: z.string().min(1),
  stream: auditStreamSchema,
  module: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().nullable(),
  action: z.string().min(1),
  severity: auditSeveritySchema,
  branchId: z.string().nullable(),
});

export const afterHoursReportSchema = z.object({
  id: z.literal("security.after_hours"),
  titleAr: z.string().min(1),
  params: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    actor: z.string().nullable(),
    stream: auditStreamSchema.nullable(),
    severity: auditSeveritySchema.nullable(),
  }),
  workingHours: workingHoursSchema,
  columns: z.array(reportColumnSchema),
  rows: z.array(afterHoursRowSchema),
  groups: z.array(
    z.object({
      key: z.string().min(1),
      labelAr: z.string().min(1),
      rows: z.array(afterHoursRowSchema),
      totals: z.object({
        count: z.number().int().nonnegative(),
        weekend: z.number().int().nonnegative(),
        critical: z.number().int().nonnegative(),
      }),
    }),
  ),
  grandTotals: z.object({
    count: z.number().int().nonnegative(),
    weekend: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }),
  kpis: z.array(reportKpiSchema),
  coverage: reportCoverageSchema,
  gaps: z.array(reportGapSchema),
});

export const newAccountRowSchema = z.object({
  userId: z.string().min(1),
  nameAr: z.string(),
  email: z.string(),
  status: z.enum(["active", "inactive"]),
  isCompanyAdmin: z.boolean(),
  roleId: z.string().nullable(),
  createdAt: z.string().min(1),
  lastLoginAt: z.string().nullable(),
  /**
   * THE JOIN THE GHOST-EMPLOYEE SCENARIO NEEDS. `admin.users.create` alone
   * onboards an account and sets its PIN in the same request, so the creator
   * and the account then appear in the trail as two unrelated actors. This is
   * the audit `CREATE` row that names the creator; null means no such row
   * exists (an account seeded, migrated, or created before the event was
   * written) and the link genuinely cannot be made.
   */
  createdBy: z.string().nullable(),
  createdByEventAt: z.string().nullable(),
  /** Distinct documents this account CONFIRMED or POSTED, per the audit trail. */
  postedDocumentCount: z.number().int().nonnegative(),
  /** Distinct documents this account VOIDED or REVERSED, per the audit trail. */
  voidedDocumentCount: z.number().int().nonnegative(),
  /** Times an administrator set this account's credential (`CREDENTIAL_RESET_BY_ADMIN`). */
  credentialResetCount: z.number().int().nonnegative(),
  firstActivityAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
});

export const newAccountsReportSchema = z.object({
  id: z.literal("security.new_accounts"),
  titleAr: z.string().min(1),
  params: z.object({
    days: z.number().int().positive(),
    since: z.string().min(1),
    createdBy: z.string().nullable(),
  }),
  columns: z.array(reportColumnSchema),
  rows: z.array(newAccountRowSchema),
  groups: z.array(
    z.object({
      key: z.string().min(1),
      labelAr: z.string().min(1),
      rows: z.array(newAccountRowSchema),
      totals: z.object({
        count: z.number().int().nonnegative(),
        postedDocumentCount: z.number().int().nonnegative(),
        voidedDocumentCount: z.number().int().nonnegative(),
      }),
    }),
  ),
  grandTotals: z.object({
    count: z.number().int().nonnegative(),
    postedDocumentCount: z.number().int().nonnegative(),
    voidedDocumentCount: z.number().int().nonnegative(),
  }),
  kpis: z.array(reportKpiSchema),
  coverage: reportCoverageSchema,
  gaps: z.array(reportGapSchema),
});

/**
 * تعارض الفصل بين المهام — the wire contract for `GET /security-reports/sod`
 * (ENH-051). One row shape covers all three sources this report reads: a
 * ROLE definition that grants both sides of a `permissions/sod.ts` pair, a
 * USER who reaches that same pair through their role, and a TRANSACTIONAL
 * finding — the same actor recorded on both sides of a rule in the audit
 * trail itself. `kind` tells the screen which it is; the columns that do not
 * apply to a kind are null on that row rather than omitted, so the table
 * stays one shape.
 */
export const sodConflictKindSchema = z.enum(["role", "user", "transactional"]);

export const sodConflictRowSchema = z.object({
  rowKey: z.string().min(1),
  kind: sodConflictKindSchema,
  ruleId: z.string().min(1),
  conflictLabelAr: z.string().min(1),
  conflictLabelEn: z.string().min(1),
  subjectId: z.string().min(1),
  subjectLabelAr: z.string().min(1),
  roleId: z.string().nullable(),
  roleCode: z.string().nullable(),
  sideAPermissions: z.array(z.string()),
  sideBPermissions: z.array(z.string()),
  sideAActor: z.string().nullable(),
  sideBActor: z.string().nullable(),
  sideAAt: z.string().nullable(),
  sideBAt: z.string().nullable(),
  entityType: z.string().nullable(),
});

export const sodQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const sodReportSchema = z.object({
  id: z.literal("security.sod"),
  titleAr: z.string().min(1),
  params: z.object({ from: isoDateSchema, to: isoDateSchema }),
  columns: z.array(reportColumnSchema),
  rows: z.array(sodConflictRowSchema),
  groups: z.array(
    z.object({
      key: z.string().min(1),
      labelAr: z.string().min(1),
      rows: z.array(sodConflictRowSchema),
      totals: z.object({ count: z.number().int().nonnegative() }),
    }),
  ),
  grandTotals: z.object({
    count: z.number().int().nonnegative(),
    roleConflicts: z.number().int().nonnegative(),
    userConflicts: z.number().int().nonnegative(),
    transactionalConflicts: z.number().int().nonnegative(),
  }),
  kpis: z.array(reportKpiSchema),
  coverage: reportCoverageSchema,
  gaps: z.array(reportGapSchema),
});

export type SodConflictKindDTO = z.infer<typeof sodConflictKindSchema>;
export type SodConflictRowDTO = z.infer<typeof sodConflictRowSchema>;
export type SodQueryDTO = z.infer<typeof sodQuerySchema>;
export type SodReportDTO = z.infer<typeof sodReportSchema>;

export type SecurityExceptionsQueryDTO = z.infer<typeof securityExceptionsQuerySchema>;
export type PostPostingChangesQueryDTO = z.infer<typeof postPostingChangesQuerySchema>;
export type AfterHoursQueryDTO = z.infer<typeof afterHoursQuerySchema>;
export type NewAccountsQueryDTO = z.infer<typeof newAccountsQuerySchema>;

export type ReportCoverageDTO = z.infer<typeof reportCoverageSchema>;
export type ReportGapDTO = z.infer<typeof reportGapSchema>;
export type ReportColumnDTO = z.infer<typeof reportColumnSchema>;
export type ReportKpiDTO = z.infer<typeof reportKpiSchema>;

export type SecurityExceptionRowDTO = z.infer<typeof securityExceptionRowSchema>;
export type SecurityWatchlistEntryDTO = z.infer<typeof securityWatchlistEntrySchema>;
export type SecurityExceptionsReportDTO = z.infer<typeof securityExceptionsReportSchema>;
export type UnrecordedSecurityEventDTO = z.infer<typeof unrecordedSecurityEventSchema>;
export type UnrecordedSecurityEventsDTO = z.infer<typeof unrecordedSecurityEventsSchema>;

export type PostPostingChangeRowDTO = z.infer<typeof postPostingChangeRowSchema>;
export type PostPostingChangesReportDTO = z.infer<typeof postPostingChangesReportSchema>;

export type WorkingHoursDTO = z.infer<typeof workingHoursSchema>;
export type AfterHoursRowDTO = z.infer<typeof afterHoursRowSchema>;
export type AfterHoursReportDTO = z.infer<typeof afterHoursReportSchema>;

export type NewAccountRowDTO = z.infer<typeof newAccountRowSchema>;
export type NewAccountsReportDTO = z.infer<typeof newAccountsReportSchema>;
