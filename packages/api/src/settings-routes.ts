import { Hono } from "hono";
import {
  createDefaultSettings,
  updateSettings,
  InvalidSettingsError,
  type SettingsRepository,
  type TenantSettings,
} from "@mezan/domain";
import { updateTenantSettingsSchema, sendTestEmailSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";
import { sendTestEmail } from "./smtp-client.js";

/**
 * Settings routes (docs/catalog/09 §"الإعدادات — عام"): a single tenant
 * config bag, `GET /` reads it (seeding catalog defaults on first read so the
 * UI always has something to render) and `PUT /` applies a partial patch
 * through `updateSettings`, so an invalid combination never persists. Every
 * route is permission-gated via the permissions engine (`admin.settings.*`),
 * mirroring accounts.ts's `createAccountsRouter` shape.
 *
 * `GET /currencies` is the read side of the multi-currency switch: the one
 * list every document's currency picker is allowed to offer.
 */

const MASKED_PASSWORD = "";

/** The stored SMTP password never leaves the server — see `mergePassword`. */
function maskSecrets(settings: TenantSettings): TenantSettings {
  return { ...settings, smtpPassword: MASKED_PASSWORD };
}

/**
 * An empty `smtpPassword` in a patch means "keep what is stored" — the UI only
 * ever receives the masked value back, so echoing it must not wipe the secret.
 */
function mergePassword(current: TenantSettings, patch: Partial<TenantSettings>): Partial<TenantSettings> {
  if (patch.smtpPassword !== undefined && patch.smtpPassword.trim() === "") {
    const { smtpPassword: _dropped, ...rest } = patch;
    return rest;
  }
  return patch;
}

export function createSettingsRoutes(
  store: SettingsRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.settings.view"), async (c) => {
    const existing = await store.get();
    return c.json(maskSecrets(existing ?? createDefaultSettings()));
  });

  app.get("/currencies", gate("admin.settings.view"), async (c) => {
    const settings = (await store.get()) ?? createDefaultSettings();
    return c.json({
      base: settings.currency,
      multiCurrencyEnabled: settings.multiCurrencyEnabled,
      allowed: settings.multiCurrencyEnabled
        ? [settings.currency, ...settings.secondaryCurrencies]
        : [settings.currency],
    });
  });

  app.put("/", gate("admin.settings.edit"), async (c) => {
    const parsed = updateTenantSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    try {
      const current = (await store.get()) ?? createDefaultSettings();
      const next = updateSettings(current, mergePassword(current, parsed.data));
      await store.save(next);
      return c.json(maskSecrets(next));
    } catch (err) {
      if (err instanceof InvalidSettingsError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      throw err;
    }
  });

  app.post("/email/test", gate("admin.settings.edit"), async (c) => {
    const parsed = sendTestEmailSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const settings = (await store.get()) ?? createDefaultSettings();
    const result = await sendTestEmail(settings, parsed.data.to);
    return c.json(result, result.ok ? 200 : 422);
  });

  return app;
}
