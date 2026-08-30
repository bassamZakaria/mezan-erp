import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  createApiKey,
  revokeApiKey,
  InvalidApiKeyError,
  ApiKeyNotFoundError,
  ApiKeyAlreadyRevokedError,
  recordSensitiveEvent,
  type ApiKey,
  type ApiKeyRepository,
  type SecretHasher,
  type AuditSink,
} from "@mezan/domain";
import { createApiKeySchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

const KEY_PREFIX = "mzk_";

function generateRawKey(): { rawKey: string; prefix: string } {
  const secret = randomBytes(24).toString("base64url");
  const rawKey = `${KEY_PREFIX}${secret}`;
  return { rawKey, prefix: rawKey.slice(0, KEY_PREFIX.length + 8) };
}

function serializeApiKey(key: ApiKey) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    createdBy: key.createdBy,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
  };
}

function apiKeyErrorResponse(c: Context, err: unknown) {
  if (err instanceof ApiKeyNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof ApiKeyAlreadyRevokedError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidApiKeyError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/**
 * مفاتيح API (settings §API keys). Gated with `admin.settings.*` — no
 * dedicated permission exists for API-key management, and this IS tenant
 * integration configuration. Security invariants (non-negotiable, see
 * `api-keys/api-key.ts`): only `keyHash` is ever persisted, the plaintext key
 * is returned exactly once (this create response), and `prefix` is the only
 * fragment kept in the clear for list identification.
 */
export function createApiKeysRoutes(
  keys: ApiKeyRepository,
  hasher: SecretHasher,
  resolveAuthContext: AuthContextResolver,
  audit?: AuditSink,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.settings.view"), async (c) => {
    return c.json((await keys.list()).map(serializeApiKey));
  });

  app.post("/", gate("admin.settings.edit"), async (c) => {
    const parsed = createApiKeySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const actor = getAuthContext(c)?.userId ?? "system";
    const { rawKey, prefix } = generateRawKey();
    try {
      const key = await createApiKey(
        {
          id: crypto.randomUUID(),
          name: parsed.data.name,
          scopes: parsed.data.scopes,
          rawKey,
          prefix,
          createdBy: actor,
          createdAt: new Date().toISOString(),
        },
        keys,
        hasher,
      );
      if (audit) {
        await recordSensitiveEvent(audit, {
          module: "api-keys",
          entityType: "API_KEY",
          entityId: key.id,
          action: "CREATED",
          actor,
          severity: "WARNING",
          details: { id: key.id, name: key.name, scopes: key.scopes },
        });
      }
      return c.json({ ...serializeApiKey(key), key: rawKey }, 201);
    } catch (err) {
      return apiKeyErrorResponse(c, err);
    }
  });

  app.post("/:id/revoke", gate("admin.settings.edit"), async (c) => {
    const actor = getAuthContext(c)?.userId ?? "system";
    try {
      const key = await revokeApiKey(c.req.param("id"), keys);
      if (audit) {
        await recordSensitiveEvent(audit, {
          module: "api-keys",
          entityType: "API_KEY",
          entityId: key.id,
          action: "REVOKED",
          actor,
          severity: "WARNING",
          details: { id: key.id, name: key.name },
        });
      }
      return c.json(serializeApiKey(key));
    } catch (err) {
      return apiKeyErrorResponse(c, err);
    }
  });

  return app;
}
