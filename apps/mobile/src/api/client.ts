import type { ZodType } from "zod";
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
  readonly branchScope: string;
  readonly warehouseScope: string;
}

export interface RequestOptions<T> {
  readonly method?: HttpMethod;
  readonly body?: unknown;
  readonly schema?: ZodType<T>;
  readonly signal?: AbortSignal;
}

const REFUSAL_STATUSES = new Set([400, 404, 409, 422]);

function headersFor(credentials: ApiCredentials): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credentials.tenantCode) headers["x-mezan-tenant"] = credentials.tenantCode;
  if (credentials.token) {
    headers.authorization = `Bearer ${credentials.token}`;
    headers["x-branch-scope"] = credentials.branchScope;
    headers["x-warehouse-scope"] = credentials.warehouseScope;
  }
  return headers;
}

async function readRefusal(response: Response): Promise<{ message: string | null; messageEn: string | null; code: string | null }> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      return {
        message: typeof record.message === "string" ? record.message : null,
        messageEn: typeof record.messageEn === "string" ? record.messageEn : null,
        code: typeof record.error === "string" ? record.error : null,
      };
    }
  } catch {
    // A refusal with no JSON body is still a refusal; the caller falls back to a named reason.
  }
  return { message: null, messageEn: null, code: null };
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
    const failure =
      response.status === 401
        ? ApiFailure.Unauthorized
        : response.status === 403
          ? ApiFailure.Forbidden
          : REFUSAL_STATUSES.has(response.status)
            ? ApiFailure.Refused
            : ApiFailure.Server;
    throw new ApiError(failure, response.status, refusal.message, refusal.messageEn, refusal.code);
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
