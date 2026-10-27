import { randomUUID } from "node:crypto";
import {
  ALL_SCOPE,
  DEFAULT_TIME_ZONE,
  Money,
  NotificationChannelCode,
  NotificationChannelState,
  NotificationPriorityCode,
  NotificationReadStatusCode,
  OWNER_DIGEST_WEEK_DAYS,
  OwnerDigestTrigger,
  UserStatusCode,
  assertValidOwnerDigestSettings,
  can,
  cockpitAddDays,
  convertToBase,
  createAuthContext,
  createDefaultSettings,
  defaultOwnerDigestSettings,
  evaluateBackup,
  evaluateBelowFloor,
  evaluateCashVariances,
  evaluateFailedEta,
  evaluateLargeDiscounts,
  evaluateLowStock,
  evaluateOverdue,
  evaluateVoids,
  evaluateWaitingApprovals,
  isScheduledDay,
  latestCompleteDay,
  orderExceptions,
  ownerDigestPeriod,
  renderOwnerDigest,
  salesInvoiceTotals,
  tenantHourOf,
  toTenantDay,
  withinBranchScope,
  type ApprovalRequestRepository,
  type AuditQueryPort,
  type AuthContext,
  type DigestFact,
  type DiscountFact,
  type DrainResult,
  type EtaSubmissionRepository,
  type NotificationRepository,
  type PricingGuardOverrideRepository,
  type RoleRepository,
  type SalesInvoice,
  type SalesInvoiceRepository,
  type SettingsRepository,
  type User,
  type UserRepository,
  type VanTripRepository,
  type WaitingFact,
} from "@mezan/domain";
import {
  OWNER_DIGEST_EVENT,
  OwnerDigestCadence,
  OwnerDigestComparison,
  OwnerDigestCoverageState,
  OwnerDigestExceptionKind,
  OwnerDigestLanguage,
  OwnerDigestMetricKey,
  OwnerDigestSeverity,
  OwnerDigestSkipReason,
  type CockpitDTO,
  type OwnerDigestCoverageDTO,
  type OwnerDigestDTO,
  type OwnerDigestExceptionDTO,
  type OwnerDigestMetricDTO,
  type OwnerDigestPeriodDTO,
  type OwnerDigestSendResultDTO,
  type OwnerDigestSettingsInputDTO,
  type OwnerDigestSkippedDTO,
} from "@mezan/contracts";
import type { OwnerDigestStore } from "@mezan/persistence";
import { composeCockpit, type CockpitCaller, type CockpitRoutesDeps } from "./cockpit-routes.js";

export const OWNER_DIGEST_VIEW_PERMISSION = "accounting.owner_digest.view";
export const OWNER_DIGEST_MANAGE_PERMISSION = "accounting.owner_digest.manage";
export const OWNER_DIGEST_SEND_PERMISSION = "accounting.owner_digest.send";

export interface OwnerDigestBackupReading {
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
}

export interface OwnerDigestDeps {
  readonly cockpit: CockpitRoutesDeps;
  readonly settings: Pick<SettingsRepository, "get">;
  readonly store: OwnerDigestStore;
  readonly users: Pick<UserRepository, "list" | "findById">;
  readonly roles: Pick<RoleRepository, "findById">;
  readonly salesInvoices: Pick<SalesInvoiceRepository, "list" | "findById">;
  readonly audit: AuditQueryPort;
  readonly pricingOverrides: PricingGuardOverrideRepository;
  readonly vanTrips: Pick<VanTripRepository, "list">;
  readonly approvals: Pick<ApprovalRequestRepository, "listPendingForRoles">;
  readonly eta: Pick<EtaSubmissionRepository, "list">;
  readonly backup?: () => Promise<OwnerDigestBackupReading | null>;
  readonly notifications: NotificationRepository;
  readonly mailConfigured: () => Promise<boolean>;
  readonly drainOnly: (ids: ReadonlySet<string>) => Promise<DrainResult>;
  readonly scheduleSupported: boolean;
  readonly now?: () => string;
  readonly idGen?: () => string;
}

export interface OwnerDigestRecipient {
  readonly auth: AuthContext;
  readonly caller: CockpitCaller;
  readonly name: string | null;
}

