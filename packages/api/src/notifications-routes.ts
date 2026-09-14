import { Hono, type Context } from "hono";
import {
  can,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationNotFoundError,
  type Notification,
  type NotificationRepository,
} from "@mezan/domain";
import { notificationListQuerySchema } from "@mezan/contracts";
import { createAuthenticatedGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

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
  if (err instanceof NotificationNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
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
  readonly drain?: () => Promise<{
    attempted: number;
    sent: number;
    stillQueued: number;
    failed: number;
    skipped: number;
  }>;
}

export function createNotificationsRoutes(
  repo: NotificationRepository,
  resolveAuthContext: AuthContextResolver,
  options: NotificationsRoutesOptions = {},
) {
  const app = new Hono();
  app.use("*", createAuthenticatedGate(resolveAuthContext));

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
        { error: "PERMISSION_DENIED", permission: "admin.settings.edit", message: "إرسال الإشعارات المعلّقة يتطلب صلاحية تعديل الإعدادات." },
        403,
      );
    }
    if (!options.drain) {
      return c.json(
        { error: "NOTIFICATION_TRANSPORT_UNAVAILABLE", message: "لا توجد قناة إرسال خارجية موصولة على هذا الخادم." },
        503,
      );
    }
    return c.json(await options.drain());
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
