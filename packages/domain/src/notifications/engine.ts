import { getEventDefinition } from "../events/catalog.js";
import type { DomainEvent } from "../events/event-bus.js";
import { resolvePermissions } from "../permissions/resolve.js";
import type { Role, RoleRepository } from "../roles/role.js";
import type { User, UserRepository } from "../users/user.js";
import { evaluateCondition } from "./condition.js";
import { defaultNotificationBody, defaultNotificationTitle, renderTemplate } from "./template.js";
import type {
  Notification,
  NotificationChannelStatus,
  NotificationRepository,
  NotificationRule,
  NotificationRuleRepository,
} from "./types.js";

export interface NotificationRulesEngineDeps {
  readonly rules: NotificationRuleRepository;
  readonly notifications: NotificationRepository;
  readonly users: UserRepository;
  readonly roles: RoleRepository;
  readonly generateId: () => string;
  readonly now?: () => string;
  /** Reports a per-rule dispatch failure without stopping the other rules/recipients. */
  readonly onError?: (error: unknown, context: { rule: NotificationRule; event: DomainEvent }) => void;
}

/**
 * NotificationRulesEngine — the "قواعد الإشعارات" runtime (docs/catalog/09,
 * docs/plan.md §5.6). Subscribes to the domain `EventBus` (via `handle`,
 * typically wired through `eventBus.subscribeAll`) and, for every ACTIVE rule
 * targeting the incoming event's code whose optional condition matches,
 * resolves the recipient set and persists one `Notification` per recipient.
 *
 * In-app is the only channel actually delivered (a persisted, readable
 * notification row); email/push are recorded on the notification's
 * `channelStatus` as `"queued"` — this repo has no outbound transport for
 * either yet (docs/plan.md line 535: online-only channels must degrade, not
 * block the in-app one).
 */
export class NotificationRulesEngine {
  constructor(private readonly deps: NotificationRulesEngineDeps) {}

  async handle(event: DomainEvent): Promise<void> {
    const rules = await this.deps.rules.listActiveByEventCode(event.code);
    if (rules.length === 0) return;

    const payload = isPlainObject(event.payload) ? event.payload : {};
    const def = getEventDefinition(event.code);

    for (const rule of rules) {
      try {
        if (!evaluateCondition(rule.condition, payload)) continue;

        const recipientIds = await this.resolveRecipients(rule);
        if (recipientIds.length === 0) continue;

        const title = rule.titleAr ? renderTemplate(rule.titleAr, payload) : defaultNotificationTitle(def);
        const body = rule.bodyAr ? renderTemplate(rule.bodyAr, payload) : defaultNotificationBody(def, payload);
        const createdAt = this.deps.now?.() ?? new Date().toISOString();
        const channelStatus: Record<string, NotificationChannelStatus> = {};
        for (const channel of rule.channels) {
          channelStatus[channel] = channel === "in_app" ? "delivered" : "queued";
        }

        for (const userId of recipientIds) {
          const notification: Notification = {
            id: this.deps.generateId(),
            ruleId: rule.id,
            recipientUserId: userId,
            eventCode: event.code,
            title,
            body,
            priority: rule.priority,
            channels: rule.channels,
            channelStatus,
            status: "unread",
            payload,
            createdAt,
            readAt: null,
          };
          await this.deps.notifications.save(notification);
        }
      } catch (error) {
        if (this.deps.onError) this.deps.onError(error, { rule, event });
        else throw error;
      }
    }
  }

  /** WHO a rule notifies: one explicit user, every active user in one role, or every active user (or admin) holding one permission. */
  private async resolveRecipients(rule: NotificationRule): Promise<readonly string[]> {
    if (rule.recipientType === "user") {
      const user = await this.deps.users.findById(rule.recipientValue);
      return user && user.status === "active" ? [user.id] : [];
    }

    const users = await this.deps.users.list();
    const activeUsers = users.filter((u) => u.status === "active");

    if (rule.recipientType === "role") {
      return activeUsers.filter((u) => u.roleId === rule.recipientValue).map((u) => u.id);
    }

    // recipientType === "permission"
    const roleCache = new Map<string, Role | null>();
    const result: string[] = [];
    for (const user of activeUsers) {
      if (await this.userHoldsPermission(user, rule.recipientValue, roleCache)) result.push(user.id);
    }
    return result;
  }

  private async userHoldsPermission(
    user: User,
    permission: string,
    roleCache: Map<string, Role | null>,
  ): Promise<boolean> {
    if (user.isCompanyAdmin) return true;
    if (!user.roleId) return false;

    let role = roleCache.get(user.roleId);
    if (role === undefined) {
      role = await this.deps.roles.findById(user.roleId);
      roleCache.set(user.roleId, role);
    }
    if (!role) return false;

    return resolvePermissions(role.permissions).has(permission);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