export interface ComposeInput {
  readonly cadence: OwnerDigestCadence;
  readonly language: OwnerDigestLanguage;
  readonly endingOn: string;
  readonly branchId: string;
}

export interface ScheduledDigestResult {
  readonly ran: boolean;
  readonly period: OwnerDigestPeriodDTO | null;
  readonly queued: number;
  readonly skipped: readonly OwnerDigestSkippedDTO[];
}

const SALES_INVOICE_ENTITY = "SALES_INVOICE";
const VOID_ACTION = "VOID";
const VOID_AUDIT_PAGE = 200;
const VOID_AUDIT_PAGES = 5;
const AUDIT_WINDOW_PADDING_DAYS = 2;
const SOLD_STATUSES = ["confirmed", "partially_paid", "paid"] as const satisfies readonly SalesInvoice["status"][];
const SCHEDULED_SEND_HOUR = 6;
const STALE_CLAIM_MS = 60 * 60 * 1000;
const MS_PER_HOUR = 3_600_000;
const PERCENT_SCALE = 10_000n;

const ALL_KINDS: readonly OwnerDigestExceptionKind[] = Object.values(OwnerDigestExceptionKind);

const KIND_PERMISSION: Readonly<Partial<Record<OwnerDigestExceptionKind, string>>> = {
  [OwnerDigestExceptionKind.Void]: "sales.invoice.view",
  [OwnerDigestExceptionKind.LargeDiscount]: "sales.invoice.view",
  [OwnerDigestExceptionKind.BelowFloor]: "sales.pricing_guard.view",
  [OwnerDigestExceptionKind.CashVariance]: "field.van_trip.view",
  [OwnerDigestExceptionKind.ApprovalsWaiting]: "workflow.approve",
  [OwnerDigestExceptionKind.FailedEta]: "accounting.eta.view",
  [OwnerDigestExceptionKind.Backup]: "admin.backup.view",
};

function moneyOrNull(value: unknown): Money | null {
  if (typeof value !== "string") return null;
  try {
    return Money.fromMajor(value);
  } catch {
    return null;
  }
}

function sumDays(days: CockpitDTO["days"], pick: (day: CockpitDTO["days"][number]) => string | null): Money | null {
  const values = days.map(pick);
  if (values.some((value) => value === null)) return null;
  return Money.sum(values.map((value) => Money.fromMajor(value!)));
}

function metricOf(key: OwnerDigestMetricKey, current: Money, previous: Money | null): OwnerDigestMetricDTO {
  return {
    key,
    current: current.toString(),
    previous: previous ? previous.toString() : null,
    change: previous ? current.add(previous.negate()).toString() : null,
  };
}

