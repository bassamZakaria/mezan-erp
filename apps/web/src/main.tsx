import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProviders } from "./data/AppProviders";
import "./index.css";

// Direction is derived from the active locale, never hardcoded and never read
// from a stored tenant value (docs/plan.md §2.1 — the source app stored a wrong
// "direction": "LTR"). ar => rtl is the v1 default.
document.documentElement.setAttribute("dir", "rtl");
document.documentElement.setAttribute("lang", "ar");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
