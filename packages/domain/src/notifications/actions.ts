import { NotificationNotFoundError } from "./errors.js";
import type { Notification, NotificationRepository } from "./types.js";

/** Marks one notification read — a no-op if it does not belong to `userId` (never leaks another user's data through a 404/500 timing difference). */
export async function markNotificationRead(
  id: string,
  userId: string,
  repo: NotificationRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<Notification> {
  const existing = await repo.findById(id);
  if (!existing || existing.recipientUserId !== userId) throw new NotificationNotFoundError(id);
  if (existing.status === "unread") {
    await repo.markRead(id, userId, now());
  }
  return (await repo.findById(id)) as Notification;
}

export async function markAllNotificationsRead(
  userId: string,
  repo: NotificationRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  await repo.markAllRead(userId, now());
}
