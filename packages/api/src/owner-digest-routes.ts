import { Hono } from "hono";
import {
  InvalidOwnerDigestSettingsError,
  UserStatusCode,
  can,
  renderOwnerDigest,
  type AuditSink,
  type DrainResult,
  type UserRepository,
} from "@mezan/domain";
import {
  OWNER_DIGEST_EVENT,
  ownerDigestPreviewQuerySchema,
  ownerDigestSendSchema,
  ownerDigestSettingsSchema,
  type OwnerDigestPreviewDTO,
  type OwnerDigestRecipientOptionDTO,
  type OwnerDigestRunDTO,
  type OwnerDigestSettingsDTO,
} from "@mezan/contracts";
import type { OwnerDigestStore } from "@mezan/persistence";
import { recordAdminEvent } from "./admin-audit.js";
import { afterAuditCommit } from "./audit-boundary.js";
import {
  OWNER_DIGEST_VIEW_PERMISSION,
  type OwnerDigestService,
} from "./owner-digest-service.js";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

export interface OwnerDigestRoutesDeps {
  readonly service: OwnerDigestService;
  readonly store: OwnerDigestStore;
  readonly users: Pick<UserRepository, "list" | "findById">;
  readonly audit?: AuditSink;
  readonly mailConfigured: () => Promise<boolean>;
  readonly scheduleSupported: boolean;
  readonly drainOnly: (ids: ReadonlySet<string>) => Promise<DrainResult>;
}

enum OwnerDigestAuditAction {
  SettingsUpdate = "owner_digest.settings.update",
  Send = "owner_digest.send",
}

enum OwnerDigestRefusal {
  InvalidRequest = "INVALID_REQUEST",
  UnknownRecipient = "OWNER_DIGEST_UNKNOWN_RECIPIENT",
  Unauthenticated = "UNAUTHENTICATED",
}

const RECENT_RUNS = 30;

function refusal(error: string, message: string, messageEn: string, extra: Record<string, unknown> = {}) {
  return { error, message, messageEn, ...extra };
}

export function createOwnerDigestRoutes(deps: OwnerDigestRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const { service } = deps;

  async function settingsDTO(): Promise<OwnerDigestSettingsDTO> {
    const loaded = service.loadSettings();
    return {
      ...loaded.settings,
      scheduleSupported: deps.scheduleSupported,
      mailConfigured: await deps.mailConfigured(),
      updatedAt: loaded.updatedAt,
      updatedBy: loaded.updatedBy,
    };
  }

  app.get("/settings", gate("accounting.owner_digest.view"), async (c) => c.json(await settingsDTO()));

  app.get("/recipients", gate("accounting.owner_digest.manage"), async (c) => {
    const users = (await deps.users.list()).filter((user) => user.status === UserStatusCode.Active);
    const options: OwnerDigestRecipientOptionDTO[] = [];
    for (const user of users) {
      const recipient = await service.recipientOfUser(user);
      options.push({
        userId: user.id,
        name: user.nameAr,
        email: user.email,
        mayReceive: can(recipient.auth, OWNER_DIGEST_VIEW_PERMISSION) && user.email.trim() !== "",
      });
    }
    return c.json(options);
  });

  app.put("/settings", gate("accounting.owner_digest.manage"), async (c) => {
    const parsed = ownerDigestSettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(refusal(OwnerDigestRefusal.InvalidRequest, "إعدادات الملخص غير صالحة.", "The digest settings are not valid.", { issues: parsed.error.issues }), 400);
    }
    try {
      service.assertValidSettings(parsed.data);
    } catch (error) {
      if (error instanceof InvalidOwnerDigestSettingsError) {
        return c.json(refusal(error.code, error.messageAr, error.messageEn), 400);
      }
      throw error;
    }
    for (const userId of parsed.data.recipientUserIds) {
      const user = await deps.users.findById(userId);
      if (!user || user.status !== UserStatusCode.Active) {
        return c.json(refusal(OwnerDigestRefusal.UnknownRecipient, "أحد المستلمين غير موجود أو غير نشط.", "A recipient does not exist or is not active."), 400);
      }
    }
    const before = service.loadSettings().settings;
    const actor = getAuthContext(c)?.userId ?? "system";
    deps.store.saveSettings(parsed.data, service.nowIso(), actor);
    await recordAdminEvent(deps.audit, c, {
      module: "accounting",
      entityType: "owner_digest_settings",
      entityId: null,
      action: OwnerDigestAuditAction.SettingsUpdate,
      details: {
        scheduleEnabled: parsed.data.scheduleEnabled,
        previousScheduleEnabled: before.scheduleEnabled,
        cadence: parsed.data.cadence,
        recipients: parsed.data.recipientUserIds.length,
      },
    });
    return c.json(await settingsDTO());
  });

  app.get("/preview", gate("accounting.owner_digest.view"), async (c) => {
    const parsed = ownerDigestPreviewQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(refusal(OwnerDigestRefusal.InvalidRequest, "معايير المعاينة غير صالحة.", "The preview parameters are not valid.", { issues: parsed.error.issues }), 400);
    }
    const auth = getAuthContext(c);
    if (!auth) return c.json(refusal(OwnerDigestRefusal.Unauthenticated, "سجّل الدخول أولاً.", "Sign in first."), 401);
    const { settings } = service.loadSettings();
    const user = await deps.users.findById(auth.userId);
    const recipient = await service.recipientFromAuth(auth, user ? user.nameAr : null);
    const digest = await service.compose(recipient, {
      cadence: parsed.data.cadence ?? settings.cadence,
      language: parsed.data.language ?? settings.language,
      endingOn: await service.resolveEndingOn(parsed.data.endingOn),
      branchId: parsed.data.branchId,
    });
    const rendered = renderOwnerDigest(digest);
    const body: OwnerDigestPreviewDTO = { digest, email: { subject: rendered.subject, html: rendered.html } };
    return c.json(body);
  });

  app.post("/send", gate("accounting.owner_digest.send"), async (c) => {
    const parsed = ownerDigestSendSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(refusal(OwnerDigestRefusal.InvalidRequest, "طلب الإرسال غير صالح.", "The send request is not valid.", { issues: parsed.error.issues }), 400);
    }
    const { result, queuedIds } = await service.sendNow(parsed.data);
    await recordAdminEvent(deps.audit, c, {
      module: "accounting",
      entityType: "owner_digest",
      entityId: result.period.key,
      action: OwnerDigestAuditAction.Send,
      details: { queued: result.queued, alreadySent: result.alreadySent, skipped: result.skipped.length, event: OWNER_DIGEST_EVENT },
    });
    if (queuedIds.size > 0) {
      const drain = (): Promise<void> => deps.drainOnly(queuedIds).then(() => undefined);
      if (!afterAuditCommit(c, drain)) await drain();
    }
    return c.json(result);
  });

  app.get("/runs", gate("accounting.owner_digest.manage"), async (c) => {
    const names = new Map((await deps.users.list()).map((user) => [user.id, user.nameAr] as const));
    const runs: OwnerDigestRunDTO[] = deps.store.recent(RECENT_RUNS).map((run) => ({
      id: run.id,
      cadence: run.cadence,
      periodKey: run.periodKey,
      periodFrom: run.periodFrom,
      periodTo: run.periodTo,
      recipientUserId: run.recipientUserId,
      recipientName: names.get(run.recipientUserId) ?? null,
      trigger: run.trigger,
      notificationId: run.notificationId,
      createdAt: run.createdAt,
    }));
    return c.json(runs);
  });

  return app;
}

