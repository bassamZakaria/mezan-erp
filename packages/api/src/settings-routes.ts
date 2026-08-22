import { Hono } from "hono";
import {
  createDefaultSettings,
  updateSettings,
  InvalidSettingsError,
  type SettingsRepository,
} from "@mezan/domain";
import { updateTenantSettingsSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Settings routes (docs/catalog/09 §"الإعدادات — عام"): a single tenant
 * config bag, `GET /` reads it (seeding catalog defaults on first read so the
 * UI always has something to render) and `PUT /` applies a partial patch
 * through `updateSettings`, so an invalid combination never persists. Every
 * route is permission-gated via the permissions engine (`admin.settings.*`),
 * mirroring accounts.ts's `createAccountsRouter` shape.
 */
export function createSettingsRoutes(
  store: SettingsRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.settings.view"), async (c) => {
    const existing = await store.get();
    return c.json(existing ?? createDefaultSettings());
  });

  app.put("/", gate("admin.settings.edit"), async (c) => {
    const parsed = updateTenantSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    try {
      const current = (await store.get()) ?? createDefaultSettings();
      const next = updateSettings(current, parsed.data);
      await store.save(next);
      return c.json(next);
    } catch (err) {
      if (err instanceof InvalidSettingsError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      throw err;
    }
  });

  return app;
}
