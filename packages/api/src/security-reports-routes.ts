import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  DEFAULT_SETTINGS,
  detectSodConflicts,
  pageReportGroups,
  readReportPage,
  getSodConflictRule,
  SodConflictId,
  WILDCARD_PERMISSION,
  type AuditEvent,
  type AuditQueryFilter,
  type AuditQueryPort,
  type AuditSeverity,
  type AuditStream,
  type RoleRepository,
  type SecurityEventFallback,
  type SettingsRepository,
  type SodConflictMatch,
  type User,
  type UserRepository,
} from "@mezan/domain";
import {
  afterHoursQuerySchema,
  newAccountsQuerySchema,
  postPostingChangesQuerySchema,
  securityExceptionsQuerySchema,
  sodQuerySchema,
  type AfterHoursReportDTO,
  type AfterHoursRowDTO,
  type NewAccountRowDTO,
  type NewAccountsReportDTO,
  type PostPostingChangeRowDTO,
  type PostPostingChangesReportDTO,
  type ReportColumnDTO,
  type ReportCoverageDTO,
  type ReportGapDTO,
  type ReportKpiDTO,
  type SecurityExceptionRowDTO,
  type SecurityExceptionsReportDTO,
  type SecurityWatchlistEntryDTO,
  type SodConflictRowDTO,
  type SodReportDTO,
  type UnrecordedSecurityEventsDTO,
  type WorkingHoursDTO,
} from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { refuseBranchScopedCaller } from "./branch-scope-refusal.js";

/**
 * تقارير الرقابة والأمان — the exception-reporting surface, mounted at
 * `/security-reports`.
 *
 * WHY THIS EXISTS. `reports-routes.ts` serves 27 reports and every one of them
 * is operational — sales, purchases, stock, aging, drill-downs. Nothing
 * reported on the controls: not adjustments by user, not documents voided
 * after posting, not after-hours activity, not failed sign-ins, not permission
 * refusals, not admin PIN resets, not approval-config changes. The events were
 * being written (see `admin-audit.ts`) and the only way to read them was `GET
 * /audit`, a raw filtered log an auditor had to interrogate by knowing the
 * `action` strings by heart. A control nobody reports on is a control that does
 * not exist on a Tuesday.
 *
 * These are READS over the existing `AuditQueryPort` and the user register. No
 * new persistence, no new events, and — the rule that shapes every column below
 * — no computed substitutes. Where the trail records nothing (a void's reason,
 * an edit to a posted document) the column is `null` and the report says so in
 * its `gaps` list, because a plausible number in an exception report is worse
 * than a blank one: it exonerates.
 */
export interface SecurityReportsRoutesDeps {
  /** The append-only trail. The only source these reports aggregate over. */
  readonly audit: AuditQueryPort;
  readonly unrecorded?: SecurityEventFallback;
  /**
   * The user register, for حسابات أُنشئت حديثاً. Optional, and its route is
   * only mounted when a composition wires it — an app without it serves no
   * new-accounts report at all rather than an empty one, matching how
   * `reports-routes.ts` handles `boms` and `vanTrips`.
   */
  readonly users?: Pick<UserRepository, "list">;
  /**
   * The role register, for تعارض الفصل بين المهام (ENH-051). Optional and
   * gated the same way as `users`: an app without it serves the other three
   * reports and no `/sod` route, rather than one that always answers empty.
   */
  readonly roles?: Pick<RoleRepository, "list">;
  /**
   * Tenant settings, for the working day نشاط خارج أوقات العمل measures
   * "outside" against. Absent, the report still runs — on the documented
   * fallback below, and it says so.
   */
  readonly settings?: Pick<SettingsRepository, "get">;
  /** "Now" — overridable for tests; defaults to the real clock. */
  readonly now?: () => Date;
}

/**
 * The query port caps `limit` at 200 (packages/persistence/src/audit-sink.ts),
 * so an aggregate over a period is necessarily paged. This is the page size,
 * fixed here and never read off the request.
 */
const AUDIT_PAGE_SIZE = 200;

/**
 * How many audit rows one report may aggregate. Server-side, absolute, and
 * deliberately not a query parameter: a caller-supplied limit is not a limit.
 * When it bites, `coverage.truncated` goes true and every total below it is a
 * FLOOR — the screen has to say so rather than present a partial count as the
 * count.
 */
const SCAN_LIMIT = 20_000;

/** Newest matching raw events carried alongside the aggregate, as evidence. */
const RECENT_LIMIT = 50;

const SEVERITY_LABELS_AR: Readonly<Record<AuditSeverity, string>> = {
  CRITICAL: "حرِج",
  ERROR: "خطأ",
  WARNING: "تحذير",
  INFO: "معلومة",
};

/**
 * The named security controls تقرير الاستثناءات الأمنية reports on, in the
 * order an auditor reads them: what somebody tried to take, what was reset for
 * them, what locked, what failed, then the ordinary traffic that gives the rest
 * a denominator. Every one of these is written today — `users-routes.ts`,
 * `auth-routes.ts`, `roles-routes.ts`, `workflow-routes.ts`.
 *
 * An action MISSING from a period is reported at zero rather than omitted: a
 * blank row says the control reported and found nothing, while an absent row is
 * indistinguishable from a control that was never wired — which is exactly what
 * the أحداث الأمان tab looked like before those events existed.
 */
const SECURITY_WATCHLIST: readonly { readonly action: string; readonly labelAr: string }[] = [
  { action: "PRIVILEGE_ESCALATION_DENIED", labelAr: "محاولة توسيع صلاحيات مرفوضة" },
  { action: "CREDENTIAL_RESET_BY_ADMIN", labelAr: "إعادة تعيين بيانات دخول بواسطة مسؤول" },
  { action: "ACCOUNT_LOCKED", labelAr: "إيقاف حساب بعد محاولات فاشلة" },
  { action: "ACCOUNT_UNLOCKED", labelAr: "رفع إيقاف حساب" },
  { action: "LOGIN_BLOCKED", labelAr: "منع محاولة دخول (تجاوز الحد)" },
  { action: "LOGIN_FAILED", labelAr: "محاولة دخول فاشلة" },
  { action: "LOGIN_SUCCEEDED", labelAr: "دخول ناجح" },
  { action: "BOOTSTRAP_REFUSED", labelAr: "رفض تهيئة منشأة مملوكة" },
  { action: "TENANT_CLAIMED", labelAr: "تسجيل ملكية المنشأة" },
];

const WATCHLIST_LABELS = new Map(SECURITY_WATCHLIST.map((entry) => [entry.action, entry.labelAr]));

/** Also written on the security stream, from the self-service side. */
const OTHER_SECURITY_LABELS_AR: Readonly<Record<string, string>> = {
  PASSWORD_CHANGED: "تغيير كلمة المرور (ذاتي)",
};

function securityActionLabel(action: string): string {
  return WATCHLIST_LABELS.get(action) ?? OTHER_SECURITY_LABELS_AR[action] ?? action;
}

type PostPostingChangeType = "VOID" | "REVERSE" | "PERIOD_REOPENED" | "NUMBERING_ADJUSTED";

/**
 * The sensitive-stream actions that change something AFTER it was posted.
 *
 * `CANCEL` and `REVERSE` are the document-level ones (documents/service.ts,
 * sales-invoices/service.ts, gl/reverse.ts, purchasing/audit.ts). `REOPEN` and
 * the two `SEQUENCE_*` actions are here because they are what makes a
 * post-posting change POSSIBLE — reopening a closed period, or moving a
 * numbering counter — and an auditor reading a list of voids without the period
 * that was reopened to allow them is reading half the story.
 */
const POST_POSTING_ACTIONS: Readonly<Record<string, { readonly type: PostPostingChangeType; readonly labelAr: string }>> = {
  CANCEL: { type: "VOID", labelAr: "إلغاء مستند مرحَّل" },
  REVERSE: { type: "REVERSE", labelAr: "عكس قيد/مستند مرحَّل" },
  REOPEN: { type: "PERIOD_REOPENED", labelAr: "إعادة فتح فترة مقفلة" },
  SEQUENCE_COUNTER_ADJUSTED: { type: "NUMBERING_ADJUSTED", labelAr: "تعديل عدّاد الترقيم" },
  SEQUENCE_CONFIG_UPDATED: { type: "NUMBERING_ADJUSTED", labelAr: "تعديل إعدادات الترقيم" },
};

