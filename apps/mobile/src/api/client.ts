import type { ZodType, ZodTypeDef } from "zod";
import { DEVICE_BINDING_HEADER, DEVICE_SECRET_HEADER } from "@mezan/contracts";
import { ApiError, ApiFailure } from "./errors";

export enum HttpMethod {
  Get = "GET",
  Post = "POST",
  Put = "PUT",
  Delete = "DELETE",
}

export enum ScopeAll {
  Every = "*",
}

export interface ApiCredentials {
  readonly baseUrl: string;
  readonly tenantCode: string | null;
  readonly token: string | null;
  readonly deviceSecret?: string | null;
  readonly bindDevice?: boolean;
  readonly branchScope: string;
  readonly warehouseScope: string;
}

export interface RequestOptions<T> {
  readonly method?: HttpMethod;
  readonly body?: unknown;
  readonly schema?: ZodType<T, ZodTypeDef, unknown>;
  readonly signal?: AbortSignal;
}

const REFUSAL_STATUSES = new Set([400, 404, 409, 422]);
const FAILURE_BY_STATUS: Readonly<Record<number, ApiFailure>> = {
  401: ApiFailure.Unauthorized,
  403: ApiFailure.Forbidden,
  423: ApiFailure.Locked,
  429: ApiFailure.Throttled,
  503: ApiFailure.Unavailable,
};

function wholeSeconds(value: unknown): number | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+(\.\d+)?\s*$/.test(value) ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

function headersFor(credentials: ApiCredentials): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credentials.tenantCode) headers["x-mezan-tenant"] = credentials.tenantCode;
  if (credentials.bindDevice) headers[DEVICE_BINDING_HEADER] = "1";
  if (credentials.token) {
    headers.authorization = `Bearer ${credentials.token}`;
    if (credentials.deviceSecret) headers[DEVICE_SECRET_HEADER] = credentials.deviceSecret;
    headers["x-branch-scope"] = credentials.branchScope;
    headers["x-warehouse-scope"] = credentials.warehouseScope;
  }
  return headers;
}

interface Refusal {
  readonly message: string | null;
  readonly messageEn: string | null;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
  readonly unlockByCode: boolean;
  readonly recalculatedGrandTotal: string | null;
}

function recalculatedGrandTotalOf(record: Record<string, unknown>): string | null {
  if (record.taxRecalculated !== true || !record.totals || typeof record.totals !== "object") return null;
  const grandTotal = (record.totals as Record<string, unknown>).grandTotal;
  return typeof grandTotal === "string" ? grandTotal : null;
}

async function readRefusal(response: Response): Promise<Refusal> {
  const waitInHeader = wholeSeconds(response.headers.get("retry-after"));
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      return {
        message: typeof record.message === "string" ? record.message : null,
        messageEn: typeof record.messageEn === "string" ? record.messageEn : null,
        code: typeof record.error === "string" ? record.error : null,
        retryAfterSeconds: wholeSeconds(record.retryAfterSeconds) ?? waitInHeader,
        unlockByCode: record.unlockByCode === true,
        recalculatedGrandTotal: recalculatedGrandTotalOf(record),
      };
    }
  } catch {
    // A refusal with no JSON body is still a refusal; the caller falls back to a named reason.
  }
  return { message: null, messageEn: null, code: null, retryAfterSeconds: waitInHeader, unlockByCode: false, recalculatedGrandTotal: null };
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function apiRequest<T>(
  credentials: ApiCredentials,
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(joinUrl(credentials.baseUrl, path), {
      method: options.method ?? HttpMethod.Get,
      headers: headersFor(credentials),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(ApiFailure.Network, null, null, null);
  }

  if (!response.ok) {
    const refusal = await readRefusal(response);
    const failure = FAILURE_BY_STATUS[response.status] ?? (REFUSAL_STATUSES.has(response.status) ? ApiFailure.Refused : ApiFailure.Server);
    throw new ApiError(failure, response.status, refusal.message, refusal.messageEn, refusal.code, {
      retryAfterSeconds: refusal.retryAfterSeconds,
      unlockByCode: refusal.unlockByCode,
      recalculatedGrandTotal: refusal.recalculatedGrandTotal,
    });
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(ApiFailure.Shape, response.status, null, null);
  }

  if (!options.schema) return payload as T;
  const parsed = options.schema.safeParse(payload);
  if (!parsed.success) throw new ApiError(ApiFailure.Shape, response.status, null, null);
  return parsed.data;
}
