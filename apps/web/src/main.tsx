import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProviders } from "./data/AppProviders";
import { installDesktopErrorReporter } from "./lib/desktop-error-reporter";
import { redirectLegacyHashRoute } from "./router/legacy-hash";
import "./index.css";

// Before the router reads the address: every URL saved while the shell routed
// on the hash still points at `#/…`, and the router would never see it.
redirectLegacyHashRoute();
installDesktopErrorReporter();

// `lang` and `dir` on <html> are stamped by AppI18nProvider from the active
// locale (docs/archive/plan.md §2.1 — direction is derived, never stored). index.html's
// ar/rtl attributes are only the pre-mount default.

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
