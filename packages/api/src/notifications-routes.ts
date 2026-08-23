import { Hono, type Context } from "hono";
import {
  markAllNotificationsRead,
  markNotificationRead,
  NotificationNotFoundError,
  type Notification,
  type NotificationRepository,
} from "@mezan/domain";
import { notificationListQuerySchema } from "@mezan/contracts";
import { headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

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

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof NotificationNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  throw err;
}

/**
 * The top-bar bell panel's own data surface (docs/catalog/09 §الإشعارات):
 * every route scopes to the CALLING user's own notifications — there is no
 * "view anyone's notifications" mode, so unlike `/notification-rules` these
 * routes are not permission-gated beyond "you are someone."
 */
export function createNotificationsRoutes(
  repo: NotificationRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();

  app.get("/", async (c) => {
    const ctx = await resolveAuthContext(c);
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
    const ctx = await resolveAuthContext(c);
    const count = await repo.countUnread(ctx.userId);
    return c.json({ count });
  });

  app.post("/:id/read", async (c) => {
    const ctx = await resolveAuthContext(c);
    try {
      const notification = await markNotificationRead(c.req.param("id"), ctx.userId, repo);
      return c.json(serialize(notification));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/read-all", async (c) => {
    const ctx = await resolveAuthContext(c);
    await markAllNotificationsRead(ctx.userId, repo);
    return c.body(null, 204);
  });

  return app;
}
