import { randomUUID } from "node:crypto";
import { createCrmPipelineRoutes, type CrmOwnerDirectory } from "@mezan/api";
import {
  DEFAULT_TIME_ZONE,
  EVENT_BRANCH_IDS_KEY,
  dueActivityReminders,
  recordSensitiveEvent,
  resolvePermissions,
  tenantTodayIso,
  winOpportunity,
  type ActivityReminderLog,
  type ActivityRepository,
  type ActivityType,
  type AuditSink,
  type DomainEvent,
  type EventBus,
  type EventCode,
  NotificationPriorityCode,
  type Notification,
  type NotificationRepository,
  type OpportunityRepository,
  type PipelineStageRepository,
  type Role,
  type UserRepository,
} from "@mezan/domain";
import {
  createSqliteActivityReminderLog,
  createSqliteActivityRepository,
  createSqliteNotificationStore,
  createSqliteOpportunityRepository,
  createSqlitePipelineStageRepository,
  createSqliteSalesQuoteStore,
} from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";
import { ScheduledJobKind, type ScheduledJob } from "../scheduled-jobs.js";
import { createLogger } from "@mezan/api";

const areaLog = createLogger("crm");

export const CRM_ACTIVITY_DUE_EVENT = "CRM_ACTIVITY_DUE" satisfies EventCode;
export const SALES_QUOTE_ACCEPTED_EVENT = "SALES_QUOTE_ACCEPTED" satisfies EventCode;
export const SALES_QUOTE_CONVERTED_EVENT = "SALES_QUOTE_CONVERTED" satisfies EventCode;

const ACTIVITIES_LINK = "/crm/crm-activities";
const OWNER_PERMISSIONS = ["crm.opportunity.view", "crm.opportunity.view_own", "crm.opportunity.create", "crm.opportunity.edit"] as const;

const ACTIVITY_TYPE_LABELS_AR: Readonly<Record<ActivityType, string>> = {
  call: "مكالمة",
  meeting: "اجتماع",
  todo: "مهمة",
  email: "بريد إلكتروني",
};

export function createCrmOwnerDirectory(users: Pick<UserRepository, "list" | "findById">, roles: { findById(id: string): Promise<Role | null> }): CrmOwnerDirectory {
  const eligible = async (user: Awaited<ReturnType<typeof users.list>>[number]): Promise<boolean> => {
    if (user.status !== "active") return false;
    if (user.isCompanyAdmin) return true;
    if (!user.roleId) return false;
    const role = await roles.findById(user.roleId);
    if (!role) return false;
    const held = resolvePermissions(role.permissions);
    return OWNER_PERMISSIONS.some((permission) => held.has(permission));
  };
  return {
    async list() {
      const out: { id: string; name: string }[] = [];
      for (const user of await users.list()) {
        if (await eligible(user)) out.push({ id: user.id, name: user.nameAr });
      }
      return out;
    },
    async has(userId) {
      const user = await users.findById(userId);
      return user ? eligible(user) : false;
    },
  };
}

export interface CrmReminderDeps {
  readonly activities: Pick<ActivityRepository, "list">;
  readonly opportunities: Pick<OpportunityRepository, "list">;
  readonly log: ActivityReminderLog;
  readonly notifications: Pick<NotificationRepository, "save">;
  readonly users: Pick<UserRepository, "findById">;
  readonly eventBus: Pick<EventBus, "publish">;
  readonly today: () => Promise<string>;
  readonly now?: () => string;
}

export interface CrmReminderRun {
  readonly today: string;
  readonly notified: number;
}

export function createCrmReminderService(deps: CrmReminderDeps): { run(): Promise<CrmReminderRun> } {
  return {
    async run() {
      const today = await deps.today();
      const now = (deps.now ?? (() => new Date().toISOString()))();
      const opportunities = await deps.opportunities.list();
      const due = dueActivityReminders(await deps.activities.list(), opportunities, today);
      let notified = 0;
      for (const { activity, recipientUserId, opportunity } of due) {
        const dueDate = activity.dueDate as string;
        if (await deps.log.has(activity.id, dueDate)) continue;
        const recipient = await deps.users.findById(recipientUserId);
        if (!recipient || recipient.status !== "active") continue;
        const title = `حان موعد: ${activity.subject}`;
        const dealPart = opportunity ? ` — فرصة «${opportunity.title}»` : "";
        const overdue = dueDate < today;
        const body = `${ACTIVITY_TYPE_LABELS_AR[activity.type]} ${overdue ? "متأخر عن موعده" : "مستحق اليوم"} (${dueDate})${dealPart}.`;
        const notification: Notification = {
          id: randomUUID(),
          ruleId: null,
          recipientUserId,
          eventCode: CRM_ACTIVITY_DUE_EVENT,
          title,
          body,
          priority: overdue ? NotificationPriorityCode.High : NotificationPriorityCode.Normal,
          channels: ["in_app"],
          channelStatus: { in_app: "delivered" },
          status: "unread",
          payload: { activityId: activity.id, dueDate, opportunityId: opportunity?.id ?? null, link: ACTIVITIES_LINK },
          createdAt: now,
          readAt: null,
        };
        await deps.notifications.save(notification);
        await deps.log.record(activity.id, dueDate, now);
        notified += 1;
        deps.eventBus.publish(
          CRM_ACTIVITY_DUE_EVENT,
          {
            [EVENT_BRANCH_IDS_KEY]: opportunity?.branchId ? [opportunity.branchId] : [],
            activityId: activity.id,
            subject: activity.subject,
            dueDate,
            assigneeUserId: recipientUserId,
            opportunityId: opportunity?.id ?? null,
            title,
            body,
            link: ACTIVITIES_LINK,
          },
          now,
        );
      }
      return { today, notified };
    },
  };
}

