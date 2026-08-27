import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  createDefaultUserPreferences,
  customizedSections,
  isDefaultUserPreferences,
  recordRecentlyOpened,
  resetUserPreferences,
  updateUserPreferences,
  InvalidUserPreferencesError,
  type UnitOfWork,
  type UserPreferences,
  type UserPreferencesPatch,
  type UserPreferencesRepository,
} from "@mezan/domain";
import type {
  PatchUserPreferencesDTO,
  PutUserPreferencesDTO,
  UserPreferencesDTO,
  UserPreferencesSummaryDTO,
} from "@mezan/contracts";
import {
  patchUserPreferencesSchema,
  putUserPreferencesSchema,
  recordRecentSchema,
  resetUserPreferencesSchema,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "@mezan/api";

/**
 * الوضع الشخصي — per-user shell preferences (pins, recents, rail state,
 * dashboard layout, shortcut tiles, chosen table columns, numeral system).
 *
 *   GET    /preferences                 the caller's own layout                  (self-service)
 *   PUT    /preferences                 replace it wholesale                     (self-service)
 *   PATCH  /preferences                 change one section                       (self-service)
 *   POST   /preferences/recents         push one opened record, capped + deduped (self-service)
 *   POST   /preferences/reset           reset a section (or all) server-side     (self-service)
 *   GET    /preferences/defaults        the shipped default, for a preview/diff  (self-service)
 *   GET    /preferences/users           who has customised what                  (admin.users.view)
 *   GET    /preferences/users/:userId   another user's layout, READ-ONLY         (admin.users.view)
 *
 * The self-service routes are gated the way `profile-routes.ts` gates its own —
 * on a resolved, non-anonymous caller, NOT on a permission — because they read
 * and write exactly the caller's own row.
 *
 * The two admin routes are gated on the PERMISSION CODE `admin.users.view` (a
 * permission code, not a role code — passing a role code to `createPermissionGate`
 * would satisfy nobody but the `"*"` admin and silently open nothing). It is the
 * code that already grants "may open another user's account record", and it is
 * read-only here: there is no admin write path to someone else's layout.
 */

export interface PreferencesRoutesDeps {
  readonly store: UserPreferencesRepository;
  readonly uow: Pick<UnitOfWork, "users">;
  readonly now?: () => Date;
}

function serialize(preferences: UserPreferences, stored: boolean): UserPreferencesDTO {
  return {
    userId: preferences.userId,
    layoutName: preferences.layoutName,
    numerals: preferences.numerals,
    railCollapsed: preferences.railCollapsed,
    pinnedScreens: [...preferences.pinnedScreens],
    recentRecords: [...preferences.recentRecords],
    dashboard: {
      columns: preferences.dashboard.columns,
      widgets: preferences.dashboard.widgets.map((widget) => ({ ...widget, settings: { ...widget.settings } })),
    },
    shortcutTiles: [...preferences.shortcutTiles],
    tableViews: preferences.tableViews.map((view) => ({ ...view, columns: [...view.columns] })),
    isDefault: isDefaultUserPreferences(preferences),
    customized: customizedSections(preferences),
    stored,
    createdAt: preferences.createdAt,
    updatedAt: preferences.updatedAt,
  };
}

function requireCaller(resolveAuthContext: AuthContextResolver): MiddlewareHandler {
  return async (c, next) => {
    const ctx = await resolveAuthContext(c);
    if (!ctx.userId || ctx.userId === "anonymous") {
      return c.json({ error: "UNAUTHENTICATED", message: "تسجيل الدخول مطلوب." }, 401);
    }
    c.set("authContext", ctx);
    await next();
  };
}

function callerId(c: Context): string {
  const id = getAuthContext(c)?.userId;
  if (!id) throw new Error("preferences route: missing auth context after requireCaller");
  return id;
}

/**
 * Keeps only the writable sections. The read-only keys the server computes
 * (`isDefault`, `customized`, `stored`, timestamps) are accepted by the schema
 * so a GET→edit→PUT round trip works, and dropped here.
 */
function toPatch(data: PatchUserPreferencesDTO | PutUserPreferencesDTO): UserPreferencesPatch {
  return {
    layoutName: data.layoutName,
    numerals: data.numerals,
    railCollapsed: data.railCollapsed,
    pinnedScreens: data.pinnedScreens,
    recentRecords: data.recentRecords,
    dashboard: data.dashboard,
    shortcutTiles: data.shortcutTiles,
    tableViews: data.tableViews,
  };
}

function preferencesError(c: Context, err: unknown) {
  if (err instanceof InvalidUserPreferencesError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

export function createPreferencesRoutes(
  deps: PreferencesRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const requireAuth = requireCaller(resolveAuthContext);
  const gate = createPermissionGate(resolveAuthContext);
  const now = deps.now ?? (() => new Date());

  /** A user who never customised anything still has a layout: the shipped default, materialised. */
  async function load(userId: string): Promise<{ preferences: UserPreferences; stored: boolean }> {
    const stored = await deps.store.get(userId);
    return stored
      ? { preferences: stored, stored: true }
      : { preferences: createDefaultUserPreferences(userId, now), stored: false };
  }

  async function persist(c: Context, next: UserPreferences) {
    await deps.store.save(next);
    return c.json(serialize(next, true));
  }

  app.get("/defaults", requireAuth, (c) => c.json(serialize(createDefaultUserPreferences(callerId(c), now), false)));

  app.get("/users", gate("admin.users.view"), async (c) => {
    const [rows, users] = await Promise.all([deps.store.list(), deps.uow.users.list()]);
    const byId = new Map(rows.map((row) => [row.userId, row]));
    const summaries: UserPreferencesSummaryDTO[] = users.map((user) => {
      const row = byId.get(user.id);
      const preferences = row ?? createDefaultUserPreferences(user.id, now);
      return {
        userId: user.id,
        fullName: user.fullName,
        layoutName: preferences.layoutName,
        isDefault: isDefaultUserPreferences(preferences),
        stored: row !== undefined,
        pinnedCount: preferences.pinnedScreens.length,
        shortcutCount: preferences.shortcutTiles.length,
        tableViewCount: preferences.tableViews.length,
        updatedAt: preferences.updatedAt,
      };
    });
    // A stored row whose user no longer exists still matters to a diagnosis.
    for (const row of rows) {
      if (users.some((user) => user.id === row.userId)) continue;
      summaries.push({
        userId: row.userId,
        fullName: null,
        layoutName: row.layoutName,
        isDefault: isDefaultUserPreferences(row),
        stored: true,
        pinnedCount: row.pinnedScreens.length,
        shortcutCount: row.shortcutTiles.length,
        tableViewCount: row.tableViews.length,
        updatedAt: row.updatedAt,
      });
    }
    return c.json(summaries);
  });

  app.get("/users/:userId", gate("admin.users.view"), async (c) => {
    const targetId = c.req.param("userId");
    const { preferences, stored } = await load(targetId);
    const user = await deps.uow.users.findById(targetId);
    if (!user && !stored) return c.json({ error: "NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    return c.json({ ...serialize(preferences, stored), fullName: user?.fullName ?? null, readOnly: true });
  });

  app.get("/", requireAuth, async (c) => {
    const { preferences, stored } = await load(callerId(c));
    return c.json(serialize(preferences, stored));
  });

  app.put("/", requireAuth, async (c) => {
    const parsed = putUserPreferencesSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const id = callerId(c);
    const { preferences } = await load(id);
    try {
      return await persist(c, updateUserPreferences(preferences, toPatch(parsed.data), now));
    } catch (err) {
      return preferencesError(c, err);
    }
  });

  app.patch("/", requireAuth, async (c) => {
    const parsed = patchUserPreferencesSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const id = callerId(c);
    const { preferences } = await load(id);
    try {
      return await persist(c, updateUserPreferences(preferences, toPatch(parsed.data), now));
    } catch (err) {
      return preferencesError(c, err);
    }
  });

  app.post("/recents", requireAuth, async (c) => {
    const parsed = recordRecentSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const id = callerId(c);
    const { preferences } = await load(id);
    const { openedAt, ...record } = parsed.data;
    try {
      return await persist(c, recordRecentlyOpened(preferences, { ...record, openedAt: openedAt ?? now().toISOString() }, now));
    } catch (err) {
      return preferencesError(c, err);
    }
  });

  /**
   * Reset is a REAL server operation: `scope: "all"` deletes the stored row so
   * the next read materialises the shipped default. A client-side clear would
   * leave the row behind and the next device would sync the old layout back.
   */
  app.post("/reset", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = resetUserPreferencesSchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const id = callerId(c);
    if (parsed.data.scope === "all") {
      await deps.store.remove(id);
      return c.json(serialize(createDefaultUserPreferences(id, now), false));
    }
    const { preferences } = await load(id);
    const next = resetUserPreferences(preferences, parsed.data.scope, { tableId: parsed.data.tableId }, now);
    return await persist(c, next);
  });

  return app;
}
