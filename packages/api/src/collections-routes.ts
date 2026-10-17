import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  AuditChangeAction,
  CashForecastSourceKind,
  CollectionActivityKind,
  CustomerContactMissingError,
  CustomerMessageStatus,
  DUNNING_PLACEHOLDERS,
  DunningChannel,
  DunningHoldNotFoundError,
  DunningReminderNotFoundError,
  DunningReminderNotSendableError,
  DunningReminderStatus,
  InvalidDunningPolicyError,
  InvalidPromiseToPayError,
  Money,
  PromiseToPayNotFoundError,
  PromiseToPayStatus,
  SmsProviderNotConfiguredError,
  assertValidDunningPolicy,
  buildCollectionWorklist,
  consolidateReminders,
  createPromiseToPay,
  currencyLabelAr,
  defaultDunningPolicy,
  dueStepFor,
  evaluatePromise,
  formatMoneyLabel,
  openReceivableItems,
  planDunningRun,
  receivableForecastItems,
  renderDunningMessage,
  renderOpenItemStatement,
  whatsAppLink,
  withinBranchScope,
  type AllocationRepository,
  type AuditSink,
  type CashForecastItem,
  type CollectionActivityRepository,
  type CollectionCustomerRow,
  type CollectionHold,
  type CollectionHoldRepository,
  type CollectionWorkItem,
  type Customer,
  type CustomerMessageOutbox,
  type CustomerRepository,
  type DrainResult,
  type DunningPolicy,
  type DunningPolicyRepository,
  type DunningReminder,
  type DunningReminderRepository,
  type EvaluatedPromise,
  type PromiseToPay,
  type PromiseToPayRepository,
} from "@mezan/domain";
import {
  DunningChannelDTO,
  collectionHoldSchema,
  collectionNoteSchema,
  createPromiseToPaySchema,
  dismissReminderSchema,
  dunningRunSchema,
  sendStatementSchema,
  updateDunningPolicySchema,
  StatementChannelDTO,
  type CollectionActivityDTO,
  type CollectionCustomerRowDTO,
  type CollectionHoldDTO,
  type CollectionsWorklistDTO,
  type CustomerCollectionsDTO,
  type DunningPolicyDTO,
  type DunningReminderDTO,
  type DunningRunResultDTO,
  type EvaluatedPromiseDTO,
  type SendReminderResultDTO,
  type ScheduledDunningRunResultDTO,
  type SendStatementResultDTO,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { branchScopeOf } from "./permission-gate.js";
import { canSeeUnattributed } from "./branch-view.js";
import { recordAdminEvent } from "./admin-audit.js";
import { openPartyAgingInputs, type ReportsRoutesDeps } from "./reports-routes.js";
import { tenantToday } from "./tenant-day.js";

export interface CollectionsStore {
  readonly policy: DunningPolicyRepository;
  readonly reminders: DunningReminderRepository;
  readonly promises: PromiseToPayRepository;
  readonly activities: CollectionActivityRepository;
  readonly holds: CollectionHoldRepository;
  readonly outbox: CustomerMessageOutbox;
}

export interface CollectionsRoutesDeps {
  readonly reports: ReportsRoutesDeps;
  readonly customers: Pick<CustomerRepository, "findAll" | "findById">;
  readonly allocations: Pick<AllocationRepository, "listByInvoice">;
  readonly store: CollectionsStore;
  readonly company: () => Promise<{ readonly companyName: string; readonly currency: string }>;
  readonly drain?: () => Promise<DrainResult>;
  readonly mailConfigured?: () => Promise<boolean>;
  readonly audit?: AuditSink;
  readonly today?: () => string;
  readonly now?: () => string;
  readonly idGen?: () => string;
}

enum CollectionsAuditAction {
  PolicyUpdate = "collections.policy.update",
  DunningRun = "collections.dunning_run",
  ReminderQueued = "collections.reminder.queued",
  ReminderSent = "collections.reminder.sent",
  ReminderDismissed = "collections.reminder.dismissed",
  PromiseCreated = "collections.promise.created",
  PromiseCancelled = "collections.promise.cancelled",
  NoteAdded = "collections.note.added",
  HoldSet = "collections.hold.set",
  HoldLifted = "collections.hold.lifted",
  StatementSent = "collections.statement.sent",
}

enum ReminderOutcome {
  WhatsAppLink = "whatsapp_link",
  CallLogged = "call_logged",
}

enum CollectionsRefusal {
  CompanyWideOnly = "COLLECTIONS_COMPANY_WIDE_ONLY",
  CustomerNotFound = "CUSTOMER_NOT_FOUND",
  OutOfScope = "COLLECTIONS_CUSTOMER_OUT_OF_SCOPE",
  AutoSendDisabled = "COLLECTIONS_AUTO_SEND_DISABLED",
  ItemSettled = "DUNNING_ITEM_SETTLED",
  PromiseInvoicesInvalid = "PROMISE_INVOICES_NOT_OVERDUE",
  MailNotConfigured = "NOTIFICATION_MAIL_NOT_CONFIGURED",
  TransportUnavailable = "NOTIFICATION_TRANSPORT_UNAVAILABLE",
  InvalidRequest = "INVALID_REQUEST",
}

const SETTLED_ITEM_AR = "هذا البند سُدِّد أو لم يعد متأخراً؛ شغّل المتابعة من جديد لتحديث التذكيرات.";
const SETTLED_ITEM_EN = "This item has been settled or is no longer overdue; run the follow-up again to refresh the reminders.";
const PRIOR_BALANCE_AR = "رصيد سابق";
const REMINDER_LIST_LIMIT = 500;

function body(error: string, message: string, messageEn: string, extra: Record<string, unknown> = {}) {
  return { error, message, messageEn, ...extra };
}

function holdActive(hold: CollectionHold, today: string): boolean {
  return hold.until === null || hold.until >= today;
}

function holdDTO(hold: CollectionHold): CollectionHoldDTO {
  return { customerId: hold.customerId, reason: hold.reason, until: hold.until, createdAt: hold.createdAt, createdBy: hold.createdBy };
}

function promiseDTO(promise: EvaluatedPromise, names: ReadonlyMap<string, string>): EvaluatedPromiseDTO {
  return {
    id: promise.id,
    customerId: promise.customerId,
    customerName: names.get(promise.customerId) ?? promise.customerId,
    promisedDate: promise.promisedDate,
    amount: promise.amount.toString(),
    collected: promise.collected.toString(),
    invoiceIds: promise.invoiceIds,
    note: promise.note,
    status: promise.status as unknown as EvaluatedPromiseDTO["status"],
    createdAt: promise.createdAt,
    createdBy: promise.createdBy,
  };
}

function documentLabel(item: CollectionWorkItem): string {
  if (item.kind === CashForecastSourceKind.Installment && item.reference && item.detail) return `${item.reference} (${item.detail})`;
  return item.reference ?? item.detail ?? PRIOR_BALANCE_AR;
}

export function createCollectionsRoutes(deps: CollectionsRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const today = (c: Context) => tenantToday(c, deps.today);
  const now = () => (deps.now ? deps.now() : new Date().toISOString());
  const newId = () => (deps.idGen ? deps.idGen() : randomUUID());
  const actorOf = (c: Context) => getAuthContext(c)?.userId ?? "system";

  async function receivableItems(c: Context, day: string, scoped: boolean): Promise<CashForecastItem[]> {
    const [aging, plans] = await Promise.all([openPartyAgingInputs(deps.reports, day), deps.reports.installmentPlans.list()]);
    const all = receivableForecastItems({ asOfDate: day, aging: aging.customers, installmentPlans: plans });
    if (!scoped) return all;
    const scope = branchScopeOf(c);
    const includeUnattributed = canSeeUnattributed(c);
    return all.filter((item) => withinBranchScope(item.branchId, scope, includeUnattributed));
  }

  async function customerDirectory(): Promise<ReadonlyMap<string, Customer>> {
    return new Map((await deps.customers.findAll()).map((customer) => [customer.id, customer]));
  }

  async function evaluatedPromises(day: string, customerId?: string): Promise<EvaluatedPromise[]> {
    const promises = await deps.store.promises.list(customerId === undefined ? {} : { customerId });
    const byInvoice = new Map<string, Awaited<ReturnType<AllocationRepository["listByInvoice"]>>>();
    for (const promise of promises) {
      for (const invoiceId of promise.invoiceIds) {
        if (!byInvoice.has(invoiceId)) byInvoice.set(invoiceId, await deps.allocations.listByInvoice(invoiceId));
      }
    }
    return promises.map((promise) => evaluatePromise(promise, byInvoice, day));
  }

  function nameMap(customers: ReadonlyMap<string, Customer>): ReadonlyMap<string, string> {
    return new Map([...customers].map(([id, customer]) => [id, customer.nameAr]));
  }

  async function effectiveStatuses(reminders: readonly DunningReminder[]): Promise<DunningReminder[]> {
    const ids = reminders.flatMap((r) => (r.status === DunningReminderStatus.Queued && r.messageId ? [r.messageId] : []));
    const messages = await deps.store.outbox.findByIds(ids);
    return reminders.map((reminder) => {
      const message = reminder.messageId ? messages.get(reminder.messageId) : undefined;
      if (reminder.status !== DunningReminderStatus.Queued || !message) return reminder;
      if (message.status === CustomerMessageStatus.Sent) return { ...reminder, status: DunningReminderStatus.Sent, sentAt: message.sentAt };
      if (message.status === CustomerMessageStatus.Failed) return { ...reminder, status: DunningReminderStatus.Failed, failureReason: message.failureReason };
      return reminder;
    });
  }

  async function settleQueuedReminders(): Promise<void> {
    const queued = await deps.store.reminders.list({ statuses: [DunningReminderStatus.Queued], limit: REMINDER_LIST_LIMIT });
    for (const [index, effective] of (await effectiveStatuses(queued)).entries()) {
      if (effective.status !== queued[index]!.status) await deps.store.reminders.update(effective);
    }
  }

  function reminderDTO(reminder: DunningReminder, customers: ReadonlyMap<string, Customer>): DunningReminderDTO {
    const customer = customers.get(reminder.customerId);
    const live = reminder.status === DunningReminderStatus.Prepared || reminder.status === DunningReminderStatus.Sent;
    return {
      id: reminder.id,
      itemKey: reminder.itemKey,
      stepLevel: reminder.stepLevel,
      customerId: reminder.customerId,
      customerName: customer?.nameAr ?? reminder.customerId,
      documentId: reminder.documentId,
      reference: reminder.reference,
      channel: reminder.channel as unknown as DunningChannelDTO,
      subject: reminder.subject,
      body: reminder.body,
      amount: reminder.amount.toString(),
      daysOverdue: reminder.daysOverdue,
      dueDate: reminder.dueDate,
      status: reminder.status as unknown as DunningReminderDTO["status"],
      failureReason: reminder.failureReason,
      preparedOn: reminder.preparedOn,
      sentAt: reminder.sentAt,
      sentBy: reminder.sentBy,
      outcome: reminder.outcome,
      whatsappLink: reminder.channel === DunningChannel.WhatsApp && live ? whatsAppLink(customer?.phone, reminder.body) : null,
    };
  }

  async function currentPolicy(): Promise<{ policy: DunningPolicy; isDefault: boolean }> {
    const stored = await deps.store.policy.get();
    return stored ? { policy: stored, isDefault: false } : { policy: defaultDunningPolicy(), isDefault: true };
  }

  function policyDTO(policy: DunningPolicy, isDefault: boolean): DunningPolicyDTO {
    return {
      steps: policy.steps.map(({ id, ...step }) => ({ ...step, stepKey: id, channel: step.channel as unknown as DunningChannelDTO })),
      autoSendEnabled: policy.autoSendEnabled,
      minimumOverdueAmount: policy.minimumOverdueAmount.toString(),
      pauseWhilePromisePending: policy.pauseWhilePromisePending,
      lastScheduledRunDate: policy.lastScheduledRunDate,
      updatedAt: policy.updatedAt,
      updatedBy: policy.updatedBy,
      smsAvailable: false,
      placeholders: DUNNING_PLACEHOLDERS,
      isDefault,
    };
  }

  function rowDTO(
    row: CollectionCustomerRow,
    policy: DunningPolicy,
    reminders: readonly DunningReminder[],
    customers: ReadonlyMap<string, Customer>,
    holds: ReadonlyMap<string, CollectionHold>,
    pending: ReadonlyMap<string, EvaluatedPromise>,
    names: ReadonlyMap<string, string>,
    day: string,
  ): CollectionCustomerRowDTO {
    const customer = customers.get(row.customerId);
    const hold = holds.get(row.customerId);
    const promise = pending.get(row.customerId);
    return {
      customerId: row.customerId,
      customerName: row.customerName,
      customerNameEn: row.customerNameEn,
      phone: customer?.phone ?? null,
      email: customer?.email ?? null,
      overdue: row.overdue.toString(),
      notYetDue: row.notYetDue.toString(),
      oldestDaysOverdue: row.oldestDaysOverdue,
      onHold: hold && holdActive(hold, day) ? holdDTO(hold) : null,
      pendingPromise: promise ? promiseDTO(promise, names) : null,
      items: row.items.map((item) => {
        const itemReminders = reminders.filter((r) => r.itemKey === item.key);
        const due = dueStepFor(policy, item, itemReminders);
        const last = [...itemReminders].sort((a, b) => b.stepLevel - a.stepLevel)[0];
        return {
          key: item.key,
          kind: item.kind as unknown as CollectionCustomerRowDTO["items"][number]["kind"],
          documentId: item.documentId,
          reference: item.reference,
          detail: item.detail,
          dueDate: item.dueDate,
          daysOverdue: item.daysOverdue,
          amount: item.amount.toString(),
          nextStepLevel: due?.level ?? null,
          lastReminderStatus: (last?.status ?? null) as unknown as CollectionCustomerRowDTO["items"][number]["lastReminderStatus"],
        };
      }),
    };
  }

  async function customerOrRefusal(c: Context, customerId: string): Promise<Customer | Response> {
    const customer = await deps.customers.findById(customerId);
    if (!customer) return c.json(body(CollectionsRefusal.CustomerNotFound, "العميل غير موجود.", "The customer was not found."), 404);
    const scope = branchScopeOf(c);
    if (scope !== undefined && !withinBranchScope(customer.branchId, scope, canSeeUnattributed(c))) {
      return c.json(body(CollectionsRefusal.OutOfScope, "هذا العميل خارج نطاق فروعك.", "This customer is outside your branch scope."), 403);
    }
    return customer;
  }

  function domainRefusal(c: Context, err: unknown): Response {
    if (err instanceof InvalidDunningPolicyError) {
      return c.json(body(err.code, err.message, err.messageEn, { reasons: err.reasons }), 422);
    }
    if (err instanceof InvalidPromiseToPayError || err instanceof CustomerContactMissingError) {
      return c.json(body(err.code, err.message, err.messageEn), 422);
    }
    if (err instanceof SmsProviderNotConfiguredError || err instanceof DunningReminderNotSendableError) {
      return c.json(body(err.code, err.message, err.messageEn), 409);
    }
    if (err instanceof DunningReminderNotFoundError || err instanceof PromiseToPayNotFoundError || err instanceof DunningHoldNotFoundError) {
      return c.json(body(err.code, err.message, err.messageEn), 404);
    }
    throw err;
  }

  app.get("/policy", gate("sales.collections.view"), async (c) => {
    const { policy, isDefault } = await currentPolicy();
    return c.json(policyDTO(policy, isDefault));
  });

  app.put("/policy", gate("sales.collections.manage"), async (c) => {
    const parsed = updateDunningPolicySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(body(CollectionsRefusal.InvalidRequest, "بيانات سياسة التحصيل غير صالحة.", "The collection policy is not valid.", { issues: parsed.error.issues }), 400);
    }
    const { policy: previous } = await currentPolicy();
    const at = now();
    try {
      const next = assertValidDunningPolicy(
        {
          steps: parsed.data.steps.map(({ stepKey, ...step }, index) => ({ ...step, id: stepKey, level: index + 1, channel: step.channel as unknown as DunningChannel })),
          autoSendEnabled: parsed.data.autoSendEnabled,
          minimumOverdueAmount: Money.fromMajor(parsed.data.minimumOverdueAmount),
          pauseWhilePromisePending: parsed.data.pauseWhilePromisePending,
          lastScheduledRunDate: previous.lastScheduledRunDate,
          updatedAt: at,
          updatedBy: actorOf(c),
        },
        { smsAvailable: false },
      );
      await deps.store.policy.save(next);
      await recordAdminEvent(deps.audit, c, {
        module: "sales",
        entityType: "dunning_policy",
        entityId: "default",
        action: CollectionsAuditAction.PolicyUpdate,
        details: { steps: next.steps.length, autoSendEnabled: next.autoSendEnabled, previousAutoSendEnabled: previous.autoSendEnabled, action: AuditChangeAction.Update },
      });
      return c.json(policyDTO(next, false));
    } catch (err) {
      return domainRefusal(c, err);
    }
  });

  app.get("/worklist", gate("sales.collections.view"), async (c) => {
    const day = await today(c);
    const [items, customers, { policy }, reminders, holds, promises] = await Promise.all([
      receivableItems(c, day, true),
      customerDirectory(),
      currentPolicy(),
      deps.store.reminders.list({ limit: REMINDER_LIST_LIMIT * 4 }),
      deps.store.holds.list(),
      evaluatedPromises(day),
    ]);
    const rows = buildCollectionWorklist(items, day);
    const names = nameMap(customers);
    const pending = new Map(promises.filter((p) => p.status === PromiseToPayStatus.Pending).map((p) => [p.customerId, p]));
    const holdMap = new Map(holds.map((h) => [h.customerId, h]));
    const result: CollectionsWorklistDTO = {
      asOfDate: day,
      totalOverdue: Money.sum(rows.map((row) => row.overdue)).toString(),
      customerCount: rows.length,
      rows: rows.map((row) => rowDTO(row, policy, reminders, customers, holdMap, pending, names, day)),
    };
    return c.json(result);
  });

  async function executeRun(c: Context, day: string, customerIds: ReadonlySet<string> | undefined) {
    const [items, customers, { policy }, existing, holds, promises, company] = await Promise.all([
      receivableItems(c, day, false),
      customerDirectory(),
      currentPolicy(),
      deps.store.reminders.list({ limit: 100_000 }),
      deps.store.holds.list(),
      evaluatedPromises(day),
      deps.company(),
    ]);
    const rows = buildCollectionWorklist(items, day);
    const pendingPromiseCustomerIds = new Set(promises.filter((p) => p.status === PromiseToPayStatus.Pending).map((p) => p.customerId));
    const heldCustomerIds = new Set(holds.filter((h) => holdActive(h, day)).map((h) => h.customerId));
    const at = now();
    const plan = planDunningRun({
      policy,
      rows,
      existing,
      heldCustomerIds,
      pendingPromiseCustomerIds,
      ...(customerIds ? { customerIds } : {}),
      asOfDate: day,
      now: at,
      actor: actorOf(c),
      idGen: newId,
      render: (step, row, item) => {
        const common = {
          customerName: customers.get(row.customerId)?.nameAr ?? row.customerName,
          companyName: company.companyName,
          documentNumber: documentLabel(item),
          dueDate: item.dueDate,
          daysOverdue: String(item.daysOverdue),
        };
        return renderDunningMessage(
          step,
          { ...common, amount: formatMoneyLabel(item.amount, currencyLabelAr(company.currency)), totalOverdue: formatMoneyLabel(row.overdue, currencyLabelAr(company.currency)) },
          { ...common, amount: formatMoneyLabel(item.amount, company.currency), totalOverdue: formatMoneyLabel(row.overdue, company.currency) },
        );
      },
    });
    let prepared = 0;
    for (const reminder of plan.toInsert) {
      if (await deps.store.reminders.insertIfAbsent(reminder)) prepared += 1;
    }
    for (const reminder of plan.toVoid) await deps.store.reminders.update(reminder);
    const result: DunningRunResultDTO = {
      asOfDate: day,
      prepared,
      voided: plan.toVoid.length,
      skippedHeld: plan.skippedHeld,
      skippedPromised: plan.skippedPromised,
      skippedBelowMinimum: plan.skippedBelowMinimum,
    };
    await recordAdminEvent(deps.audit, c, {
      module: "sales",
      entityType: "dunning_run",
      entityId: day,
      action: CollectionsAuditAction.DunningRun,
      details: { ...result },
    });
    return result;
  }

  function companyWideOnly(c: Context): Response | null {
    if (branchScopeOf(c) === undefined) return null;
    return c.json(
      body(
        CollectionsRefusal.CompanyWideOnly,
        "تشغيل المتابعة يشمل مستحقات كل الفروع؛ يلزمه تصريح على كل الفروع.",
        "Running the follow-up covers every branch's receivables; it needs access to all branches.",
      ),
      403,
    );
  }

  app.post("/dunning-run", gate("sales.collections.run"), async (c) => {
    const refusal = companyWideOnly(c);
    if (refusal) return refusal;
    const parsed = dunningRunSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(body(CollectionsRefusal.InvalidRequest, "طلب المتابعة غير صالح.", "The follow-up request is not valid.", { issues: parsed.error.issues }), 400);
    }
    const ids = parsed.data.customerIds && parsed.data.customerIds.length > 0 ? new Set(parsed.data.customerIds) : undefined;
    return c.json(await executeRun(c, await today(c), ids));
  });

  app.post("/scheduled-run", gate("sales.collections.run"), async (c) => {
    const refusal = companyWideOnly(c);
    if (refusal) return refusal;
    const { policy } = await currentPolicy();
    if (!policy.autoSendEnabled) {
      return c.json(
        body(CollectionsRefusal.AutoSendDisabled, "الإرسال التلقائي غير مفعّل في سياسة التحصيل.", "Automatic sending is not switched on in the collection policy."),
        409,
      );
    }
    const day = await today(c);
    if (policy.lastScheduledRunDate === day) return c.json<ScheduledDunningRunResultDTO>({ alreadyRan: true, run: null, queued: 0 });
    const run = await executeRun(c, day, undefined);
    const customers = await customerDirectory();
    let queued = 0;
    for (const reminder of await deps.store.reminders.list({ statuses: [DunningReminderStatus.Prepared], limit: 100_000 })) {
      if (reminder.channel !== DunningChannel.Email) continue;
      const email = customers.get(reminder.customerId)?.email;
      if (!email) continue;
      await queueEmail(reminder, c);
      queued += 1;
    }
    await deps.store.policy.save({ ...policy, lastScheduledRunDate: day });
    return c.json<ScheduledDunningRunResultDTO>({ alreadyRan: false, run, queued });
  });

  async function queueEmail(reminder: DunningReminder, c: Context): Promise<DunningReminder> {
    const messageId = newId();
    await deps.store.outbox.enqueue({
      id: messageId,
      customerId: reminder.customerId,
      subject: reminder.subject,
      body: reminder.body,
      status: CustomerMessageStatus.Queued,
      failureReason: null,
      createdAt: now(),
      sentAt: null,
    });
    const queued: DunningReminder = { ...reminder, status: DunningReminderStatus.Queued, messageId, sentBy: actorOf(c) };
    await deps.store.reminders.update(queued);
    await recordAdminEvent(deps.audit, c, {
      module: "sales",
      entityType: "dunning_reminder",
      entityId: reminder.id,
      action: CollectionsAuditAction.ReminderQueued,
      details: { customerId: reminder.customerId, itemKey: reminder.itemKey, stepLevel: reminder.stepLevel },
    });
    return queued;
  }

  app.get("/reminders", gate("sales.collections.view"), async (c) => {
    const statusParam = c.req.query("status");
    const customerId = c.req.query("customerId");
    const statuses = statusParam
      ? statusParam.split(",").filter((s): s is DunningReminderStatus => (Object.values(DunningReminderStatus) as string[]).includes(s))
      : undefined;
    const [list, customers] = await Promise.all([
      deps.store.reminders.list({ ...(customerId ? { customerId } : {}), ...(statuses ? { statuses } : {}), limit: REMINDER_LIST_LIMIT }),
      customerDirectory(),
    ]);
    const scope = branchScopeOf(c);
    const visible =
      scope === undefined
        ? list
        : list.filter((reminder) => {
            const customer = customers.get(reminder.customerId);
            return customer ? withinBranchScope(customer.branchId, scope, canSeeUnattributed(c)) : false;
          });
    return c.json((await effectiveStatuses(visible)).map((reminder) => reminderDTO(reminder, customers)));
  });

  app.post("/reminders/:id/send", gate("sales.collections.send"), async (c) => {
    try {
      const reminder = await deps.store.reminders.findById(c.req.param("id"));
      if (!reminder) throw new DunningReminderNotFoundError(c.req.param("id"));
      const customerOrResponse = await customerOrRefusal(c, reminder.customerId);
      if (customerOrResponse instanceof Response) return customerOrResponse;
      const customer = customerOrResponse;
      if (reminder.status !== DunningReminderStatus.Prepared && reminder.status !== DunningReminderStatus.Failed) {
        throw new DunningReminderNotSendableError(reminder.id, reminder.status);
      }
      const day = await today(c);
      const open = openReceivableItems(await receivableItems(c, day, false), day).find((item) => item.key === reminder.itemKey);
      if (!open || open.customerId !== reminder.customerId || open.daysOverdue <= 0) {
        return c.json(body(CollectionsRefusal.ItemSettled, SETTLED_ITEM_AR, SETTLED_ITEM_EN), 409);
      }
      let link: string | null = null;
      let next: DunningReminder;
      switch (reminder.channel) {
        case DunningChannel.Sms:
          throw new SmsProviderNotConfiguredError();
        case DunningChannel.Email: {
          if (!customer.email) throw new CustomerContactMissingError(customer.id, DunningChannel.Email);
          next = await queueEmail({ ...reminder, failureReason: null }, c);
          break;
        }
        case DunningChannel.WhatsApp: {
          link = whatsAppLink(customer.phone, reminder.body);
          if (!link) throw new CustomerContactMissingError(customer.id, DunningChannel.WhatsApp);
          next = { ...reminder, status: DunningReminderStatus.Sent, sentAt: now(), sentBy: actorOf(c), failureReason: null, outcome: ReminderOutcome.WhatsAppLink };
          await deps.store.reminders.update(next);
          break;
        }
        case DunningChannel.Call: {
          next = { ...reminder, status: DunningReminderStatus.Sent, sentAt: now(), sentBy: actorOf(c), failureReason: null, outcome: ReminderOutcome.CallLogged };
          await deps.store.reminders.update(next);
          break;
        }
      }
      if (reminder.channel !== DunningChannel.Email) {
        await recordAdminEvent(deps.audit, c, {
          module: "sales",
          entityType: "dunning_reminder",
          entityId: reminder.id,
          action: CollectionsAuditAction.ReminderSent,
          details: { customerId: reminder.customerId, channel: reminder.channel, itemKey: reminder.itemKey, stepLevel: reminder.stepLevel },
        });
      }
      const customers = await customerDirectory();
      const result: SendReminderResultDTO = { reminder: reminderDTO(next, customers), whatsappLink: link };
      return c.json(result);
    } catch (err) {
      return domainRefusal(c, err);
    }
  });

  app.post("/customers/:id/send-reminders", gate("sales.collections.send"), async (c) => {
    const parsed = sendStatementSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(body(CollectionsRefusal.InvalidRequest, "قناة الإرسال غير صالحة.", "The channel is not valid.", { issues: parsed.error.issues }), 400);
    }
    try {
      const customerOrResponse = await customerOrRefusal(c, c.req.param("id"));
      if (customerOrResponse instanceof Response) return customerOrResponse;
      const customer = customerOrResponse;
      const channel = parsed.data.channel === StatementChannelDTO.Email ? DunningChannel.Email : DunningChannel.WhatsApp;
      const day = await today(c);
      const openKeys = new Set(
        openReceivableItems(await receivableItems(c, day, false), day)
          .filter((item) => item.customerId === customer.id && item.daysOverdue > 0)
          .map((item) => item.key),
      );
      const candidates = (await deps.store.reminders.list({ customerId: customer.id, statuses: [DunningReminderStatus.Prepared, DunningReminderStatus.Failed], limit: REMINDER_LIST_LIMIT })).filter(
        (reminder) => reminder.channel === channel && openKeys.has(reminder.itemKey),
      );
      const company = await deps.company();
      const message = consolidateReminders(candidates, company.currency);
      if (!message) return c.json(body(CollectionsRefusal.ItemSettled, SETTLED_ITEM_AR, SETTLED_ITEM_EN), 409);
      let link: string | null = null;
      let messageId: string | null = null;
      if (channel === DunningChannel.Email) {
        if (!customer.email) throw new CustomerContactMissingError(customer.id, DunningChannel.Email);
        messageId = newId();
        await deps.store.outbox.enqueue({
          id: messageId,
          customerId: customer.id,
          subject: message.subject,
          body: message.body,
          status: CustomerMessageStatus.Queued,
          failureReason: null,
          createdAt: now(),
          sentAt: null,
        });
      } else {
        link = whatsAppLink(customer.phone, message.body);
        if (!link) throw new CustomerContactMissingError(customer.id, DunningChannel.WhatsApp);
      }
      const at = now();
      for (const reminder of candidates) {
        await deps.store.reminders.update(
          messageId !== null
            ? { ...reminder, status: DunningReminderStatus.Queued, messageId, failureReason: null, sentBy: actorOf(c) }
            : { ...reminder, status: DunningReminderStatus.Sent, sentAt: at, sentBy: actorOf(c), failureReason: null, outcome: ReminderOutcome.WhatsAppLink },
        );
      }
      await recordAdminEvent(deps.audit, c, {
        module: "sales",
        entityType: "dunning_reminder",
        entityId: customer.id,
        action: messageId !== null ? CollectionsAuditAction.ReminderQueued : CollectionsAuditAction.ReminderSent,
        details: { customerId: customer.id, channel, reminders: candidates.map((r) => r.id), consolidated: true },
      });
      const result: SendStatementResultDTO = {
        channel: parsed.data.channel,
        subject: message.subject,
        body: message.body,
        whatsappLink: link,
        queuedMessageId: messageId,
      };
      return c.json(result);
    } catch (err) {
      return domainRefusal(c, err);
    }
  });

  app.post("/reminders/:id/dismiss", gate("sales.collections.send"), async (c) => {
    try {
      const parsed = dismissReminderSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json(body(CollectionsRefusal.InvalidRequest, "الطلب غير صالح.", "The request is not valid.", { issues: parsed.error.issues }), 400);
      const reminder = await deps.store.reminders.findById(c.req.param("id"));
      if (!reminder) throw new DunningReminderNotFoundError(c.req.param("id"));
      const customerOrResponse = await customerOrRefusal(c, reminder.customerId);
      if (customerOrResponse instanceof Response) return customerOrResponse;
      if (reminder.status !== DunningReminderStatus.Prepared && reminder.status !== DunningReminderStatus.Failed) {
        throw new DunningReminderNotSendableError(reminder.id, reminder.status);
      }
      const next: DunningReminder = { ...reminder, status: DunningReminderStatus.Dismissed, outcome: parsed.data.note ?? null };
      await deps.store.reminders.update(next);
      await recordAdminEvent(deps.audit, c, {
        module: "sales",
        entityType: "dunning_reminder",
        entityId: reminder.id,
        action: CollectionsAuditAction.ReminderDismissed,
        details: { customerId: reminder.customerId, itemKey: reminder.itemKey },
      });
      return c.json(reminderDTO(next, await customerDirectory()));
    } catch (err) {
      return domainRefusal(c, err);
    }
  });

  app.get("/outbox", gate("sales.collections.view"), async (c) => {
    const queued = (await deps.store.outbox.listQueued(10_000)).length;
    const result = { queued, mailConfigured: deps.mailConfigured ? await deps.mailConfigured() : false };
    return c.json(result);
  });

  app.post("/outbox/drain", gate("sales.collections.send"), async (c) => {
    if (!deps.drain) {
      return c.json(body(CollectionsRefusal.TransportUnavailable, "لا توجد قناة إرسال خارجية موصولة على هذا الخادم.", "No outbound transport is wired on this server."), 503);
    }
    if (deps.mailConfigured && !(await deps.mailConfigured())) {
      return c.json(
        body(
          CollectionsRefusal.MailNotConfigured,
          "البريد الإلكتروني غير مُفعَّل في الإعدادات؛ لم يُرسَل شيء وبقيت الرسائل في الانتظار.",
          "Email is not switched on in the settings; nothing was sent and the messages are still waiting.",
        ),
        409,
      );
    }
    const drained = await deps.drain();
    await settleQueuedReminders();
    return c.json({ attempted: drained.attempted, sent: drained.sent, stillQueued: drained.stillQueued, failed: drained.failed, skipped: drained.skipped });
  });

  app.get("/promises", gate("sales.collections.view"), async (c) => {
    const customerId = c.req.query("customerId");
    const [promises, customers] = await Promise.all([evaluatedPromises(await today(c), customerId || undefined), customerDirectory()]);
    const scope = branchScopeOf(c);
    const names = nameMap(customers);
    return c.json(
      promises
        .filter((promise) => scope === undefined || withinBranchScope(customers.get(promise.customerId)?.branchId, scope, canSeeUnattributed(c)))
        .map((promise) => promiseDTO(promise, names)),
    );
  });

  app.post("/promises", gate("sales.collections.edit"), async (c) => {
    const parsed = createPromiseToPaySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(body(CollectionsRefusal.InvalidRequest, "بيانات الوعد بالسداد غير صالحة.", "The promise to pay is not valid.", { issues: parsed.error.issues }), 400);
    }
    try {
      const customerOrResponse = await customerOrRefusal(c, parsed.data.customerId);
      if (customerOrResponse instanceof Response) return customerOrResponse;
      const day = await today(c);
      const overdue = openReceivableItems(await receivableItems(c, day, true), day).filter(
        (item) => item.customerId === parsed.data.customerId && item.daysOverdue > 0 && item.documentId !== null,
      );
      const overdueDocuments = new Map<string, bigint>();
      for (const item of overdue) overdueDocuments.set(item.documentId!, (overdueDocuments.get(item.documentId!) ?? 0n) + item.amount.scaled);
      const chosen = parsed.data.invoiceIds && parsed.data.invoiceIds.length > 0 ? [...new Set(parsed.data.invoiceIds)] : [...overdueDocuments.keys()];
      if (chosen.some((id) => !overdueDocuments.has(id))) {
        return c.json(
          body(CollectionsRefusal.PromiseInvoicesInvalid, "الوعد يغطي فاتورة غير متأخرة لهذا العميل.", "The promise names an invoice that is not overdue for this customer."),
          422,
        );
      }
      const amount = Money.fromMajor(parsed.data.amount);
      const coverage = chosen.reduce((sum, id) => sum + (overdueDocuments.get(id) ?? 0n), 0n);
      if (amount.scaled > coverage) {
        throw new InvalidPromiseToPayError("مبلغ الوعد يتجاوز المتأخر على الفواتير المختارة.", "The promised amount exceeds what is overdue on the chosen invoices.");
      }
      const promise: PromiseToPay = createPromiseToPay({
        id: newId(),
        customerId: parsed.data.customerId,
        promisedDate: parsed.data.promisedDate,
        amount,
        invoiceIds: chosen,
        note: parsed.data.note ?? null,
        today: day,
        now: now(),
        actor: actorOf(c),
      });
      await deps.store.promises.save(promise);
      await recordAdminEvent(deps.audit, c, {
        module: "sales",
        entityType: "promise_to_pay",
        entityId: promise.id,
        action: CollectionsAuditAction.PromiseCreated,
        details: { customerId: promise.customerId, promisedDate: promise.promisedDate, amount: promise.amount.toString(), invoices: promise.invoiceIds.length },
      });
      const [evaluated] = await evaluatedPromisesFor([promise], day);
      return c.json(promiseDTO(evaluated!, nameMap(await customerDirectory())), 201);
    } catch (err) {
      return domainRefusal(c, err);
    }
  });

  async function evaluatedPromisesFor(promises: readonly PromiseToPay[], day: string): Promise<EvaluatedPromise[]> {
    const byInvoice = new Map<string, Awaited<ReturnType<AllocationRepository["listByInvoice"]>>>();
    for (const promise of promises) {
      for (const invoiceId of promise.invoiceIds) byInvoice.set(invoiceId, await deps.allocations.listByInvoice(invoiceId));
    }
    return promises.map((promise) => evaluatePromise(promise, byInvoice, day));
  }

  app.post("/promises/:id/cancel", gate("sales.collections.edit"), async (c) => {
    try {
      const promise = await deps.store.promises.findById(c.req.param("id"));
      if (!promise) throw new PromiseToPayNotFoundError(c.req.param("id"));
      const customerOrResponse = await customerOrRefusal(c, promise.customerId);
      if (customerOrResponse instanceof Response) return customerOrResponse;
      const next: PromiseToPay = promise.cancelledAt ? promise : { ...promise, cancelledAt: now(), cancelledBy: actorOf(c) };
      if (!promise.cancelledAt) {
        await deps.store.promises.save(next);
        await recordAdminEvent(deps.audit, c, {
          module: "sales",
          entityType: "promise_to_pay",
          entityId: promise.id,
          action: CollectionsAuditAction.PromiseCancelled,
          details: { customerId: promise.customerId },
        });
      }
      const [evaluated] = await evaluatedPromisesFor([next], await today(c));
      return c.json(promiseDTO(evaluated!, nameMap(await customerDirectory())));
    } catch (err) {
      return domainRefusal(c, err);
    }
  });

  app.get("/customers/:id", gate("sales.collections.view"), async (c) => {
    const customerOrResponse = await customerOrRefusal(c, c.req.param("id"));
    if (customerOrResponse instanceof Response) return customerOrResponse;
    const customerId = customerOrResponse.id;
    const day = await today(c);
    const [items, customers, { policy }, reminders, hold, promises, activities] = await Promise.all([
      receivableItems(c, day, true),
      customerDirectory(),
      currentPolicy(),
      deps.store.reminders.list({ customerId, limit: REMINDER_LIST_LIMIT }),
      deps.store.holds.find(customerId),
      evaluatedPromises(day, customerId),
      deps.store.activities.list({ customerId }),
    ]);
    const names = nameMap(customers);
    const row = buildCollectionWorklist(items.filter((item) => item.partyId === customerId), day)[0] ?? null;
    const holdMap = new Map(hold ? [[customerId, hold]] : []);
    const pending = new Map(promises.filter((p) => p.status === PromiseToPayStatus.Pending).map((p) => [p.customerId, p]));
    const result: CustomerCollectionsDTO = {
      asOfDate: day,
      customerId,
      row: row ? rowDTO(row, policy, reminders, customers, holdMap, pending, names, day) : null,
      hold: hold && holdActive(hold, day) ? holdDTO(hold) : null,
      reminders: (await effectiveStatuses(reminders)).map((reminder) => reminderDTO(reminder, customers)),
      promises: promises.map((promise) => promiseDTO(promise, names)),
      activities: activities.map<CollectionActivityDTO>((activity) => ({
        id: activity.id,
        kind: activity.kind as unknown as CollectionActivityDTO["kind"],
        text: activity.text,
        createdAt: activity.createdAt,
        createdBy: activity.createdBy,
      })),
    };
    return c.json(result);
  });

  app.post("/customers/:id/notes", gate("sales.collections.edit"), async (c) => {
    const parsed = collectionNoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(body(CollectionsRefusal.InvalidRequest, "نص الملاحظة غير صالح.", "The note is not valid.", { issues: parsed.error.issues }), 400);
    }
    const customerOrResponse = await customerOrRefusal(c, c.req.param("id"));
    if (customerOrResponse instanceof Response) return customerOrResponse;
    const activity = {
      id: newId(),
      customerId: customerOrResponse.id,
      kind: parsed.data.kind as unknown as CollectionActivityKind,
      text: parsed.data.text,
      createdAt: now(),
      createdBy: actorOf(c),
    };
    await deps.store.activities.save(activity);
    await recordAdminEvent(deps.audit, c, {
      module: "sales",
      entityType: "collection_activity",
      entityId: activity.id,
      action: CollectionsAuditAction.NoteAdded,
      details: { customerId: activity.customerId, kind: activity.kind },
    });
    return c.json({ id: activity.id, kind: activity.kind, text: activity.text, createdAt: activity.createdAt, createdBy: activity.createdBy }, 201);
  });

  app.put("/customers/:id/hold", gate("sales.collections.edit"), async (c) => {
    const parsed = collectionHoldSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(body(CollectionsRefusal.InvalidRequest, "بيانات إيقاف المطالبة غير صالحة.", "The dunning pause is not valid.", { issues: parsed.error.issues }), 400);
    }
    const customerOrResponse = await customerOrRefusal(c, c.req.param("id"));
    if (customerOrResponse instanceof Response) return customerOrResponse;
    const hold: CollectionHold = {
      customerId: customerOrResponse.id,
      reason: parsed.data.reason,
      until: parsed.data.until,
      createdAt: now(),
      createdBy: actorOf(c),
    };
    await deps.store.holds.save(hold);
    await recordAdminEvent(deps.audit, c, {
      module: "sales",
      entityType: "collection_hold",
      entityId: hold.customerId,
      action: CollectionsAuditAction.HoldSet,
      details: { until: hold.until, reason: hold.reason },
    });
    return c.json(holdDTO(hold));
  });

  app.delete("/customers/:id/hold", gate("sales.collections.edit"), async (c) => {
    try {
      const customerOrResponse = await customerOrRefusal(c, c.req.param("id"));
      if (customerOrResponse instanceof Response) return customerOrResponse;
      if (!(await deps.store.holds.find(customerOrResponse.id))) throw new DunningHoldNotFoundError(customerOrResponse.id);
      await deps.store.holds.remove(customerOrResponse.id);
      await recordAdminEvent(deps.audit, c, {
        module: "sales",
        entityType: "collection_hold",
        entityId: customerOrResponse.id,
        action: CollectionsAuditAction.HoldLifted,
        details: null,
      });
      return c.body(null, 204);
    } catch (err) {
      return domainRefusal(c, err);
    }
  });

  app.post("/customers/:id/statement", gate("sales.collections.send"), async (c) => {
    const parsed = sendStatementSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(body(CollectionsRefusal.InvalidRequest, "قناة إرسال الكشف غير صالحة.", "The statement channel is not valid.", { issues: parsed.error.issues }), 400);
    }
    try {
      const customerOrResponse = await customerOrRefusal(c, c.req.param("id"));
      if (customerOrResponse instanceof Response) return customerOrResponse;
      const customer = customerOrResponse;
      const day = await today(c);
      const company = await deps.company();
      const open = openReceivableItems((await receivableItems(c, day, true)).filter((item) => item.partyId === customer.id), day);
      const rendered = renderOpenItemStatement({
        customerName: customer.nameAr,
        companyName: company.companyName,
        asOfDate: day,
        currency: company.currency,
        items: open,
        balance: Money.sum(open.map((item) => item.amount)),
      });
      let link: string | null = null;
      let queuedMessageId: string | null = null;
      if (parsed.data.channel === StatementChannelDTO.Email) {
        if (!customer.email) throw new CustomerContactMissingError(customer.id, DunningChannel.Email);
        queuedMessageId = newId();
        await deps.store.outbox.enqueue({
          id: queuedMessageId,
          customerId: customer.id,
          subject: rendered.subject,
          body: rendered.body,
          status: CustomerMessageStatus.Queued,
          failureReason: null,
          createdAt: now(),
          sentAt: null,
        });
      } else {
        link = whatsAppLink(customer.phone, rendered.body);
        if (!link) throw new CustomerContactMissingError(customer.id, DunningChannel.WhatsApp);
      }
      await deps.store.activities.save({
        id: newId(),
        customerId: customer.id,
        kind: CollectionActivityKind.StatementSent,
        text: parsed.data.channel,
        createdAt: now(),
        createdBy: actorOf(c),
      });
      await recordAdminEvent(deps.audit, c, {
        module: "sales",
        entityType: "customer_statement",
        entityId: customer.id,
        action: CollectionsAuditAction.StatementSent,
        details: { channel: parsed.data.channel, asOfDate: day, items: open.length },
      });
      const result: SendStatementResultDTO = {
        channel: parsed.data.channel,
        subject: rendered.subject,
        body: rendered.body,
        whatsappLink: link,
        queuedMessageId,
      };
      return c.json(result);
    } catch (err) {
      return domainRefusal(c, err);
    }
  });

  return app;
}
