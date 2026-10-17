import { useEffect, useRef } from "react";
import { useApi } from "../data/ApiContext";
import { CLIENT_ERRORS_PATH, installClientErrorReporter } from "./client-error-reporter";

const APP_VERSION = (import.meta.env["VITE_MEZAN_VERSION"] as string | undefined) ?? null;

/**
 * Installs the client error reporter for the running app. It sends through the app's own
 * `request`, so a report carries the tenant, the session and the CSRF token exactly as every other
 * call does — over HTTP on the web, over the IPC bridge in the desktop renderer.
 */
export function ClientErrorReporting() {
  const { request } = useApi();
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(
    () =>
      installClientErrorReporter({
        appVersion: APP_VERSION,
        send: async (report) => {
          await requestRef.current(CLIENT_ERRORS_PATH, { method: "POST", body: JSON.stringify(report) });
        },
      }),
    [],
  );

  return null;
}
