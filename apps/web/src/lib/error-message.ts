import { ApiError } from "../data/hooks";
import { ServerUnreachableError } from "../data/transport";

/**
 * Only an `ApiError` or a `ServerUnreachableError` carries text a person should
 * read; its message is already in the page's language (ApiError is built from
 * the server's `message`/`messageEn`). Anything else is internal and gets the
 * caller's own fallback, so `TypeError: Failed to fetch` never reaches a screen.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if ((err instanceof ApiError || err instanceof ServerUnreachableError) && err.message.trim() !== "") return err.message;
  return fallback;
}