function marginLabel(basisPoints: bigint): string {
  const negative = basisPoints < 0n;
  const abs = negative ? -basisPoints : basisPoints;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}%`;
}

function percentOf(part: Money, whole: Money): number {
  if (whole.scaled <= 0n) return 0;
  return Number((part.scaled * PERCENT_SCALE) / whole.scaled) / 100;
}

function hoursSince(iso: string, nowIso: string): number {
  return Math.max(0, (Date.parse(nowIso) - Date.parse(iso)) / MS_PER_HOUR);
}

export function createOwnerDigestService(deps: OwnerDigestDeps) {
  const nowIso = (): string => (deps.now ? deps.now() : new Date().toISOString());
  const newId = (): string => (deps.idGen ? deps.idGen() : randomUUID());

  async function tenant(): Promise<{ readonly companyName: string; readonly currency: string; readonly timezone: string }> {
    const settings = (await deps.settings.get()) ?? createDefaultSettings();
    return { companyName: settings.companyName, currency: settings.currency, timezone: settings.timezone || DEFAULT_TIME_ZONE };
  }

  async function loadSettings(): Promise<{ readonly settings: OwnerDigestSettingsInputDTO; readonly updatedAt: string | null; readonly updatedBy: string | null }> {
    const stored = await deps.store.getSettings();
    return stored
      ? { settings: stored.settings, updatedAt: stored.updatedAt, updatedBy: stored.updatedBy }
      : { settings: defaultOwnerDigestSettings(), updatedAt: null, updatedBy: null };
  }

  async function warehouseScopeFor(auth: AuthContext, branchScope: readonly string[] | undefined): Promise<readonly string[] | undefined> {
    const session = auth.warehouseScope === ALL_SCOPE ? undefined : auth.warehouseScope;
    if (!branchScope) return session;
    const granted = (await deps.cockpit.warehouses.findAll()).filter((warehouse) => branchScope.includes(warehouse.branchId)).map((warehouse) => warehouse.id);
    return session ? session.filter((id) => granted.includes(id)) : granted;
  }

  async function recipientFromAuth(auth: AuthContext, name: string | null): Promise<OwnerDigestRecipient> {
    const branchScope = auth.branchScope === ALL_SCOPE ? undefined : auth.branchScope;
    return { auth, name, caller: { auth, branchScope, warehouseScope: await warehouseScopeFor(auth, branchScope) } };
  }

  async function recipientOfUser(user: User): Promise<OwnerDigestRecipient> {
    let permissions: readonly string[] = [];
    let roleCodes: readonly string[] = [];
    if (user.isCompanyAdmin) {
      permissions = ["*"];
    } else if (user.roleId) {
      const role = await deps.roles.findById(user.roleId);
      permissions = role?.permissions ?? [];
      roleCodes = role ? [role.code] : [];
    }
    const auth = createAuthContext({
      userId: user.id,
      permissions,
      roleCodes,
      branchScope: user.branchScope,
      warehouseScope: user.warehouseScope,
    });
    return recipientFromAuth(auth, user.nameEn && user.nameEn.trim() !== "" ? user.nameEn : user.nameAr);
  }

  function inBranch(recipient: OwnerDigestRecipient, branchId: string | null | undefined, selected: string): boolean {
    if (selected !== "" && branchId !== selected) return false;
    return withinBranchScope(branchId ?? null, recipient.caller.branchScope);
  }

  async function voidFacts(recipient: OwnerDigestRecipient, period: OwnerDigestPeriodDTO, branchId: string, timezone: string): Promise<DigestFact[]> {
    const from = `${cockpitAddDays(period.from, -AUDIT_WINDOW_PADDING_DAYS)}T00:00:00.000Z`;
    const to = `${cockpitAddDays(period.to, AUDIT_WINDOW_PADDING_DAYS)}T23:59:59.999Z`;
    const facts: DigestFact[] = [];
    for (let page = 0; page < VOID_AUDIT_PAGES; page += 1) {
      const result = await deps.audit.queryEvents({ module: "sales", action: VOID_ACTION, entityType: SALES_INVOICE_ENTITY, from, to, limit: VOID_AUDIT_PAGE, offset: page * VOID_AUDIT_PAGE });
      for (const event of result.events) {
        const day = toTenantDay(event.timestamp, timezone);
        if (day < period.from || day > period.to || !event.entityId) continue;
        const invoice = await deps.salesInvoices.findById(event.entityId);
        if (!invoice || !inBranch(recipient, invoice.branchId, branchId)) continue;
        const details = event.details ?? {};
        facts.push({
          reference: invoice.docNo ?? invoice.id,
          party: invoice.customerNameAr,
          amount: moneyOrNull(details["grandTotal"]),
          detail: typeof details["reason"] === "string" ? details["reason"] : null,
          on: day,
        });
      }
      if ((page + 1) * VOID_AUDIT_PAGE >= result.total) break;
    }
    return facts;
  }

  async function discountFacts(recipient: OwnerDigestRecipient, period: OwnerDigestPeriodDTO, branchId: string): Promise<DiscountFact[]> {
    const invoices = await deps.salesInvoices.list({
      statusIn: [...SOLD_STATUSES],
      fromDate: period.from,
      toDate: period.to,
      branchScope: recipient.caller.branchScope,
      warehouseScope: recipient.caller.warehouseScope,
    });
    const facts: DiscountFact[] = [];
    for (const invoice of invoices) {
      if (branchId !== "" && invoice.branchId !== branchId) continue;
      const totals = salesInvoiceTotals(invoice);
      const discount = Money.sum([totals.lineDiscountTotal, totals.promotionDiscountTotal, totals.invoiceDiscountTotal]);
      if (discount.scaled <= 0n) continue;
      const effective = percentOf(discount, totals.grossTotal);
      const lineMax = Math.max(0, ...invoice.lines.map((line) => (line.discountType === "percent" ? line.discountPercent : 0)));
      facts.push({
        reference: invoice.docNo ?? invoice.id,
        party: invoice.customerNameAr,
        amount: invoice.fxRate ? convertToBase(discount, invoice.fxRate) : discount,
        detail: `${Math.max(effective, lineMax)}%`,
        on: invoice.date,
        percent: Math.max(effective, lineMax),
      });
    }
    return facts;
  }

  async function belowFloorFacts(recipient: OwnerDigestRecipient, period: OwnerDigestPeriodDTO, branchId: string): Promise<DigestFact[]> {
    const rows = await deps.pricingOverrides.list({ fromDate: period.from, toDate: period.to, branchScope: recipient.caller.branchScope ?? null });
    const withCost = can(recipient.auth, "sales.invoice.view_cost");
    return rows
      .filter((row) => branchId === "" || row.branchId === branchId)
      .map((row) => ({
        reference: row.docNo,
        party: row.customerNameAr,
        amount: row.netBase,
        detail: withCost && row.marginBasisPoints !== null ? marginLabel(row.marginBasisPoints) : null,
        on: row.docDate,
      }));
  }

  async function cashVarianceFacts(recipient: OwnerDigestRecipient, period: OwnerDigestPeriodDTO, branchId: string, timezone: string): Promise<DigestFact[]> {
    const trips = await deps.vanTrips.list();
    const facts: DigestFact[] = [];
    for (const trip of trips) {
      if (!trip.settlement || !inBranch(recipient, trip.branchId, branchId)) continue;
      const day = toTenantDay(trip.settlement.settledAt, timezone);
      if (day < period.from || day > period.to) continue;
      facts.push({ reference: trip.tripNo, party: null, amount: trip.settlement.cashVariance, detail: null, on: day });
    }
    return facts;
  }

  async function waitingFacts(recipient: OwnerDigestRecipient, branchId: string, now: string): Promise<WaitingFact[]> {
    const roles = recipient.auth.permissions.has("*") ? ["*"] : [...recipient.auth.roleCodes];
    const pending = await deps.approvals.listPendingForRoles(roles);
    return pending
      .filter((request) => inBranch(recipient, request.subject?.branchId ?? null, branchId))
      .map((request) => ({
        reference: request.entityLabel,
        party: null,
        amount: null,
        detail: request.actionType,
        on: request.createdAt.slice(0, 10),
        waitingHours: hoursSince(request.createdAt, now),
      }));
  }

  async function failedEtaFacts(timezone: string): Promise<DigestFact[]> {
    const rows = await deps.eta.list("error");
    return rows.map((row) => ({
      reference: row.internalId,
      party: null,
      amount: null,
      detail: row.errors[0] ?? null,
      on: toTenantDay(row.updatedAt, timezone),
    }));
  }

  function metricsFor(cadence: OwnerDigestCadence, current: CockpitDTO, previous: CockpitDTO | null): OwnerDigestMetricDTO[] {
    const metrics: OwnerDigestMetricDTO[] = [];
    if (cadence === OwnerDigestCadence.Daily) {
      metrics.push(metricOf(OwnerDigestMetricKey.Sales, Money.fromMajor(current.pulse.sales.today), Money.fromMajor(current.pulse.sales.sameWeekdayLastWeek)));
      metrics.push(metricOf(OwnerDigestMetricKey.Collections, Money.fromMajor(current.pulse.collections.today), Money.fromMajor(current.pulse.collections.sameWeekdayLastWeek)));
      if (current.pulse.grossProfit) {
        metrics.push(metricOf(OwnerDigestMetricKey.GrossProfit, Money.fromMajor(current.pulse.grossProfit.today), Money.fromMajor(current.pulse.grossProfit.sameWeekdayLastWeek)));
      }
    } else {
      const sales = sumDays(current.days, (day) => day.sales);
      const collections = sumDays(current.days, (day) => day.collections);
      const profit = sumDays(current.days, (day) => day.grossProfit);
      if (sales) metrics.push(metricOf(OwnerDigestMetricKey.Sales, sales, previous ? sumDays(previous.days, (day) => day.sales) : null));
      if (collections) metrics.push(metricOf(OwnerDigestMetricKey.Collections, collections, previous ? sumDays(previous.days, (day) => day.collections) : null));
      if (profit) metrics.push(metricOf(OwnerDigestMetricKey.GrossProfit, profit, previous ? sumDays(previous.days, (day) => day.grossProfit) : null));
    }
    if (current.cash) {
      metrics.push(metricOf(OwnerDigestMetricKey.Cash, Money.fromMajor(current.cash.total), previous?.cash ? Money.fromMajor(previous.cash.total) : null));
    }
    return metrics;
  }

  async function compose(recipient: OwnerDigestRecipient, input: ComposeInput): Promise<OwnerDigestDTO> {
    const now = nowIso();
    const { companyName, currency, timezone } = await tenant();
    const { settings } = await loadSettings();
    const thresholds = settings.thresholds;
    const period = ownerDigestPeriod(input.cadence, input.endingOn);
    const cockpit = await composeCockpit(deps.cockpit, recipient.caller, input.branchId, period.to, now);
    const previous =
      input.cadence === OwnerDigestCadence.Weekly
        ? await composeCockpit(deps.cockpit, recipient.caller, input.branchId, cockpitAddDays(period.to, -OWNER_DIGEST_WEEK_DAYS), now)
        : null;

    const found: OwnerDigestExceptionDTO[] = [];
    const coverage: OwnerDigestCoverageDTO[] = [];
    const push = (kind: OwnerDigestExceptionKind, state: OwnerDigestCoverageState, exception: OwnerDigestExceptionDTO | null = null): void => {
      coverage.push({ kind, state });
      if (exception) found.push(exception);
    };
    const permitted = (kind: OwnerDigestExceptionKind): boolean => {
      const permission = KIND_PERMISSION[kind];
      return permission === undefined || can(recipient.auth, permission);
    };
    const blocked = OwnerDigestCoverageState.NotPermitted;
    const done = OwnerDigestCoverageState.Evaluated;

    const kindFacts = async <T>(kind: OwnerDigestExceptionKind, gather: () => Promise<T>, judge: (facts: T) => OwnerDigestExceptionDTO | null): Promise<void> => {
      if (!permitted(kind)) return push(kind, blocked);
      push(kind, done, judge(await gather()));
    };

    await kindFacts(OwnerDigestExceptionKind.Void, () => voidFacts(recipient, period, input.branchId, timezone), (facts) => evaluateVoids(facts, thresholds));
    await kindFacts(OwnerDigestExceptionKind.LargeDiscount, () => discountFacts(recipient, period, input.branchId), (facts) => evaluateLargeDiscounts(facts, thresholds));
    await kindFacts(OwnerDigestExceptionKind.BelowFloor, () => belowFloorFacts(recipient, period, input.branchId), (facts) => evaluateBelowFloor(facts, thresholds));
    await kindFacts(OwnerDigestExceptionKind.CashVariance, () => cashVarianceFacts(recipient, period, input.branchId, timezone), (facts) => evaluateCashVariances(facts, thresholds));
    await kindFacts(OwnerDigestExceptionKind.ApprovalsWaiting, () => waitingFacts(recipient, input.branchId, now), (facts) => evaluateWaitingApprovals(facts, thresholds));

    if (!permitted(OwnerDigestExceptionKind.FailedEta) || recipient.caller.branchScope !== undefined) {
      push(OwnerDigestExceptionKind.FailedEta, blocked);
    } else {
      push(OwnerDigestExceptionKind.FailedEta, done, evaluateFailedEta(await failedEtaFacts(timezone), thresholds));
    }

    if (cockpit.overdueReceivables) {
      const overdue = cockpit.overdueReceivables;
      push(
        OwnerDigestExceptionKind.OverdueCollections,
        done,
        evaluateOverdue({ amount: Money.fromMajor(overdue.amount), invoiceCount: overdue.invoiceCount, customerCount: overdue.customerCount, oldestDueDate: overdue.oldestDueDate }, period.to, thresholds),
      );
    } else {
      push(OwnerDigestExceptionKind.OverdueCollections, blocked);
    }

    if (cockpit.lowStock) {
      const stock = cockpit.lowStock;
      push(OwnerDigestExceptionKind.LowStock, done, evaluateLowStock({ low: stock.low, out: stock.out, firstItemName: stock.firstItemNameAr }, thresholds));
    } else {
      push(OwnerDigestExceptionKind.LowStock, blocked);
    }

    const reading = deps.backup && permitted(OwnerDigestExceptionKind.Backup) ? await deps.backup() : null;
    if (!permitted(OwnerDigestExceptionKind.Backup)) push(OwnerDigestExceptionKind.Backup, blocked);
    else if (!reading) push(OwnerDigestExceptionKind.Backup, OwnerDigestCoverageState.NotReported);
    else push(OwnerDigestExceptionKind.Backup, done, evaluateBackup(reading, now, thresholds));

    return {
      period,
      generatedAt: now,
      language: input.language,
      companyName,
      currency,
      recipientName: recipient.name,
      comparison: input.cadence === OwnerDigestCadence.Weekly ? OwnerDigestComparison.PreviousWeek : OwnerDigestComparison.SameWeekdayLastWeek,
      metrics: metricsFor(input.cadence, cockpit, previous),
      cockpit,
      exceptions: orderExceptions(found),
      coverage: ALL_KINDS.map((kind) => coverage.find((entry) => entry.kind === kind) ?? { kind, state: blocked }),
      thresholds,
    };
  }

  async function skipReasonOf(user: User | null, recipient: OwnerDigestRecipient | null): Promise<OwnerDigestSkipReason | null> {
    if (!user || !recipient) return OwnerDigestSkipReason.UnknownUser;
    if (user.status !== UserStatusCode.Active) return OwnerDigestSkipReason.Inactive;
    if (!can(recipient.auth, OWNER_DIGEST_VIEW_PERMISSION)) return OwnerDigestSkipReason.NotPermitted;
    if (!user.email || user.email.trim() === "") return OwnerDigestSkipReason.NoEmail;
    return null;
  }

  interface Queued {
    readonly notificationId: string;
  }

  async function queueFor(
    userId: string,
    settings: OwnerDigestSettingsInputDTO,
    cadence: OwnerDigestCadence,
    language: OwnerDigestLanguage,
    endingOn: string,
    trigger: OwnerDigestTrigger,
    mail: boolean,
  ): Promise<{ readonly queued: Queued | null; readonly skipped: OwnerDigestSkippedDTO | null; readonly already: boolean }> {
    const user = await deps.users.findById(userId);
    const recipient = user ? await recipientOfUser(user) : null;
    const reason = await skipReasonOf(user, recipient);
    if (reason || !user || !recipient) {
      return { queued: null, skipped: { userId, name: user?.nameAr ?? null, reason: reason ?? OwnerDigestSkipReason.UnknownUser }, already: false };
    }
    const period = ownerDigestPeriod(cadence, endingOn);
    const runId = newId();
    const notificationId = newId();
    const createdAt = nowIso();
    const claimed = await deps.store.claim({
      id: runId,
      cadence,
      periodKey: period.key,
      periodFrom: period.from,
      periodTo: period.to,
      recipientUserId: user.id,
      trigger,
      notificationId,
      createdAt,
      staleBefore: new Date(Date.parse(createdAt) - STALE_CLAIM_MS).toISOString(),
    });
    if (!claimed) return { queued: null, skipped: null, already: true };
    try {
      const digest = await compose(recipient, { cadence, language, endingOn, branchId: "" });
      const rendered = renderOwnerDigest(digest);
      const critical = digest.exceptions.some((exception) => exception.severity === OwnerDigestSeverity.Critical);
      const channels = mail ? [NotificationChannelCode.InApp, NotificationChannelCode.Email] : [NotificationChannelCode.InApp];
      await deps.notifications.save({
        id: notificationId,
        ruleId: null,
        recipientUserId: user.id,
        eventCode: OWNER_DIGEST_EVENT,
        title: rendered.subject,
        body: rendered.text,
        priority: critical ? NotificationPriorityCode.High : NotificationPriorityCode.Normal,
        channels,
        channelStatus: mail
          ? { [NotificationChannelCode.InApp]: NotificationChannelState.Delivered, [NotificationChannelCode.Email]: NotificationChannelState.Queued }
          : { [NotificationChannelCode.InApp]: NotificationChannelState.Delivered },
        status: NotificationReadStatusCode.Unread,
        payload: { periodKey: period.key, cadence, exceptions: digest.exceptions.length },
        createdAt,
        readAt: null,
      });
      await deps.store.complete(runId, rendered.html);
    } catch (error) {
      await deps.store.release(runId);
      throw error;
    }
    return { queued: { notificationId }, skipped: null, already: false };
  }

  async function queueAll(
    settings: OwnerDigestSettingsInputDTO,
    cadence: OwnerDigestCadence,
    language: OwnerDigestLanguage,
    endingOn: string,
    trigger: OwnerDigestTrigger,
  ): Promise<{ readonly queued: string[]; readonly alreadySent: number; readonly skipped: OwnerDigestSkippedDTO[]; readonly mail: boolean }> {
    const mail = await deps.mailConfigured();
    const queued: string[] = [];
    const skipped: OwnerDigestSkippedDTO[] = [];
    let alreadySent = 0;
    for (const userId of settings.recipientUserIds) {
      const result = await queueFor(userId, settings, cadence, language, endingOn, trigger, mail);
      if (result.queued) queued.push(result.queued.notificationId);
      if (result.skipped) skipped.push(result.skipped);
      if (result.already) alreadySent += 1;
    }
    return { queued, alreadySent, skipped, mail };
  }

  async function sendNow(input: {
    readonly cadence?: OwnerDigestCadence;
    readonly language?: OwnerDigestLanguage;
    readonly endingOn?: string;
  }): Promise<{ readonly result: OwnerDigestSendResultDTO; readonly queuedIds: ReadonlySet<string> }> {
    const { settings } = await loadSettings();
    const { timezone } = await tenant();
    const cadence = input.cadence ?? settings.cadence;
    const endingOn = input.endingOn ?? latestCompleteDay(toTenantDay(nowIso(), timezone));
    const queued = await queueAll(settings, cadence, input.language ?? settings.language, endingOn, OwnerDigestTrigger.Manual);
    return {
      result: { period: ownerDigestPeriod(cadence, endingOn), queued: queued.queued.length, alreadySent: queued.alreadySent, skipped: queued.skipped, mailConfigured: queued.mail },
      queuedIds: new Set(queued.mail ? queued.queued : []),
    };
  }

  async function runScheduled(): Promise<ScheduledDigestResult> {
    const { settings } = await loadSettings();
    const none: ScheduledDigestResult = { ran: false, period: null, queued: 0, skipped: [] };
    if (!deps.scheduleSupported || !settings.scheduleEnabled || settings.recipientUserIds.length === 0) return none;
    const { timezone } = await tenant();
    const now = nowIso();
    const today = toTenantDay(now, timezone);
    if (tenantHourOf(now, timezone) < SCHEDULED_SEND_HOUR || !isScheduledDay(settings.cadence, settings.sendWeekday, today)) return none;
    const endingOn = latestCompleteDay(today);
    const result = await queueAll(settings, settings.cadence, settings.language, endingOn, OwnerDigestTrigger.Scheduled);
    if (result.mail && result.queued.length > 0) await deps.drainOnly(new Set(result.queued));
    return { ran: true, period: ownerDigestPeriod(settings.cadence, endingOn), queued: result.queued.length, skipped: result.skipped };
  }

  async function resolveEndingOn(requested: string | undefined): Promise<string> {
    if (requested) return requested;
    const { timezone } = await tenant();
    return latestCompleteDay(toTenantDay(nowIso(), timezone));
  }

  return {
    nowIso,
    tenant,
    loadSettings,
    recipientFromAuth,
    recipientOfUser,
    compose,
    sendNow,
    runScheduled,
    resolveEndingOn,
    assertValidSettings: assertValidOwnerDigestSettings,
  };
}

export type OwnerDigestService = ReturnType<typeof createOwnerDigestService>;
