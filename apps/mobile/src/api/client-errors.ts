import Constants from "expo-constants";
import { ClientErrorKindDTO, ClientErrorPlatformDTO, type ClientErrorReportDTO } from "@mezan/contracts";
import { HttpMethod, apiRequest, type ApiCredentials } from "./client";

const CLIENT_ERRORS_PATH = "/client-errors";
const REPEAT_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_RUN = 20;
const STACK_LINES = 30;

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsShape {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}

function errorUtils(): ErrorUtilsShape | undefined {
  return (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : String(error);
}

function stackOf(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  return error.stack.split("\n").slice(0, STACK_LINES).join("\n");
}

/**
 * Hooks React Native's global JS error handler and posts each error to the tenant's
 * `POST /client-errors`, then hands it on to the handler that was there before (the red box in
 * development, the crash in a release build). SECURITY: a report carries the message, the trimmed
 * stack, the screen and the app version only. Reporting never throws.
 */
export function installMobileErrorReporter(credentialsOf: () => ApiCredentials | null, routeOf: () => string | null = () => null): () => void {
  const utils = errorUtils();
  if (!utils) return () => undefined;
  const previous = utils.getGlobalHandler();
  const lastSent = new Map<string, number>();
  let sent = 0;

  const report = (error: unknown, isFatal?: boolean): void => {
    try {
      const credentials = credentialsOf();
      if (!credentials || !credentials.baseUrl || sent >= MAX_REPORTS_PER_RUN) return;
      const message = messageOf(error);
      const stack = stackOf(error);
      const fingerprint = `${message}|${stack?.split("\n")[1] ?? ""}`;
      const now = Date.now();
      const last = lastSent.get(fingerprint);
      if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
      lastSent.set(fingerprint, now);
      sent += 1;
      const body: ClientErrorReportDTO = {
        platform: ClientErrorPlatformDTO.Mobile,
        kind: isFatal ? ClientErrorKindDTO.FatalJsError : ClientErrorKindDTO.JsError,
        message: message || "unknown error",
        stack,
        route: routeOf(),
        appVersion: Constants.expoConfig?.version ?? null,
        userAgent: null,
        requestId: null,
      };
      void apiRequest(credentials, CLIENT_ERRORS_PATH, { method: HttpMethod.Post, body }).catch(() => undefined);
    } catch {
      // INVARIANT: the error reporter must never become a second error.
    }
  };

  utils.setGlobalHandler((error, isFatal) => {
    report(error, isFatal);
    previous(error, isFatal);
  });
  return () => utils.setGlobalHandler(previous);
}
