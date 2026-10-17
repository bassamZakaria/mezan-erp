import { API_KEY_TOKEN_PREFIX, ApiKeyScopeDTO, ApiKeyStatusDTO } from "@mezan/contracts";
import { WILDCARD_PERMISSION } from "../permissions/catalog.js";

export const API_KEY_LOOKUP_LENGTH = 12;
export const MAX_ACTIVE_API_KEYS = 50;
export const API_KEY_LAST_USED_WRITE_INTERVAL_MS = 60_000;
export const PUBLIC_API_RATE_LIMIT_PER_MINUTE = 120;

export interface ApiScopeDefinition {
  readonly scope: ApiKeyScopeDTO;
  readonly primary: string;
  readonly permissions: readonly string[];
  readonly write: boolean;
}

// SECURITY: a scope maps onto the SAME permission codes the role editor grants. A key never
// carries a code outside this table, and never `*`, whoever created it.
export const API_SCOPE_DEFINITIONS: readonly ApiScopeDefinition[] = [
  { scope: ApiKeyScopeDTO.CustomersRead, primary: "sales.customer.view", permissions: ["sales.customer.view"], write: false },
  { scope: ApiKeyScopeDTO.CustomersWrite, primary: "sales.customer.create", permissions: ["sales.customer.create", "sales.customer.view"], write: true },
  { scope: ApiKeyScopeDTO.SuppliersRead, primary: "purchases.supplier.view", permissions: ["purchases.supplier.view"], write: false },
  { scope: ApiKeyScopeDTO.ItemsRead, primary: "inventory.item.view", permissions: ["inventory.item.view"], write: false },
  { scope: ApiKeyScopeDTO.StockRead, primary: "inventory.stock.view", permissions: ["inventory.stock.view"], write: false },
  {
    scope: ApiKeyScopeDTO.SalesInvoicesRead,
    primary: "sales.invoice.view_own",
    permissions: ["sales.invoice.view", "sales.invoice.view_all", "sales.invoice.view_own"],
    write: false,
  },
  {
    scope: ApiKeyScopeDTO.SalesInvoicesWrite,
    primary: "sales.invoice.create",
    permissions: ["sales.invoice.create", "sales.invoice.view_own", "accounting.tax.view"],
    write: true,
  },
  { scope: ApiKeyScopeDTO.ReceiptsRead, primary: "treasury.cash_voucher.view", permissions: ["treasury.cash_voucher.view"], write: false },
  {
    scope: ApiKeyScopeDTO.ReceiptsWrite,
    primary: "treasury.cash_voucher.create",
    permissions: ["treasury.cash_voucher.create", "treasury.cash_voucher.view"],
    write: true,
  },
  { scope: ApiKeyScopeDTO.PaymentsRead, primary: "treasury.cash_voucher.view", permissions: ["treasury.cash_voucher.view"], write: false },
  { scope: ApiKeyScopeDTO.TrialBalanceRead, primary: "accounting.reports.view", permissions: ["accounting.reports.view"], write: false },
];

const BY_SCOPE: ReadonlyMap<ApiKeyScopeDTO, ApiScopeDefinition> = new Map(API_SCOPE_DEFINITIONS.map((d) => [d.scope, d]));

export function apiScopeDefinition(scope: ApiKeyScopeDTO): ApiScopeDefinition {
  const definition = BY_SCOPE.get(scope);
  if (!definition) throw new RangeError(`Unknown API key scope "${scope}"`);
  return definition;
}

export function isApiKeyScope(value: string): value is ApiKeyScopeDTO {
  return BY_SCOPE.has(value as ApiKeyScopeDTO);
}

function holds(granted: ReadonlySet<string>, code: string): boolean {
  return granted.has(WILDCARD_PERMISSION) || granted.has(code);
}

export function scopeGrantable(scope: ApiKeyScopeDTO, granted: ReadonlySet<string>): boolean {
  return holds(granted, apiScopeDefinition(scope).primary);
}

export function scopesBeyondGrant(scopes: readonly ApiKeyScopeDTO[], granted: ReadonlySet<string>): ApiKeyScopeDTO[] {
  return scopes.filter((scope) => !scopeGrantable(scope, granted));
}

/** The permission codes a key may exercise NOW: its scopes' codes, each one still held by its creator. */
export function effectiveApiPermissions(scopes: readonly ApiKeyScopeDTO[], granted: ReadonlySet<string>): string[] {
  const codes = new Set<string>();
  for (const scope of scopes) {
    if (!isApiKeyScope(scope)) continue;
    for (const code of apiScopeDefinition(scope).permissions) if (holds(granted, code)) codes.add(code);
  }
  codes.delete(WILDCARD_PERMISSION);
  return [...codes];
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly name: string;
  readonly lookup: string;
  readonly tokenHash: string;
  readonly scopes: readonly ApiKeyScopeDTO[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
}

export function apiKeyStatus(key: Pick<ApiKeyRecord, "revokedAt" | "expiresAt">, nowIso: string): ApiKeyStatusDTO {
  if (key.revokedAt !== null) return ApiKeyStatusDTO.Revoked;
  if (key.expiresAt !== null && Date.parse(key.expiresAt) <= Date.parse(nowIso)) return ApiKeyStatusDTO.Expired;
  return ApiKeyStatusDTO.Active;
}

export interface ParsedApiKeyToken {
  readonly tenantCode: string;
  readonly lookup: string;
  readonly secret: string;
}

const TOKEN_PATTERN = /^mzn_([a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9]))_([0-9a-f]{12})_([A-Za-z0-9_-]{40,64})$/;

export function formatApiKeyToken(parts: ParsedApiKeyToken): string {
  return `${API_KEY_TOKEN_PREFIX}${parts.tenantCode}_${parts.lookup}_${parts.secret}`;
}

export function parseApiKeyToken(token: string): ParsedApiKeyToken | null {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  return { tenantCode: match[1]!, lookup: match[2]!, secret: match[3]! };
}

export function looksLikeApiKeyToken(token: string): boolean {
  return token.startsWith(API_KEY_TOKEN_PREFIX);
}

export function apiKeyDisplayPrefix(tenantCode: string, lookup: string): string {
  return `${API_KEY_TOKEN_PREFIX}${tenantCode}_${lookup}`;
}