export function createCrmReminderJob(service: { run(): Promise<CrmReminderRun> }, allowed?: () => boolean): ScheduledJob {
  return {
    kind: ScheduledJobKind.CrmActivityReminders,
    async run() {
      if (allowed && !allowed()) return { kind: ScheduledJobKind.CrmActivityReminders, recorded: [] };
      const result = await service.run();
      return { kind: ScheduledJobKind.CrmActivityReminders, recorded: result.notified > 0 ? [result.today] : [] };
    },
  };
}

interface QuoteEventPayload {
  readonly opportunityId?: string | null;
  readonly quoteId?: string;
  readonly actorUserId?: string | null;
}

export interface WonOnQuoteDeps {
  readonly opportunities: OpportunityRepository;
  readonly pipelineStages: Pick<PipelineStageRepository, "list">;
  readonly audit: AuditSink;
}

export async function markOpportunityWonByQuote(deps: WonOnQuoteDeps, event: DomainEvent<QuoteEventPayload>): Promise<boolean> {
  const opportunityId = event.payload.opportunityId;
  if (!opportunityId) return false;
  const opportunity = await deps.opportunities.findById(opportunityId);
  if (!opportunity || opportunity.status === "won") return false;
  const winStage = (await deps.pipelineStages.list()).find((stage) => stage.isWinStage && stage.active) ?? null;
  const won = winOpportunity(opportunity, winStage, event.occurredAt);
  const write = async (): Promise<void> => {
    await deps.opportunities.update(won);
    await recordSensitiveEvent(deps.audit, {
      module: "crm",
      entityType: "OPPORTUNITY",
      entityId: won.id,
      action: "WON_BY_QUOTE",
      actor: event.payload.actorUserId ?? "system",
      branchId: won.branchId,
      severity: "INFO",
      details: { quoteId: event.payload.quoteId ?? null, event: event.code, fromStatus: opportunity.status, toStageId: won.stageId },
    });
  };
  await (deps.audit.atomic ? deps.audit.atomic(write) : write());
  return true;
}

function inTheTurn(audit: AuditSink): <T>(work: () => Promise<T>) => Promise<T> {
  return (work) => (audit.turn ? audit.turn(work) : work());
}

export function crmReminderServiceFor(ctx: BackendModuleContext): { run(): Promise<CrmReminderRun> } {
  return createCrmReminderService({
    activities: createSqliteActivityRepository(ctx.sqlite),
    opportunities: createSqliteOpportunityRepository(ctx.sqlite),
    log: createSqliteActivityReminderLog(ctx.sqlite),
    notifications: createSqliteNotificationStore(ctx.sqlite),
    users: ctx.uow.users,
    eventBus: ctx.eventBus,
    today: async () => tenantTodayIso((await ctx.stores.settings.get())?.timezone || DEFAULT_TIME_ZONE),
  });
}

/**
 * CRM pipeline (ENH-E3-06), mounted under `/crm-pipeline`: the weighted
 * forecast, lost reasons, assignable owners and the reminder run; plus the two
 * subscribers that close a deal as won when its quote is accepted or converted.
 * Moves no money and posts nothing to the ledger.
 */
export const area: BackendArea = {
  mount(ctx) {
    const opportunities = createSqliteOpportunityRepository(ctx.sqlite);
    const pipelineStages = createSqlitePipelineStageRepository(ctx.sqlite);
    const quotes = createSqliteSalesQuoteStore(ctx.sqlite);
    const owners = createCrmOwnerDirectory(ctx.uow.users, ctx.uow.roles);
    ctx.app.route(
      "/crm-pipeline",
      createCrmPipelineRoutes({ opportunities, quotes, owners, reminders: crmReminderServiceFor(ctx) }, ctx.resolveAuthContext),
    );

    const turn = inTheTurn(ctx.audit);
    const onQuote = (event: DomainEvent<QuoteEventPayload>): void => {
      void turn(() => markOpportunityWonByQuote({ opportunities, pipelineStages, audit: ctx.audit }, event)).catch((error: unknown) => {
        areaLog.error({ err: error }, `could not close the opportunity of quote ${event.payload.quoteId ?? "?"} as won`);
      });
    };
    ctx.eventBus.subscribe<QuoteEventPayload>(SALES_QUOTE_ACCEPTED_EVENT, onQuote);
    ctx.eventBus.subscribe<QuoteEventPayload>(SALES_QUOTE_CONVERTED_EVENT, onQuote);
    ctx.addCloser(quotes);
  },
};
