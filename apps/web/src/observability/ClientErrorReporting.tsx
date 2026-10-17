import { useEffect } from "react";
import { useApi } from "../data/ApiContext";
import { CLIENT_ERRORS_PATH, setClientErrorSend } from "./client-error-reporter";

const PLATFORM_CONSOLE_PATH = "/platform";

/**
 * Points the client error reporter at the app's own `request`, so a report carries the tenant,
 * the session and the CSRF token exactly as every other call does — over HTTP on the web, over the
 * IPC bridge in the desktop renderer.
 */
export function ClientErrorReporting() {
  const { request } = useApi();

  useEffect(() => {
    setClientErrorSend(async (report) => {
      if (report.route?.startsWith(PLATFORM_CONSOLE_PATH)) return;
      await request(CLIENT_ERRORS_PATH, { method: "POST", body: JSON.stringify(report) });
    });
    return () => setClientErrorSend(null);
  }, [request]);

  return null;
}
