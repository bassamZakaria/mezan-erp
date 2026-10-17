import { Hono } from "hono";
import {
  createDefaultSettings,
  displaySettingsOf,
  updateSettings,
  InvalidSettingsError,
  type AuditSink,
  type SettingsRepository,
  type TenantSettings,
} from "@mezan/domain";
import {
  TENANT_SETTINGS_LOOKUP_KEYS,
  sendTestEmailSchema,
  tenantSettingsLookupSchema,
  updateTenantSettingsSchema,
  type TenantSettingsLookupDTO,
} from "@mezan/contracts";
import { createAuthenticatedGate, createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { sendTestEmail, SmtpDestinationPolicy } from "./smtp-client.js";
import { changedKeys, changedKeysAsFieldChanges, recordAdminEvent } from "./admin-audit.js";

/**
 * Settings routes (docs/archive/catalog/09 §"الإعدادات — عام"): a single tenant
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
  resolveAuthContext: AuthContextResolver,
  /**
   * Who changed which policy. These toggles decide whether a purchase invoice
   * needs a receipt, whether stock may go negative, and how credit control
   * behaves — turning one off is the cheapest way past a control, and it wrote
   * nothing at all.
   */
  audit?: AuditSink,
  mailDestinations: SmtpDestinationPolicy = SmtpDestinationPolicy.AnyHost,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.settings.view"), async (c) => {
    const existing = await store.get();
    return c.json(maskSecrets(existing ?? createDefaultSettings()));
  });

  /**
   * The settings every screen and every printed document reads: currency,
   * numerals, the company's name and tax number, the sales and stock policy.
   * Any signed-in user may ask — `admin.settings.view` is the settings SCREEN.
   * SECURITY: an allowlist. It answers `TENANT_SETTINGS_LOOKUP_KEYS` and
   * nothing else, so no setting is exposed by being added.
   */
  app.get("/lookup", createAuthenticatedGate(resolveAuthContext), async (c) => {
    const settings = (await store.get()) ?? createDefaultSettings();
    const lookup: TenantSettingsLookupDTO = tenantSettingsLookupSchema.parse(Object.fromEntries(TENANT_SETTINGS_LOOKUP_KEYS.map((key) => [key, settings[key]])));
    return c.json(lookup);
  });

  app.get("/display", createAuthenticatedGate(resolveAuthContext), async (c) => {
    return c.json(displaySettingsOf((await store.get()) ?? createDefaultSettings()));
  });

  app.get("/currencies", createAuthenticatedGate(resolveAuthContext), async (c) => {
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
      // The masked copies, so a password change is recorded as having happened
      // without the log becoming a second place the password lives.
      const changed = changedKeys(
        maskSecrets(current) as unknown as Readonly<Record<string, unknown>>,
        maskSecrets(next) as unknown as Readonly<Record<string, unknown>>,
      );
      if (Object.keys(changed).length > 0) {
        await recordAdminEvent(audit, c, {
          module: "admin",
          entityType: "TENANT_SETTINGS",
          entityId: null,
          action: "UPDATE",
          details: { changed, changes: changedKeysAsFieldChanges(changed) },
        });
      }
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
    const send = () => sendTestEmail(settings, parsed.data.to, undefined, { destinations: mailDestinations });
    const result = await (audit?.outsideTurn ? audit.outsideTurn(send) : send());
    return c.json(result, result.ok ? 200 : 422);
  });

  return app;
}