/** Audit actions that mean "this actor put a document into the books". */
const POSTING_ACTIONS = new Set(["CONFIRM", "POST"]);
/** Audit actions that mean "this actor took a posted document back out". */
const UNPOSTING_ACTIONS = new Set(["CANCEL", "REVERSE"]);

const WEEKDAY_LABELS_AR: readonly string[] = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * When the working day starts.
 *
 * A FALLBACK, AND SAID TO BE ONE. `TenantSettings` carries `weekendDays`,
 * `weekStartDay` and `standardDailyWorkHours` (how LONG a day is) but no field
 * for when it BEGINS — there is no `workDayStartHour` anywhere in
 * packages/domain/src/settings/settings.ts. 8:00 local is the assumption an
 * Egyptian shop's roster usually matches; it is not a recorded fact, so the
 * response carries `workingHours.startHourSource: "default"` whenever it is
 * used and the screen must show that an after-hours finding rests on an
 * assumption. The honest fix is a settings field, not a better guess.
 */
const DEFAULT_WORK_DAY_START_HOUR = 8;

interface CollectedEvents {
  readonly events: readonly AuditEvent[];
  readonly coverage: ReportCoverageDTO;
}

/**
 * Reads every audit row matching `filter`, paging around the port's 200-row
 * ceiling, up to {@link SCAN_LIMIT}.
 *
 * `filter.to` MUST be set by every caller and every caller sets it. Paging is
 * `ORDER BY id DESC LIMIT/OFFSET` over an append-only table, so a row appended
 * between two pages shifts the window and re-serves a row already counted. An
 * upper timestamp bound excludes anything written after the report started, and
 * the walk is then stable.
 */
async function collectEvents(port: AuditQueryPort, filter: AuditQueryFilter): Promise<CollectedEvents> {
  const events: AuditEvent[] = [];
  let matched = 0;
  let offset = 0;
  for (;;) {
    const page = await port.queryEvents({ ...filter, limit: AUDIT_PAGE_SIZE, offset });
    matched = page.total;
    events.push(...page.events);
    offset += page.events.length;
    if (page.events.length === 0 || offset >= page.total || events.length >= SCAN_LIMIT) break;
  }
  const scanned = Math.min(events.length, SCAN_LIMIT);
  return {
    events: events.slice(0, SCAN_LIMIT),
    coverage: { matched, scanned, truncated: scanned < matched, scanLimit: SCAN_LIMIT },
  };
}

function detailString(event: AuditEvent, key: string): string | null {
  const value = event.details?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * A stable render key. NOT an id: `AuditEvent` exposes none — the append-only
 * table has a rowid the read port does not project — so two byte-identical
 * events in the same millisecond share this key. Fine for a table row, wrong
 * for addressing a record, which is why nothing here accepts it back.
 */
function rowKeyOf(event: AuditEvent): string {
  return [event.timestamp, event.actor, event.action, event.entityType, event.entityId ?? ""].join("|");
}

function localDayString(at: Date): string {
  // The LOCAL calendar day, not `toISOString()` — that is UTC and hands back
  // yesterday for everyone east of Greenwich until the small hours, which is
  // every shop this ships to. Same reasoning as `reports-routes.ts:todayIso`.
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

function addDays(day: string, delta: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}

/**
 * A `YYYY-MM-DD` range widened to the UTC instants that bound it.
 *
 * The audit trail stores ISO-8601 UTC, and these two reports are read against a
 * calendar the auditor names in their own timezone — so the bounds are
 * deliberately GENEROUS (a full day either side of the tenant offset is
 * impossible; ±14h covers every real zone). Rows outside the tenant-local day
 * are filtered out again per row where it matters (نشاط خارج أوقات العمل), so
 * widening here costs a few extra rows read and never drops one.
 */
function utcBounds(from: string, to: string): { readonly from: string; readonly to: string } {
  return { from: `${addDays(from, -1)}T00:00:00.000Z`, to: `${addDays(to, 1)}T23:59:59.999Z` };
}

interface ZonedParts {
  readonly day: string;
  readonly time: string;
  readonly weekday: number;
  readonly minutesOfDay: number;
}

/**
 * An instant, in the tenant's timezone.
 *
 * `Intl` rather than a date library: no new dependencies, and the ICU data ships
 * with Node. `hourCycle: "h23"` is required — `hour12: false` renders midnight
 * as "24" in some ICU builds, which would file every midnight event as the
 * latest hour of the day it belongs to.
 */
function zonedParts(at: Date, formatter: Intl.DateTimeFormat): ZonedParts {
  const parts = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const year = parts.get("year") ?? "0000";
  const month = parts.get("month") ?? "01";
  const day = parts.get("day") ?? "01";
  const hour = Number(parts.get("hour") ?? "0");
  const minute = Number(parts.get("minute") ?? "0");
  const weekday = WEEKDAY_INDEX[parts.get("weekday") ?? "Sun"] ?? 0;
  return {
    day: `${year}-${month}-${day}`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    weekday,
    minutesOfDay: hour * 60 + minute,
  };
}

/** A formatter for `timeZone`, or one for UTC when the zone is not one ICU knows. */
function zoneFormatter(timeZone: string): { readonly formatter: Intl.DateTimeFormat; readonly resolved: boolean } {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  };
  try {
    return { formatter: new Intl.DateTimeFormat("en-US", { ...options, timeZone }), resolved: true };
  } catch {
    // A timezone the runtime cannot resolve must not silently become the
    // server's own zone: the report would then measure "after hours" against
    // wherever the machine happens to sit. UTC, declared as unresolved.
    return { formatter: new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }), resolved: false };
  }
}

function respondValidation(c: Context, errors: readonly { field: string; message: string }[]): Response {
  return c.json({ error: "VALIDATION_ERROR", errors }, 400);
}

function refuseAmbiguousActor(c: Context, field: string): Response {
  return c.json({ error: "VALIDATION_ERROR", errors: [{ field, message: "أكثر من مستخدم بهذا الاسم، اختر من القائمة" }] }, 422);
}

function flatten(issues: readonly { path: (string | number)[]; message: string }[]) {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "_root",
    message: issue.message,
  }));
}

function unrecordedOf(fallback: SecurityEventFallback | undefined, nameOf: (actor: string) => string): UnrecordedSecurityEventsDTO {
  if (!fallback) return { count: 0, recent: [], dropped: 0, corrupted: 0 };
  const { count, recent, dropped, corrupted } = fallback.summary();
  return {
    count,
    dropped,
    corrupted,
    recent: recent.map(({ at, module, action, severity, actor, entityId, reason }) => ({
      at,
      module,
      action,
      severity,
      actor,
      actorNameAr: nameOf(actor),
      entityId,
      reason,
    })),
  };
}

