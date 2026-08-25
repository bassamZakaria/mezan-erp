# Archive — point-in-time documents

These were accurate when written and are kept for their **evidence**, not their
conclusions. Do not read them for current state; read `../STATUS.md`.

| File | What it was | Superseded by |
|---|---|---|
| `tasks-2026-08-23.md` | The per-item build checklist, verified against `main` @ `7b65887`. Its phase breakdown was overtaken within two days — it still describes screens as sample-data-driven that are now API-backed. Its two open design decisions were extracted before it was retired. | `../STATUS.md` for state, `../decisions.md` for the decisions, `../backlog.md` for the per-feature spec |
| `execution-plan-2026-08-23.md` | The parallel build plan: dependency tiers and the W1–W9 wave schedule that sequenced the v1 build. W1–W7 shipped; kept because several source comments cite its wave numbers for why a module is shaped the way it is. | `../STATUS.md` |
| `testing-scenarios.md` | The first pass of business scenarios — 29 lifecycles (S1–S29) taken from the catalog. Superseded by a per-domain set roughly 25× its size, each file paired with an executable suite. | `../scenarios/01..09` |
| `parity-audit-2026-08-23-live.md` | Live side-by-side audit of Mezan vs the reference app, driven click-by-click in a browser. Source of the 58%-parity figure and the register of surfaces that looked real but weren't. | `../STATUS.md` |
| `coverage-audit-2026-08-23-static.md` | The earlier, documentation-derived parity audit. Superseded within a day: it declared live checks unnecessary and consequently missed five dead controls. Kept as the cautionary case for why audits must be live. | the live audit above |
| `tasks-audit.md` | Audited every ✅ in the checklist (now `tasks-2026-08-23.md`) against runtime reality, and found engines marked done that were never mounted. | `../STATUS.md` |
| `digest.md` | Structured digest of `catalog/01..10`, written to feed `plan.md`. | `../catalog/` directly |
