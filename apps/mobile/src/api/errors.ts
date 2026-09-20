import type { Strings } from "@/i18n";

export enum ApiFailure {
  Network = "network",
  Unauthorized = "unauthorized",
  Forbidden = "forbidden",
  Refused = "refused",
  Server = "server",
  Shape = "shape",
}

export class ApiError extends Error {
  readonly failure: ApiFailure;
  readonly status: number | null;
  /** The server's own Arabic refusal, when it sent one. Shown in preference to anything this client invents. */
  readonly serverMessage: string | null;
  readonly serverMessageEn: string | null;

  constructor(failure: ApiFailure, status: number | null, serverMessage: string | null, serverMessageEn: string | null) {
    super(serverMessage ?? serverMessageEn ?? failure);
    this.name = "ApiError";
    this.failure = failure;
    this.status = status;
    this.serverMessage = serverMessage;
    this.serverMessageEn = serverMessageEn;
  }
}

export function describeApiError(error: unknown, strings: Strings): string {
  if (!(error instanceof ApiError)) return strings.errors.server;
  if (error.serverMessage) return error.serverMessage;
  switch (error.failure) {
    case ApiFailure.Network:
      return strings.errors.network;
    case ApiFailure.Unauthorized:
      return strings.errors.unauthorized;
    case ApiFailure.Forbidden:
      return strings.errors.forbidden;
    case ApiFailure.Shape:
      return strings.errors.unexpectedShape;
    case ApiFailure.Refused:
    case ApiFailure.Server:
      return error.serverMessageEn ?? strings.errors.server;
  }
}

/**
 * Writes are online-only (no write queue): a network failure on a write is
 * never "try again later", it is "this did not happen". Every mutation
 * screen shows this sentence instead of the generic network message so a
 * rep does not walk away believing a document was saved.
 */
export function describeWriteError(error: unknown, strings: Strings): string {
  if (error instanceof ApiError && error.failure === ApiFailure.Network) return strings.common.offlineWrite;
  return describeApiError(error, strings);
}