export function createSecurityReportsRoutes(
  deps: SecurityReportsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  /** These reports read the whole company's trail, users and roles; none of them narrows to a branch. */
  const companyWide: MiddlewareHandler = async (c, next) => refuseBranchScopedCaller(c) ?? (await next());

  const now = () => deps.now?.() ?? new Date();

  /** `actor` stays the id filters and drill-downs key on; system and deleted actors have no user row and show their id. */
  async function actorNames(): Promise<(actor: string) => string> {
    const names = new Map(((await deps.users?.list()) ?? []).map((user: User) => [user.id, user.nameAr]));
    return (actor) => names.get(actor) || actor;
  }

  async function actorFilterId(input: string | undefined): Promise<{ readonly id: string | undefined } | { readonly ambiguous: true }> {
    if (!input) return { id: undefined };
    const users = (await deps.users?.list()) ?? [];
    if (users.some((user: User) => user.id === input)) return { id: input };
    const wanted = input.trim().toLowerCase();
    const named = users.filter((user: User) => user.nameAr.trim().toLowerCase() === wanted || (user.nameEn ?? "").trim().toLowerCase() === wanted);
    if (named.length > 1) return { ambiguous: true };
    return { id: named.length === 1 ? named[0]!.id : input };
  }

  function queryParams(c: Context): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of new URL(c.req.url).searchParams) {
      if (value !== "") out[key] = value;
    }
    return out;
  }

  function defaultRange(): { from: string; to: string } {
    const today = localDayString(now());
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }

  /**
   * The working day, read from tenant settings where the field exists.
   *
   * `weekendDays` and `weekStartDay` are real settings and are used as such.
   * The START of the day is not a setting anywhere in this product, so it comes
   * from {@link DEFAULT_WORK_DAY_START_HOUR} and the response says
   * `startHourSource: "default"`.
   */
  async function workingHours(): Promise<WorkingHoursDTO> {
    const settings = (await deps.settings?.get()) ?? null;
    const timezone = settings?.timezone ?? DEFAULT_SETTINGS.timezone;
    const { resolved } = zoneFormatter(timezone);
    const dailyHours = settings?.standardDailyWorkHours ?? DEFAULT_SETTINGS.standardDailyWorkHours;
    const startHour = DEFAULT_WORK_DAY_START_HOUR;
    return {
      timezone,
      timezoneResolved: resolved,
      startHour,
      // Clamped at midnight rather than wrapped: a window that ran into the
      // next day would mark the small hours as ordinary working time, and the
      // small hours are the whole point of this report.
      endHour: Math.min(startHour + dailyHours, 24),
      standardDailyWorkHours: dailyHours,
      weekendDays: [...(settings?.weekendDays ?? DEFAULT_SETTINGS.weekendDays)],
      weekStartDay: settings?.weekStartDay ?? DEFAULT_SETTINGS.weekStartDay,
      startHourSource: "default",
      weekendSource: settings ? "settings" : "default",
    };
  }

  // --- 1) تقرير الاستثناءات الأمنية ------------------------------------------
  //
  // Every security-stream event in the period, grouped by actor, counted by
  // action and by severity. This is the report that turns "the escalation guard
  // returned 403 fifty times last week" from a row nobody queried into a line
  // with a name on it.

  app.get("/exceptions", gate("audit.logs.view"), companyWide, async (c) => {
    const parsed = securityExceptionsQuerySchema.safeParse(queryParams(c));
    if (!parsed.success) return respondValidation(c, flatten(parsed.error.issues));

    const fallback = defaultRange();
    const from = parsed.data.from ?? fallback.from;
    const to = parsed.data.to ?? fallback.to;
    if (from > to) {
      return respondValidation(c, [{ field: "from", message: "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية." }]);
    }
    const bounds = utcBounds(from, to);
    const actor = await actorFilterId(parsed.data.actor);
    if ("ambiguous" in actor) return refuseAmbiguousActor(c, "actor");
    const actorFilter = actor.id;

    const filter: AuditQueryFilter = {
      stream: "security",
      ...bounds,
      ...(actorFilter ? { actor: actorFilter } : {}),
      ...(parsed.data.action ? { action: parsed.data.action } : {}),
      ...(parsed.data.severity ? { severity: parsed.data.severity } : {}),
    };
    const [{ events, coverage }, nameOf] = await Promise.all([collectEvents(deps.audit, filter), actorNames()]);

    interface Cell {
      actor: string;
      action: string;
      module: string;
      count: number;
      critical: number;
      error: number;
      warning: number;
      info: number;
      firstAt: string;
      lastAt: string;
    }
    const cells = new Map<string, Cell>();
    const watchCounts = new Map<string, { count: number; actors: Set<string>; lastAt: string | null }>();
    for (const entry of SECURITY_WATCHLIST) {
      watchCounts.set(entry.action, { count: 0, actors: new Set(), lastAt: null });
    }

    for (const event of events) {
      const key = `${event.actor} ${event.action}`;
      const cell = cells.get(key) ?? {
        actor: event.actor,
        action: event.action,
        module: event.module,
        count: 0,
        critical: 0,
        error: 0,
        warning: 0,
        info: 0,
        firstAt: event.timestamp,
        lastAt: event.timestamp,
      };
      cell.count += 1;
      if (event.severity === "CRITICAL") cell.critical += 1;
      else if (event.severity === "ERROR") cell.error += 1;
      else if (event.severity === "WARNING") cell.warning += 1;
      else cell.info += 1;
      if (event.timestamp < cell.firstAt) cell.firstAt = event.timestamp;
      if (event.timestamp > cell.lastAt) cell.lastAt = event.timestamp;
      cells.set(key, cell);

      const watch = watchCounts.get(event.action);
      if (watch) {
        watch.count += 1;
        watch.actors.add(event.actor);
        if (!watch.lastAt || event.timestamp > watch.lastAt) watch.lastAt = event.timestamp;
      }
    }

    const rows: SecurityExceptionRowDTO[] = [...cells.values()]
      .map((cell) => ({
        actor: cell.actor,
        actorNameAr: nameOf(cell.actor),
        action: cell.action,
        actionLabelAr: securityActionLabel(cell.action),
        module: cell.module,
        count: cell.count,
        critical: cell.critical,
        error: cell.error,
        warning: cell.warning,
        info: cell.info,
        firstAt: cell.firstAt,
        lastAt: cell.lastAt,
      }))
      .sort((a, b) => b.critical - a.critical || b.count - a.count || a.actor.localeCompare(b.actor));

    const byActor = new Map<string, SecurityExceptionRowDTO[]>();
    for (const row of rows) {
      const bucket = byActor.get(row.actor);
      if (bucket) bucket.push(row);
      else byActor.set(row.actor, [row]);
    }
    const groups = [...byActor.entries()]
      .map(([actor, actorRows]) => ({
        key: actor,
        labelAr: nameOf(actor),
        rows: actorRows,
        totals: {
          count: actorRows.reduce((sum, row) => sum + row.count, 0),
          critical: actorRows.reduce((sum, row) => sum + row.critical, 0),
        },
      }))
      .sort((a, b) => b.totals.critical - a.totals.critical || b.totals.count - a.totals.count);

    const grandTotals = {
      count: rows.reduce((sum, row) => sum + row.count, 0),
      critical: rows.reduce((sum, row) => sum + row.critical, 0),
    };

    const watchlist: SecurityWatchlistEntryDTO[] = SECURITY_WATCHLIST.map((entry) => {
      const counted = watchCounts.get(entry.action);
      return {
        action: entry.action,
        labelAr: entry.labelAr,
        count: counted?.count ?? 0,
        actorCount: counted?.actors.size ?? 0,
        lastAt: counted?.lastAt ?? null,
      };
    });

    const deniedCount = watchlist.find((w) => w.action === "PRIVILEGE_ESCALATION_DENIED")?.count ?? 0;
    const resetCount = watchlist.find((w) => w.action === "CREDENTIAL_RESET_BY_ADMIN")?.count ?? 0;
    const failedCount = watchlist.find((w) => w.action === "LOGIN_FAILED")?.count ?? 0;
    const lockedCount = watchlist.find((w) => w.action === "ACCOUNT_LOCKED")?.count ?? 0;

    const kpis: ReportKpiDTO[] = [
      { key: "events", labelAr: "إجمالي الأحداث الأمنية", value: grandTotals.count },
      { key: "actors", labelAr: "عدد المستخدمين", value: groups.length },
      {
        key: "escalationDenied",
        labelAr: "محاولات توسيع صلاحيات مرفوضة",
        value: deniedCount,
        tone: deniedCount > 0 ? "danger" : "default",
      },
      {
        key: "credentialResets",
        labelAr: "إعادة تعيين بيانات دخول بواسطة مسؤول",
        value: resetCount,
        tone: resetCount > 0 ? "danger" : "default",
      },
      { key: "loginFailed", labelAr: "محاولات دخول فاشلة", value: failedCount, tone: failedCount > 0 ? "warning" : "default" },
      { key: "accountsLocked", labelAr: "حسابات أُوقفت", value: lockedCount, tone: lockedCount > 0 ? "warning" : "default" },
    ];

    const columns: ReportColumnDTO[] = [
      { key: "actorNameAr", labelAr: "المستخدم" },
      { key: "actionLabelAr", labelAr: "الحدث" },
      { key: "count", labelAr: "العدد", format: "qty" },
      { key: "critical", labelAr: SEVERITY_LABELS_AR.CRITICAL, format: "qty" },
      { key: "warning", labelAr: SEVERITY_LABELS_AR.WARNING, format: "qty" },
      { key: "info", labelAr: SEVERITY_LABELS_AR.INFO, format: "qty" },
      { key: "firstAt", labelAr: "أول حدوث", format: "datetime" },
      { key: "lastAt", labelAr: "آخر حدوث", format: "datetime" },
    ];

    const body: SecurityExceptionsReportDTO = {
      id: "security.exceptions",
      titleAr: "تقرير الاستثناءات الأمنية",
      params: {
        from,
        to,
        actor: parsed.data.actor ?? null,
        action: parsed.data.action ?? null,
        severity: parsed.data.severity ?? null,
      },
      columns,
      rows,
      groups,
      grandTotals,
      watchlist,
      kpis,
      // Newest first, server-capped. The full trail stays one query away at
      // `/audit?stream=security&actor=…&action=…` — this is the evidence beside
      // the count, not a second copy of the log.
      recent: [...events]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, RECENT_LIMIT),
      unrecorded: unrecordedOf(deps.unrecorded, nameOf),
      coverage,
      gaps: [
        {
          key: "device",
          labelAr: "الجهاز/المصدر",
          detailAr:
            "أحداث الدخول تسجّل مصدر الطلب (المضيف أو الشبكة) فقط؛ لا يوجد سجل لجهاز أو عنوان محدد، فلا يمكن للتقرير تحديد الجهاز.",
        },
        {
          key: "permissionDenied",
          labelAr: "رفض الصلاحيات العام",
          detailAr:
            "بوابة الصلاحيات ترجع 403 دون تسجيل حدث، فالمُسجَّل هنا هو رفض توسيع الصلاحيات فقط. رفض فتح شاشة أو تنفيذ إجراء لا يظهر في أي تقرير.",
        },
      ],
    };
    return c.json(body);
  });

  // --- 2) تقرير التعديلات بعد الترحيل ----------------------------------------

  app.get("/post-posting-changes", gate("audit.logs.view"), companyWide, async (c) => {
    const parsed = postPostingChangesQuerySchema.safeParse(queryParams(c));
    if (!parsed.success) return respondValidation(c, flatten(parsed.error.issues));

    const fallback = defaultRange();
    const from = parsed.data.from ?? fallback.from;
    const to = parsed.data.to ?? fallback.to;
    if (from > to) {
      return respondValidation(c, [{ field: "from", message: "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية." }]);
    }
    const bounds = utcBounds(from, to);
    const actor = await actorFilterId(parsed.data.actor);
    if ("ambiguous" in actor) return refuseAmbiguousActor(c, "actor");
    const actorFilter = actor.id;

    // One query per action rather than one unfiltered sweep: `AuditQueryFilter`
    // matches a single `action`, and reading the whole sensitive stream to throw
    // most of it away would burn the scan budget on CONFIRM rows.
    const collected = await Promise.all(
      Object.keys(POST_POSTING_ACTIONS)
        .filter((action) => {
          if (!parsed.data.changeType) return true;
          return POST_POSTING_ACTIONS[action]?.type === parsed.data.changeType;
        })
        .map((action) =>
          collectEvents(deps.audit, {
            stream: "sensitive",
            action,
            ...bounds,
            ...(actorFilter ? { actor: actorFilter } : {}),
            ...(parsed.data.entityType ? { entityType: parsed.data.entityType } : {}),
          }),
        ),
    );

    const nameOf = await actorNames();
    const events = collected.flatMap((result) => result.events);
    const coverage: ReportCoverageDTO = {
      matched: collected.reduce((sum, result) => sum + result.coverage.matched, 0),
      scanned: collected.reduce((sum, result) => sum + result.coverage.scanned, 0),
      truncated: collected.some((result) => result.coverage.truncated),
      scanLimit: SCAN_LIMIT,
    };

    const rows: PostPostingChangeRowDTO[] = events
      .map((event) => {
        const spec = POST_POSTING_ACTIONS[event.action];
        return {
          rowKey: rowKeyOf(event),
          timestamp: event.timestamp,
          actor: event.actor,
          actorNameAr: nameOf(event.actor),
          module: event.module,
          entityType: event.entityType,
          entityId: event.entityId,
          docNo: detailString(event, "docNo") ?? detailString(event, "entryNo"),
          action: event.action,
          changeType: spec?.type ?? "VOID",
          changeTypeLabelAr: spec?.labelAr ?? event.action,
          severity: event.severity,
          branchId: event.branchId,
          reversalId: detailString(event, "reversalId"),
          // Read, never derived. No cancel/reverse path in this build captures
          // a reason (documents/service.ts and gl/reverse.ts both write only
          // ids and status), so this is null on every row today — and stays a
          // real read so it starts working the day a reason is recorded.
          reason: detailString(event, "reason"),
        } satisfies PostPostingChangeRowDTO;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const byActor = new Map<string, PostPostingChangeRowDTO[]>();
    for (const row of rows) {
      const bucket = byActor.get(row.actor);
      if (bucket) bucket.push(row);
      else byActor.set(row.actor, [row]);
    }
    const groups = [...byActor.entries()]
      .map(([actor, actorRows]) => ({
        key: actor,
        labelAr: nameOf(actor),
        rows: actorRows,
        totals: {
          count: actorRows.length,
          withoutReason: actorRows.filter((row) => row.reason === null).length,
        },
      }))
      .sort((a, b) => b.totals.count - a.totals.count || a.key.localeCompare(b.key));

    const grandTotals = {
      count: rows.length,
      withoutReason: rows.filter((row) => row.reason === null).length,
    };

    const voidCount = rows.filter((row) => row.changeType === "VOID").length;
    const reverseCount = rows.filter((row) => row.changeType === "REVERSE").length;
    const reopenCount = rows.filter((row) => row.changeType === "PERIOD_REOPENED").length;
    const numberingCount = rows.filter((row) => row.changeType === "NUMBERING_ADJUSTED").length;

    const kpis: ReportKpiDTO[] = [
      { key: "changes", labelAr: "إجمالي التعديلات بعد الترحيل", value: grandTotals.count },
      { key: "actors", labelAr: "عدد المستخدمين", value: groups.length },
      { key: "voids", labelAr: "إلغاءات", value: voidCount, tone: voidCount > 0 ? "warning" : "default" },
      { key: "reversals", labelAr: "عكس قيود", value: reverseCount, tone: reverseCount > 0 ? "warning" : "default" },
      { key: "periodReopens", labelAr: "إعادة فتح فترات", value: reopenCount, tone: reopenCount > 0 ? "danger" : "default" },
      { key: "numbering", labelAr: "تعديلات الترقيم", value: numberingCount, tone: numberingCount > 0 ? "danger" : "default" },
      {
        key: "withoutReason",
        labelAr: "بدون سبب مسجَّل",
        value: grandTotals.withoutReason,
        tone: grandTotals.withoutReason > 0 ? "danger" : "default",
      },
    ];

    const columns: ReportColumnDTO[] = [
      { key: "timestamp", labelAr: "التاريخ والوقت", format: "datetime" },
      { key: "actorNameAr", labelAr: "المستخدم" },
      { key: "changeTypeLabelAr", labelAr: "نوع التعديل" },
      { key: "entityType", labelAr: "نوع المستند" },
      { key: "docNo", labelAr: "رقم المستند" },
      { key: "reversalId", labelAr: "مستند العكس" },
      { key: "reason", labelAr: "السبب" },
      { key: "branchId", labelAr: "الفرع" },
    ];

    const body: PostPostingChangesReportDTO = {
      id: "security.post_posting_changes",
      titleAr: "تقرير التعديلات بعد الترحيل",
      params: {
        from,
        to,
        actor: parsed.data.actor ?? null,
        entityType: parsed.data.entityType ?? null,
        changeType: parsed.data.changeType ?? null,
      },
      columns,
      rows,
      groups,
      grandTotals,
      kpis,
      coverage,
      gaps: [
        {
          key: "reason",
          labelAr: "سبب الإلغاء أو العكس",
          detailAr:
            "لا يطلب أي مسار إلغاء أو عكس سبباً، ولا يسجّل أي حدث حقل «reason»، فعمود السبب فارغ دائماً اليوم. الحل هو حقل سبب إلزامي عند الإلغاء والعكس، يُكتب داخل تفاصيل حدث المراجعة.",
        },
        {
          key: "editedAfterPosting",
          labelAr: "تعديل مستند مرحَّل",
          detailAr:
            "لا يوجد حدث «تعديل بعد الترحيل» في السجل: المستند المرحَّل لا يُعدَّل، بل يُلغى أو يُعكس، ولا تُسجَّل أي مقارنة قبل/بعد لبنوده. لذلك يعرض التقرير الإلغاء والعكس فقط — ولا يخمّن تعديلاً لم يُسجَّل.",
        },
        {
          key: "approvalOverride",
          labelAr: "تجاوز دورة الاعتماد",
          detailAr:
            "تغيير إعدادات الاعتماد مُسجَّل (WORKFLOW_CONFIG)، لكن تجاوز خطوة اعتماد على مستند بعينه غير مُسجَّل، فلا يمكن ربط تعديل بعد الترحيل بتجاوز اعتماد.",
        },
      ],
    };
    return c.json(body);
  });

  // --- 3) نشاط خارج أوقات العمل ----------------------------------------------

  app.get("/after-hours", gate("audit.logs.view"), companyWide, async (c) => {
    const parsed = afterHoursQuerySchema.safeParse(queryParams(c));
    if (!parsed.success) return respondValidation(c, flatten(parsed.error.issues));
    const paging = readReportPage(queryParams(c));
    if (!paging.ok) return respondValidation(c, paging.errors);

    const fallback = defaultRange();
    const from = parsed.data.from ?? fallback.from;
    const to = parsed.data.to ?? fallback.to;
    if (from > to) {
      return respondValidation(c, [{ field: "from", message: "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية." }]);
    }
    const bounds = utcBounds(from, to);
    const actor = await actorFilterId(parsed.data.actor);
    if ("ambiguous" in actor) return refuseAmbiguousActor(c, "actor");
    const actorFilter = actor.id;

    const hours = await workingHours();
    const { formatter } = zoneFormatter(hours.timezone);
    const weekend = new Set(hours.weekendDays);
    const startMinutes = hours.startHour * 60;
    const endMinutes = hours.endHour * 60;

    const streams: readonly AuditStream[] = parsed.data.stream ? [parsed.data.stream] : ["security", "sensitive"];
    const collected = await Promise.all(
      streams.map((stream) =>
        collectEvents(deps.audit, {
          stream,
          ...bounds,
          ...(actorFilter ? { actor: actorFilter } : {}),
          ...(parsed.data.severity ? { severity: parsed.data.severity } : {}),
        }),
      ),
    );
    const nameOf = await actorNames();
    const events = collected.flatMap((result) => result.events);

    const rows: AfterHoursRowDTO[] = [];
    for (const event of events) {
      const at = new Date(event.timestamp);
      if (Number.isNaN(at.getTime())) continue;
      const local = zonedParts(at, formatter);
      // The tenant-local day decides membership of the requested range — the
      // UTC bounds above are deliberately wide, and a Cairo evening belongs to
      // the Cairo day it happened on, not the UTC day it was written in.
      if (local.day < from || local.day > to) continue;

      const outsideReason = weekend.has(local.weekday)
        ? "WEEKEND"
        : local.minutesOfDay < startMinutes
          ? "BEFORE_HOURS"
          : local.minutesOfDay >= endMinutes
            ? "AFTER_HOURS"
            : null;
      if (!outsideReason) continue;

      rows.push({
        rowKey: rowKeyOf(event),
        timestamp: event.timestamp,
        localDate: local.day,
        localTime: local.time,
        weekday: local.weekday,
        weekdayLabelAr: WEEKDAY_LABELS_AR[local.weekday] ?? String(local.weekday),
        outsideReason,
        outsideReasonLabelAr:
          outsideReason === "WEEKEND"
            ? "يوم عطلة"
            : outsideReason === "BEFORE_HOURS"
              ? "قبل بدء الدوام"
              : "بعد انتهاء الدوام",
        actor: event.actor,
        actorNameAr: nameOf(event.actor),
        stream: event.stream,
        module: event.module,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        severity: event.severity,
        branchId: event.branchId,
      });
    }
    rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const byActor = new Map<string, AfterHoursRowDTO[]>();
    for (const row of rows) {
      const bucket = byActor.get(row.actor);
      if (bucket) bucket.push(row);
      else byActor.set(row.actor, [row]);
    }
    const groups = [...byActor.entries()]
      .map(([actor, actorRows]) => ({
        key: actor,
        labelAr: nameOf(actor),
        rows: actorRows,
        totals: {
          count: actorRows.length,
          weekend: actorRows.filter((row) => row.outsideReason === "WEEKEND").length,
          critical: actorRows.filter((row) => row.severity === "CRITICAL").length,
        },
      }))
      .sort((a, b) => b.totals.count - a.totals.count || a.key.localeCompare(b.key));

    const grandTotals = {
      count: rows.length,
      weekend: rows.filter((row) => row.outsideReason === "WEEKEND").length,
      critical: rows.filter((row) => row.severity === "CRITICAL").length,
    };

    const kpis: ReportKpiDTO[] = [
      { key: "events", labelAr: "أحداث خارج الدوام", value: grandTotals.count, tone: grandTotals.count > 0 ? "warning" : "default" },
      { key: "actors", labelAr: "عدد المستخدمين", value: groups.length },
      { key: "weekend", labelAr: "في أيام العطلة", value: grandTotals.weekend, tone: grandTotals.weekend > 0 ? "danger" : "default" },
      { key: "critical", labelAr: "أحداث حرِجة", value: grandTotals.critical, tone: grandTotals.critical > 0 ? "danger" : "default" },
    ];

    const columns: ReportColumnDTO[] = [
      { key: "localDate", labelAr: "التاريخ", format: "date" },
      { key: "localTime", labelAr: "الوقت" },
      { key: "weekdayLabelAr", labelAr: "اليوم" },
      { key: "outsideReasonLabelAr", labelAr: "سبب الاستثناء" },
      { key: "actorNameAr", labelAr: "المستخدم" },
      { key: "action", labelAr: "الإجراء" },
      { key: "entityType", labelAr: "النوع" },
      { key: "entityId", labelAr: "المرجع" },
      { key: "branchId", labelAr: "الفرع" },
    ];

    const body: AfterHoursReportDTO = {
      id: "security.after_hours",
      titleAr: "نشاط خارج أوقات العمل",
      params: {
        from,
        to,
        actor: parsed.data.actor ?? null,
        stream: parsed.data.stream ?? null,
        severity: parsed.data.severity ?? null,
      },
      workingHours: hours,
      columns,
      ...(paging.window ? pageReportGroups(groups, paging.window) : { rows: groups.flatMap((group) => group.rows), groups }),
      grandTotals,
      kpis,
      coverage: {
        matched: collected.reduce((sum, result) => sum + result.coverage.matched, 0),
        scanned: collected.reduce((sum, result) => sum + result.coverage.scanned, 0),
        truncated: collected.some((result) => result.coverage.truncated),
        scanLimit: SCAN_LIMIT,
      },
      gaps: [
        {
          key: "workDayStart",
          labelAr: "بداية الدوام",
          detailAr:
            "إعدادات المنشأة تحدد أيام العطلة وطول يوم العمل، ولا تحدد ساعة بدايته. يفترض التقرير الساعة 8:00 بتوقيت المنشأة ويعلن ذلك في workingHours.startHourSource — أي نتيجة هنا مبنية على افتراض حتى يُضاف الحقل.",
        },
        {
          key: "shifts",
          labelAr: "الورديات",
          detailAr:
            "لا يوجد جدول ورديات لكل مستخدم أو فرع، فيُقاس الجميع على يوم عمل واحد. موظف وردية مسائية سيظهر هنا دائماً.",
        },
        {
          key: "holidays",
          labelAr: "الإجازات الرسمية",
          detailAr: "لا يوجد تقويم إجازات في الإعدادات، فالإجازة الرسمية تُقاس كيوم عمل عادي.",
        },
      ],
    };
    return c.json(body);
  });

  // --- 4) حسابات أُنشئت حديثاً ------------------------------------------------
  //
  // THE GHOST-EMPLOYEE JOIN. `admin.users.create` alone is enough to onboard a
  // fake account — the creator sets its PIN in the same request — transact as
  // it, and retire it. The trail then holds two unrelated actors: the creator,
  // and the account that posted the documents. This report is the only place
  // the two are put on one line, by reading the audit `CREATE` row that named
  // the creator and counting what the created account went on to post.
  //
  // Only mounted when a composition wires the user register, matching how
  // `reports-routes.ts` mounts make-vs-buy and van-sales.

  if (deps.users) {
    const users = deps.users;

    app.get("/new-accounts", gate("audit.logs.view"), companyWide, async (c) => {
      const parsed = newAccountsQuerySchema.safeParse(queryParams(c));
      if (!parsed.success) return respondValidation(c, flatten(parsed.error.issues));
      const creator = await actorFilterId(parsed.data.createdBy);
      if ("ambiguous" in creator) return refuseAmbiguousActor(c, "createdBy");

      // Recomputed server-side, always. The caller may ask for a window; what
      // it gets is a bounded one.
      const days = Math.min(Math.max(parsed.data.days ?? 90, 1), 365);
      const since = addDays(localDayString(now()), -days);
      const scanFrom = `${addDays(since, -1)}T00:00:00.000Z`;
      const nowIso = now().toISOString();

      const all = await users.list();
      const nameById = new Map(all.map((user: User) => [user.id, user.nameAr]));
      const recent = all
        .filter((user: User) => user.createdAt >= since)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const recentIds = new Set(recent.map((user) => user.id));

      // Who created them: the sensitive-stream CREATE rows on USER entities.
      // `entityId` carries the created account, `actor` the administrator who
      // did it — the join the audit log holds and no screen ever made.
      const creations = await collectEvents(deps.audit, {
        stream: "sensitive",
        module: "admin",
        entityType: "USER",
        action: "CREATE",
        from: scanFrom,
        to: nowIso,
      });
      const createdBy = new Map<string, { actor: string; at: string }>();
      for (const event of creations.events) {
        if (!event.entityId || !recentIds.has(event.entityId)) continue;
        const existing = createdBy.get(event.entityId);
        // The EARLIEST CREATE row wins: the append-only table can hold more
        // than one if an account id were ever reused, and the first is the one
        // that brought the account into existence.
        if (!existing || event.timestamp < existing.at) {
          createdBy.set(event.entityId, { actor: event.actor, at: event.timestamp });
        }
      }

      const resets = await collectEvents(deps.audit, {
        stream: "security",
        action: "CREDENTIAL_RESET_BY_ADMIN",
        from: scanFrom,
        to: nowIso,
      });
      const resetCounts = new Map<string, number>();
      for (const event of resets.events) {
        if (!event.entityId || !recentIds.has(event.entityId)) continue;
        resetCounts.set(event.entityId, (resetCounts.get(event.entityId) ?? 0) + 1);
      }

      // What each account went on to do. Counted per actor over the sensitive
      // stream, one query per account rather than one sweep of the whole
      // stream — the port filters on `actor`, and a tenant's document traffic
      // dwarfs its user list.
      const activity = await Promise.all(
        recent.map(async (user) => {
          const own = await collectEvents(deps.audit, {
            stream: "sensitive",
            actor: user.id,
            from: scanFrom,
            to: nowIso,
          });
          const posted = new Set<string>();
          const voided = new Set<string>();
          let firstAt: string | null = null;
          let lastAt: string | null = null;
          for (const event of own.events) {
            if (!firstAt || event.timestamp < firstAt) firstAt = event.timestamp;
            if (!lastAt || event.timestamp > lastAt) lastAt = event.timestamp;
            // Keyed by entity so two CONFIRM rows on one document count once.
            // A document is still only counted if the audit sink was reachable
            // when it posted — recording is best-effort by design
            // (admin-audit.ts), so this is a floor, never a ledger figure.
            const key = `${event.entityType} ${event.entityId ?? ""}`;
            if (POSTING_ACTIONS.has(event.action)) posted.add(key);
            else if (UNPOSTING_ACTIONS.has(event.action)) voided.add(key);
          }
          return { user, posted: posted.size, voided: voided.size, firstAt, lastAt, coverage: own.coverage };
        }),
      );

      let rows: NewAccountRowDTO[] = activity.map(({ user, posted, voided, firstAt, lastAt }) => {
        const creation = createdBy.get(user.id);
        return {
          userId: user.id,
          nameAr: user.nameAr,
          email: user.email,
          status: user.status,
          isCompanyAdmin: user.isCompanyAdmin,
          roleId: user.roleId,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          createdBy: creation?.actor ?? null,
          createdByNameAr: creation ? nameById.get(creation.actor) || creation.actor : null,
          createdByEventAt: creation?.at ?? null,
          postedDocumentCount: posted,
          voidedDocumentCount: voided,
          credentialResetCount: resetCounts.get(user.id) ?? 0,
          firstActivityAt: firstAt,
          lastActivityAt: lastAt,
        } satisfies NewAccountRowDTO;
      });

      if (creator.id) {
        const wanted = creator.id;
        rows = rows.filter((row) => row.createdBy === wanted);
      }

      const byCreator = new Map<string, NewAccountRowDTO[]>();
      for (const row of rows) {
        // Grouping by creator is the point of the report: a single
        // administrator who onboarded several accounts that then posted and
        // were retired is one group, not four unrelated rows.
        const key = row.createdBy ?? "";
        const bucket = byCreator.get(key);
        if (bucket) bucket.push(row);
        else byCreator.set(key, [row]);
      }
      const groups = [...byCreator.entries()]
        .map(([creator, creatorRows]) => ({
          key: creator === "" ? "__unknown__" : creator,
          labelAr: creator === "" ? "منشئ غير مسجَّل" : nameById.get(creator) || creator,
          rows: creatorRows,
          totals: {
            count: creatorRows.length,
            postedDocumentCount: creatorRows.reduce((sum, row) => sum + row.postedDocumentCount, 0),
            voidedDocumentCount: creatorRows.reduce((sum, row) => sum + row.voidedDocumentCount, 0),
          },
        }))
        .sort((a, b) => b.totals.count - a.totals.count || a.key.localeCompare(b.key));

      const grandTotals = {
        count: rows.length,
        postedDocumentCount: rows.reduce((sum, row) => sum + row.postedDocumentCount, 0),
        voidedDocumentCount: rows.reduce((sum, row) => sum + row.voidedDocumentCount, 0),
      };

      const unknownCreator = rows.filter((row) => row.createdBy === null).length;
      const neverSignedIn = rows.filter((row) => row.lastLoginAt === null).length;
      const admins = rows.filter((row) => row.isCompanyAdmin).length;
      const retired = rows.filter((row) => row.status === "inactive").length;

      const kpis: ReportKpiDTO[] = [
        { key: "accounts", labelAr: "حسابات جديدة", value: grandTotals.count },
        { key: "admins", labelAr: "بصلاحية مسؤول منشأة", value: admins, tone: admins > 0 ? "danger" : "default" },
        {
          key: "unknownCreator",
          labelAr: "بدون منشئ مسجَّل",
          value: unknownCreator,
          tone: unknownCreator > 0 ? "warning" : "default",
        },
        { key: "neverSignedIn", labelAr: "لم يسجّل دخولاً قط", value: neverSignedIn },
        {
          key: "retired",
          labelAr: "أُوقف بعد الإنشاء",
          value: retired,
          tone: retired > 0 ? "warning" : "default",
        },
        { key: "posted", labelAr: "مستندات رحّلتها", value: grandTotals.postedDocumentCount },
      ];

      const columns: ReportColumnDTO[] = [
        { key: "createdAt", labelAr: "تاريخ الإنشاء", format: "datetime" },
        { key: "nameAr", labelAr: "الاسم" },
        { key: "email", labelAr: "البريد/اسم الدخول" },
        { key: "createdByNameAr", labelAr: "أنشأه" },
        { key: "status", labelAr: "الحالة" },
        { key: "lastLoginAt", labelAr: "آخر دخول", format: "datetime" },
        { key: "postedDocumentCount", labelAr: "مستندات رحّلها", format: "qty" },
        { key: "voidedDocumentCount", labelAr: "مستندات ألغاها", format: "qty" },
        { key: "credentialResetCount", labelAr: "إعادة تعيين بيانات الدخول", format: "qty" },
      ];

      const coverage: ReportCoverageDTO = {
        matched:
          creations.coverage.matched +
          resets.coverage.matched +
          activity.reduce((sum, entry) => sum + entry.coverage.matched, 0),
        scanned:
          creations.coverage.scanned +
          resets.coverage.scanned +
          activity.reduce((sum, entry) => sum + entry.coverage.scanned, 0),
        truncated:
          creations.coverage.truncated ||
          resets.coverage.truncated ||
          activity.some((entry) => entry.coverage.truncated),
        scanLimit: SCAN_LIMIT,
      };

      const body: NewAccountsReportDTO = {
        id: "security.new_accounts",
        titleAr: "حسابات أُنشئت حديثاً",
        params: { days, since, createdBy: parsed.data.createdBy ?? null },
        columns,
        rows,
        groups,
        grandTotals,
        kpis,
        coverage,
        gaps: [
          {
            key: "createdByField",
            labelAr: "منشئ الحساب",
            detailAr:
              "سجل المستخدم لا يحمل حقل «أنشأه»؛ الرابط الوحيد هو حدث CREATE في سجل المراجعة. الحسابات المُهيّأة أو المُرحّلة أو المُنشأة قبل تسجيل هذا الحدث تظهر «بدون منشئ مسجَّل» — وهي حقيقة لا تُخمَّن.",
          },
          {
            key: "postedCount",
            labelAr: "عدد المستندات المُرحَّلة",
            detailAr:
              "العدد محسوب من أحداث CONFIRM/POST في سجل المراجعة لا من دفاتر المستندات، وتسجيل الحدث «أفضل جهد» بحكم التصميم، فالرقم حدٌّ أدنى وليس رصيداً محاسبياً. الربط القاطع يحتاج حقل «أنشأه/رحّله» على المستند نفسه.",
          },
          {
            key: "deletion",
            labelAr: "حذف الحساب",
            detailAr:
              "لا يوجد حذف للمستخدمين — الإيقاف فقط — فالحساب «المتقاعد» يظهر هنا بحالة «موقوف». لا يمكن للتقرير كشف حساب حُذف من قاعدة البيانات مباشرة.",
          },
        ],
      };
      return c.json(body);
    });
  }

  // --- 5) تعارض الفصل بين المهام (ENH-051) ------------------------------------
  //
  // Three sources, one row shape: a ROLE that grants both sides of a
  // `permissions/sod.ts` pair, a USER who reaches that pair through their
  // role, and a TRANSACTIONAL finding read off the audit trail — the same
  // actor recorded on both sides of a pair. The generic document engine
  // (`documents/service.ts`) audits CONFIRM/CANCEL/REVERSE but never CREATE,
  // so most create-vs-approve pairs cannot be tied to one entity from the
  // trail alone; that limit is named in `gaps` rather than guessed at.

  const ADMIN_SOD_ACTIONS = new Set(["CREATE", "UPDATE"]);

  if (deps.roles) {
    const roles = deps.roles;

    app.get("/sod", gate("audit.logs.view"), companyWide, async (c) => {
      const parsed = sodQuerySchema.safeParse(queryParams(c));
      if (!parsed.success) return respondValidation(c, flatten(parsed.error.issues));

      const fallback = defaultRange();
      const from = parsed.data.from ?? fallback.from;
      const to = parsed.data.to ?? fallback.to;
      if (from > to) {
        return respondValidation(c, [{ field: "from", message: "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية." }]);
      }
      const bounds = utcBounds(from, to);

      const allRoles = await roles.list();
      const roleConflicts = new Map<string, readonly SodConflictMatch[]>();
      for (const role of allRoles) {
        roleConflicts.set(role.id, detectSodConflicts(role.permissions));
      }

      const allUsers = (await deps.users?.list()) ?? [];
      const userLabel = new Map(allUsers.map((u: User) => [u.id, u.nameAr]));

      const rows: SodConflictRowDTO[] = [];

      for (const role of allRoles) {
        for (const conflict of roleConflicts.get(role.id) ?? []) {
          rows.push({
            rowKey: `role|${role.id}|${conflict.ruleId}`,
            kind: "role",
            ruleId: conflict.ruleId,
            conflictLabelAr: conflict.labelAr,
            conflictLabelEn: conflict.labelEn,
            subjectId: role.id,
            subjectLabelAr: role.name,
            roleId: role.id,
            roleCode: role.code,
            sideAPermissions: [...conflict.matchedA],
            sideBPermissions: [...conflict.matchedB],
            sideAActor: null,
            sideBActor: null,
            sideAAt: null,
            sideBAt: null,
            entityType: null,
          });
        }
      }

      // A company admin holds the wildcard exactly as surely as a role
      // listing `"*"` does (`saveUser`/`authorityOf` treat the flag that way
      // already), so it trips every rule below. Skipping `isCompanyAdmin`
      // users here — the earlier version of this loop did, via `if
      // (!user.roleId) continue` — made the single most powerful account in
      // the tenant invisible to the one report built to find exactly that.
      const wildcardConflicts = detectSodConflicts([WILDCARD_PERMISSION]);
      for (const user of allUsers) {
        const conflicts = user.isCompanyAdmin ? wildcardConflicts : user.roleId ? roleConflicts.get(user.roleId) : undefined;
        if (!conflicts || conflicts.length === 0) continue;
        const role = user.roleId ? allRoles.find((r) => r.id === user.roleId) : undefined;
        for (const conflict of conflicts) {
          rows.push({
            rowKey: `user|${user.id}|${conflict.ruleId}`,
            kind: "user",
            ruleId: conflict.ruleId,
            conflictLabelAr: conflict.labelAr,
            conflictLabelEn: conflict.labelEn,
            subjectId: user.id,
            subjectLabelAr: user.nameAr,
            roleId: user.roleId,
            roleCode: role?.code ?? null,
            sideAPermissions: [...conflict.matchedA],
            sideBPermissions: [...conflict.matchedB],
            sideAActor: null,
            sideBActor: null,
            sideAAt: null,
            sideBAt: null,
            entityType: null,
          });
        }
      }

      // Transactional: the same actor recorded on both sides of a pair in the
      // audit trail. Scoped to the two pairs where BOTH sides are actually
      // written — see the gap entries below for the rest.
      const [adminEvents, postingEvents, journalPostEvents, periodCloseEvents, periodReopenEvents] = await Promise.all([
        collectEvents(deps.audit, { stream: "sensitive", module: "admin", ...bounds }),
        collectEvents(deps.audit, { stream: "sensitive", ...bounds }),
        collectEvents(deps.audit, { stream: "sensitive", module: "accounting", entityType: "JOURNAL_ENTRY", action: "POST", ...bounds }),
        collectEvents(deps.audit, { stream: "sensitive", module: "accounting", entityType: "FISCAL_PERIOD", action: "CLOSE", ...bounds }),
        collectEvents(deps.audit, { stream: "sensitive", module: "accounting", entityType: "FISCAL_PERIOD", action: "REOPEN", ...bounds }),
      ]);

      function earliestByActor(events: readonly AuditEvent[], filter?: (e: AuditEvent) => boolean): Map<string, string> {
        const out = new Map<string, string>();
        for (const event of events) {
          if (filter && !filter(event)) continue;
          const existing = out.get(event.actor);
          if (!existing || event.timestamp < existing) out.set(event.actor, event.timestamp);
        }
        return out;
      }

      function subjectLabelOf(actor: string): string {
        return userLabel.get(actor) ?? actor;
      }

      const adminActors = earliestByActor(
        adminEvents.events,
        (e) => (e.entityType === "USER" || e.entityType === "ROLE") && ADMIN_SOD_ACTIONS.has(e.action),
      );
      const postingActors = earliestByActor(postingEvents.events, (e) => e.action === "CONFIRM" || e.action === "POST");
      const adminVsPostingRule = getSodConflictRule(SodConflictId.AdminVsPosting);
      for (const [actor, adminAt] of adminActors) {
        const postingAt = postingActors.get(actor);
        if (!postingAt) continue;
        rows.push({
          rowKey: `tx|${SodConflictId.AdminVsPosting}|${actor}`,
          kind: "transactional",
          ruleId: SodConflictId.AdminVsPosting,
          conflictLabelAr: adminVsPostingRule?.labelAr ?? SodConflictId.AdminVsPosting,
          conflictLabelEn: adminVsPostingRule?.labelEn ?? SodConflictId.AdminVsPosting,
          subjectId: actor,
          subjectLabelAr: subjectLabelOf(actor),
          roleId: null,
          roleCode: null,
          sideAPermissions: [],
          sideBPermissions: [],
          sideAActor: actor,
          sideBActor: actor,
          sideAAt: adminAt,
          sideBAt: postingAt,
          entityType: null,
        });
      }

      const journalActors = earliestByActor(journalPostEvents.events);
      const closeActors = earliestByActor(periodCloseEvents.events);
      const reopenActors = earliestByActor(periodReopenEvents.events);
      const journalCloseRule = getSodConflictRule(SodConflictId.JournalPostPeriodClose);
      const journalReopenRule = getSodConflictRule(SodConflictId.JournalPostPeriodReopen);
      for (const [actor, postedAt] of journalActors) {
        const closedAt = closeActors.get(actor);
        if (closedAt) {
          rows.push({
            rowKey: `tx|${SodConflictId.JournalPostPeriodClose}|${actor}`,
            kind: "transactional",
            ruleId: SodConflictId.JournalPostPeriodClose,
            conflictLabelAr: journalCloseRule?.labelAr ?? SodConflictId.JournalPostPeriodClose,
            conflictLabelEn: journalCloseRule?.labelEn ?? SodConflictId.JournalPostPeriodClose,
            subjectId: actor,
            subjectLabelAr: subjectLabelOf(actor),
            roleId: null,
            roleCode: null,
            sideAPermissions: [],
            sideBPermissions: [],
            sideAActor: actor,
            sideBActor: actor,
            sideAAt: postedAt,
            sideBAt: closedAt,
            entityType: "JOURNAL_ENTRY / FISCAL_PERIOD",
          });
        }
        const reopenedAt = reopenActors.get(actor);
        if (reopenedAt) {
          rows.push({
            rowKey: `tx|${SodConflictId.JournalPostPeriodReopen}|${actor}`,
            kind: "transactional",
            ruleId: SodConflictId.JournalPostPeriodReopen,
            conflictLabelAr: journalReopenRule?.labelAr ?? SodConflictId.JournalPostPeriodReopen,
            conflictLabelEn: journalReopenRule?.labelEn ?? SodConflictId.JournalPostPeriodReopen,
            subjectId: actor,
            subjectLabelAr: subjectLabelOf(actor),
            roleId: null,
            roleCode: null,
            sideAPermissions: [],
            sideBPermissions: [],
            sideAActor: actor,
            sideBActor: actor,
            sideAAt: postedAt,
            sideBAt: reopenedAt,
            entityType: "JOURNAL_ENTRY / FISCAL_PERIOD",
          });
        }
      }

      const byKind = new Map<string, SodConflictRowDTO[]>();
      for (const row of rows) {
        const bucket = byKind.get(row.kind);
        if (bucket) bucket.push(row);
        else byKind.set(row.kind, [row]);
      }
      const KIND_LABELS_AR: Record<string, string> = { role: "على مستوى الدور", user: "على مستوى المستخدم", transactional: "من سجل المراجعة" };
      const groups = ["role", "user", "transactional"]
        .filter((kind) => (byKind.get(kind)?.length ?? 0) > 0)
        .map((kind) => ({
          key: kind,
          labelAr: KIND_LABELS_AR[kind] ?? kind,
          rows: byKind.get(kind) ?? [],
          totals: { count: byKind.get(kind)?.length ?? 0 },
        }));

      const grandTotals = {
        count: rows.length,
        roleConflicts: byKind.get("role")?.length ?? 0,
        userConflicts: byKind.get("user")?.length ?? 0,
        transactionalConflicts: byKind.get("transactional")?.length ?? 0,
      };

      const kpis: ReportKpiDTO[] = [
        { key: "total", labelAr: "إجمالي حالات تعارض الفصل بين المهام", value: grandTotals.count, tone: grandTotals.count > 0 ? "warning" : "default" },
        { key: "roles", labelAr: "أدوار متعارضة", value: grandTotals.roleConflicts, tone: grandTotals.roleConflicts > 0 ? "warning" : "default" },
        { key: "users", labelAr: "مستخدمون بدور متعارض", value: grandTotals.userConflicts, tone: grandTotals.userConflicts > 0 ? "warning" : "default" },
        {
          key: "transactional",
          labelAr: "حالات مؤكَّدة من سجل المراجعة",
          value: grandTotals.transactionalConflicts,
          tone: grandTotals.transactionalConflicts > 0 ? "danger" : "default",
        },
      ];

      const columns: ReportColumnDTO[] = [
        { key: "conflictLabelAr", labelAr: "التعارض" },
        { key: "subjectLabelAr", labelAr: "الدور/المستخدم" },
        { key: "roleCode", labelAr: "رمز الدور" },
        { key: "sideAActor", labelAr: "الطرف الأول" },
        { key: "sideBActor", labelAr: "الطرف الثاني" },
      ];

      const coverage: ReportCoverageDTO = {
        matched:
          adminEvents.coverage.matched +
          postingEvents.coverage.matched +
          journalPostEvents.coverage.matched +
          periodCloseEvents.coverage.matched +
          periodReopenEvents.coverage.matched,
        scanned:
          adminEvents.coverage.scanned +
          postingEvents.coverage.scanned +
          journalPostEvents.coverage.scanned +
          periodCloseEvents.coverage.scanned +
          periodReopenEvents.coverage.scanned,
        truncated:
          adminEvents.coverage.truncated ||
          postingEvents.coverage.truncated ||
          journalPostEvents.coverage.truncated ||
          periodCloseEvents.coverage.truncated ||
          periodReopenEvents.coverage.truncated,
        scanLimit: SCAN_LIMIT,
      };

      const body: SodReportDTO = {
        id: "security.sod",
        titleAr: "تقرير تعارض الفصل بين المهام",
        params: { from, to },
        columns,
        rows,
        groups,
        grandTotals,
        kpis,
        coverage,
        gaps: [
          {
            key: "createNotAudited",
            labelAr: "من أنشأ المستند",
            detailAr:
              "محرك المستندات العام يسجّل الاعتماد والإلغاء والعكس فقط، ولا يسجّل حدث إنشاء. لذلك لا يمكن كشف «نفس الشخص أنشأ واعتمد نفس السند» من سجل المراجعة لسندات الخزينة والفواتير والتسويات المخزنية — الكشف هناك يقتصر على مستوى الدور/المستخدم أعلاه.",
          },
          {
            key: "bankRecMatch",
            labelAr: "مطابقة كشف البنك",
            detailAr: "عملية المطابقة نفسها غير مسجَّلة في سجل المراجعة، فلا يمكن ربطها بإقفال التسوية على مستوى مستند بعينه.",
          },
          {
            key: "payrollRun",
            labelAr: "احتساب واعتماد مسير الرواتب",
            detailAr: "خطوتا الاحتساب والاعتماد على مسير رواتب بعينه غير مسجَّلتين في سجل المراجعة اليوم.",
          },
        ],
      };
      return c.json(body);
    });
  }

  return app;
}
