import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProviders } from "./data/AppProviders";
import "./index.css";

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
