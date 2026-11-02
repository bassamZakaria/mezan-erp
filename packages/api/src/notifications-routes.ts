import { postingRefusalResponse } from "./posting-refusal.js";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  can,
  isModuleLicensed,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationChannelState,
  NotificationNotFoundError,
  type DrainResult,
  type Notification,
  type NotificationRepository,
} from "@mezan/domain";
import { notificationListQuerySchema } from "@mezan/contracts";
import { createAuthenticatedGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { moduleRefusal } from "./module-gate.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * Refuses the bell panel when `notifications` isn't licensed. Unlike the other
 * routes, there is no permission code here to route through
 * `createPermissionGate` (every route already scopes to "your own inbox"), so
 * this reads the bound entitlements directly — the same source
 * `createPermissionGate` reads, just without a permission code to key off.
 */
function notificationsModuleGate(): MiddlewareHandler {
  return async function moduleGate(c, next) {
    const entitlements = c.get("entitlements");
    if (entitlements && !isModuleLicensed("notifications", entitlements)) {
      return c.json(moduleRefusal("notifications"), 403);
    }
    await next();
  };
}

function serialize(n: Notification) {
  return {
    id: n.id,
    ruleId: n.ruleId,
    recipientUserId: n.recipientUserId,
    eventCode: n.eventCode,
    title: n.title,
    body: n.body,
    priority: n.priority,
    channels: n.channels,
    channelStatus: n.channelStatus,
    status: n.status,
    payload: n.payload,
    createdAt: n.createdAt,
    readAt: n.readAt,
  };
}

function authContextOf(c: Context) {
  const ctx = getAuthContext(c);
  // The gate runs before every handler here, so this is unreachable; throwing
  // beats silently falling back to a caller id nobody authenticated.
  if (!ctx) throw new Error("notifications: no auth context on the request");
  return ctx;
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof NotificationNotFoundError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 404);
  }
  throw err;
}

/**
 * The top-bar bell panel's own data surface (docs/archive/catalog/09 §الإشعارات):
 * every route scopes to the CALLING user's own notifications — there is no
 * "view anyone's notifications" mode, so unlike `/notification-rules` these
 * routes are not permission-gated beyond "you are someone."
 *
 * "You are someone" is still a check. Taking the user id as the whole
 * authorization served a caller the server could not identify as the literal
 * user "anonymous" — a 200 where the client needed a 401 to send the person
 * back to sign in, and a write path that marked that pseudo-user inbox read
 * (D132).
 */
export interface NotificationsRoutesOptions {
  /**
   * Drains the outbound queue. Omitted, `POST /notifications/drain` answers 503
   * rather than 404: the button exists on the settings screen either way, and a
   * 404 would read as "wrong URL" when the truth is "no transport is wired".
   */
  readonly drain?: () => Promise<DrainResult>;
  // INVARIANT: a drain run while mail is switched off does not skip the queue, it REJECTS every waiting email for good (the transport answers "rejected"), so the route refuses to start one.
  readonly mailConfigured?: () => Promise<boolean>;
}

export const OUTBOX_SCAN_LIMIT = 1000;

const SETTINGS_EDIT_PERMISSION = "admin.settings.edit";

export type OutboxReadableRepository = NotificationRepository & {
  listQueued?(limit: number): Promise<readonly Notification[]>;
};

export function createNotificationsRoutes(
  repo: OutboxReadableRepository,
  resolveAuthContext: AuthContextResolver,
  options: NotificationsRoutesOptions = {},
) {
  const app = new Hono();
  app.use("*", createAuthenticatedGate(resolveAuthContext));
  app.use("*", notificationsModuleGate());

  /**
   * Sends what is waiting. Deliberately an OPERATOR ACTION, not a timer: a
   * background sender that fires while nobody is watching is how a shop finds
   * out it has been emailing its customers for a week (ROADMAP §3.3).
   *
   * Gated on `admin.settings.edit` — draining the queue reaches the tenant's
   * customers, so it belongs with whoever configured the mail server, not with
   * anyone who can read their own bell panel.
   */
  app.post("/drain", async (c) => {
    const ctx = authContextOf(c);
    if (!can(ctx, "admin.settings.edit")) {
      return c.json(
        { error: "PERMISSION_DENIED", permission: "admin.settings.edit", message: "إرسال الإشعارات المعلّقة يتطلب صلاحية تعديل الإعدادات.", messageEn: "Sending pending notifications requires the edit settings permission." },
        403,
      );
    }
    if (!options.drain) {
      return c.json(
        { error: "NOTIFICATION_TRANSPORT_UNAVAILABLE", message: "لا توجد قناة إرسال خارجية موصولة على هذا الخادم.", messageEn: "No external delivery channel is connected on this server." },
        503,
      );
    }
    if (options.mailConfigured && !(await options.mailConfigured())) {
      return c.json(
        {
          error: "NOTIFICATION_MAIL_NOT_CONFIGURED",
          message: "البريد الإلكتروني غير مُفعَّل في الإعدادات؛ لم يُرسَل شيء وبقيت الرسائل في الانتظار.",
          messageEn: "Email is not switched on in the settings; nothing was sent and the messages are still waiting.",
        },
        409,
      );
    }
    return c.json(await options.drain());
  });

  app.get("/outbox", async (c) => {
    const ctx = authContextOf(c);
    if (!can(ctx, SETTINGS_EDIT_PERMISSION)) {
      return c.json(
        { error: "PERMISSION_DENIED", permission: SETTINGS_EDIT_PERMISSION, message: "عرض الإشعارات المعلّقة يتطلب صلاحية تعديل الإعدادات.", messageEn: "Viewing pending notifications requires the edit settings permission." },
        403,
      );
    }
    const waiting = repo.listQueued ? await repo.listQueued(OUTBOX_SCAN_LIMIT) : [];
    const queued = waiting.reduce(
      (count, notification) => count + Object.values(notification.channelStatus).filter((status) => status === NotificationChannelState.Queued).length,
      0,
    );
    return c.json({
      queued,
      queuedIsCapped: waiting.length >= OUTBOX_SCAN_LIMIT,
      oldestQueuedAt: waiting[0]?.createdAt ?? null,
      mailConfigured: options.mailConfigured ? await options.mailConfigured() : false,
      transportAvailable: options.drain !== undefined && repo.listQueued !== undefined,
    });
  });

  app.get("/", async (c) => {
    const ctx = authContextOf(c);
    const parsed = notificationListQuerySchema.safeParse({
      status: c.req.query("status") ?? undefined,
      limit: c.req.query("limit") ?? undefined,
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const notifications = await repo.listForUser(ctx.userId, parsed.data);
    return c.json(notifications.map(serialize));
  });

  app.get("/unread-count", async (c) => {
    const ctx = authContextOf(c);
    const count = await repo.countUnread(ctx.userId);
    return c.json({ count });
  });

  app.post("/:id/read", async (c) => {
    const ctx = authContextOf(c);
    try {
      const notification = await markNotificationRead(c.req.param("id"), ctx.userId, repo);
      return c.json(serialize(notification));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/read-all", async (c) => {
    const ctx = authContextOf(c);
    await markAllNotificationsRead(ctx.userId, repo);
    return c.body(null, 204);
  });

  return app;
}
