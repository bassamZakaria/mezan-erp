import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { EnvironmentBadge } from "./EnvironmentBadge";
import { AppProviders } from "./data/AppProviders";
import { redirectLegacyHashRoute } from "./router/legacy-hash";
import { ClientErrorReporting } from "./observability/ClientErrorReporting";
import { installClientErrorReporter } from "./observability/client-error-reporter";
import "./index.css";

// Before the router reads the address: every URL saved while the shell routed
// on the hash still points at `#/…`, and the router would never see it.
redirectLegacyHashRoute();
installClientErrorReporter({ appVersion: (import.meta.env["VITE_MEZAN_VERSION"] as string | undefined) ?? null });

// `lang` and `dir` on <html> are stamped by AppI18nProvider from the active
// locale (docs/archive/plan.md §2.1 — direction is derived, never stored). index.html's
// ar/rtl attributes are only the pre-mount default.

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <AppProviders>
      <ClientErrorReporting />
      <App />
      <EnvironmentBadge />
    </AppProviders>
  </StrictMode>,
);
