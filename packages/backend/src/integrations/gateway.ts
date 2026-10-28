import { timingSafeEqual } from "node:crypto";
import type { SessionGrant } from "@mezan/api";
import { hashApiKeyToken } from "@mezan/api";
import { ApiKeyStatusDTO, type ApiKeyScopeDTO } from "@mezan/contracts";
import {
  ALL_SCOPE,
  API_KEY_LAST_USED_WRITE_INTERVAL_MS,
  UserStatusCode,
  apiKeyStatus,
  effectiveApiPermissions,
  isErasedUser,
  recordSecurityEventOrFallback,
  resolvePermissions,
  type AuditSink,
  type ParsedApiKeyToken,
  type ScopeSelection,
  type UnitOfWork,
} from "@mezan/domain";
import type { IdempotentRequestStore, IntegrationStore } from "@mezan/persistence";

export interface ApiKeyAuthentication {
  readonly keyId: string;
  readonly keyName: string;
  readonly scopes: readonly ApiKeyScopeDTO[];
  readonly grant: SessionGrant;
}

export interface ApiWriteRecord {
  readonly keyId: string;
  readonly keyName: string;
  readonly actor: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly idempotencyKey: string | null;
  readonly replayed: boolean;
}

export interface IdempotentApiAnswer {
  readonly requestHash: string;
  readonly status: number;
  readonly body: string;
}

/**
 * What the cloud's `/api/v1` gateway calls on a tenant backend. Not an HTTP route: only code that
 * holds the backend handle reaches it, and only a backend built with `integrations` carries one.
 */
export interface IntegrationsGateway {
  readonly tenantCode: string;
  authenticate(token: ParsedApiKeyToken, raw: string): Promise<ApiKeyAuthentication | null>;
  findIdempotent(scope: string, key: string): Promise<IdempotentApiAnswer | null>;
  recordIdempotent(scope: string, key: string, answer: IdempotentApiAnswer): Promise<void>;
  recordWrite(entry: ApiWriteRecord): Promise<void>;
}

export interface UserGrant {
  readonly userId: string;
  readonly permissions: ReadonlySet<string>;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
}

export type Turn = <T>(work: () => Promise<T>) => Promise<T>;

/** The grant the user would be issued at sign-in now, or null when they could not sign in. */
export async function currentUserGrant(uow: UnitOfWork, userId: string): Promise<UserGrant | null> {
  const user = await uow.users.findById(userId);
  if (!user || user.status !== UserStatusCode.Active || isErasedUser(user)) return null;
  let granted: readonly string[] = [];
  if (user.isCompanyAdmin) granted = ["*"];
  else if (user.roleId) granted = (await uow.roles.findById(user.roleId))?.permissions ?? [];
  return { userId: user.id, permissions: resolvePermissions(granted), branchScope: user.branchScope, warehouseScope: user.warehouseScope };
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

const API_MODULE = "admin";
const API_WRITE_ACTION = "integrations.api.write";

export interface IntegrationsGatewayDeps {
  readonly tenantCode: string;
  readonly store: IntegrationStore;
  readonly idempotency: IdempotentRequestStore;
  readonly uow: UnitOfWork;
  readonly audit: AuditSink;
  readonly turn: Turn;
  readonly now: () => Date;
}

export function createIntegrationsGateway(deps: IntegrationsGatewayDeps): IntegrationsGateway {
  return {
    tenantCode: deps.tenantCode,
    authenticate: (token, raw) =>
      deps.turn(async () => {
        if (token.tenantCode !== deps.tenantCode) return null;
        const key = await deps.store.apiKeys.findByLookup(token.lookup);
        if (!key || !sameHash(hashApiKeyToken(raw), key.tokenHash)) return null;
        const at = deps.now();
        if (apiKeyStatus(key, at.toISOString()) !== ApiKeyStatusDTO.Active) return null;
        const owner = await currentUserGrant(deps.uow, key.createdBy);
        if (!owner) return null;
        const permissions = effectiveApiPermissions(key.scopes, owner.permissions);
        if (permissions.length === 0) return null;
        if (key.lastUsedAt === null || at.getTime() - Date.parse(key.lastUsedAt) >= API_KEY_LAST_USED_WRITE_INTERVAL_MS) {
          await deps.store.apiKeys.touch(key.id, at.toISOString());
        }
        return {
          keyId: key.id,
          keyName: key.name,
          scopes: key.scopes,
          grant: {
            userId: owner.userId,
            permissions,
            roleCode: null,
            branchScope: owner.branchScope === ALL_SCOPE ? ALL_SCOPE : [...owner.branchScope],
            warehouseScope: owner.warehouseScope === ALL_SCOPE ? ALL_SCOPE : [...owner.warehouseScope],
          },
        };
      }),
    findIdempotent: (scope, key) => deps.turn(async () => deps.idempotency.find(scope, key)),
    recordIdempotent: (scope, key, answer) =>
      deps.turn(async () => {
        await deps.idempotency.record(scope, key, answer, deps.now().toISOString());
      }),
    recordWrite: (entry) =>
      deps.turn(() =>
        recordSecurityEventOrFallback(deps.audit, {
          module: API_MODULE,
          entityType: "INTEGRATION_API_KEY",
          entityId: entry.keyId,
          action: API_WRITE_ACTION,
          actor: entry.actor,
          severity: "WARNING",
          details: {
            keyName: entry.keyName,
            method: entry.method,
            path: entry.path,
            status: entry.status,
            idempotencyKey: entry.idempotencyKey,
            replayed: entry.replayed,
            origin: "api_key",
          },
        }),
      ),
  };
}
