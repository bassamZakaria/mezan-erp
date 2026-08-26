# Screen register

Every screen and sub-screen observed during the audit. IDs are stable across
re-runs — reference them from the task list rather than by name.

| ID | Screen | Route | Sub-screens | Controls | Forms |
|---|---|---|---|---|---|
| SCR-001 | Home | `/` | 1 | 6 | 0 |
| SCR-002 | Projects | `/projects` | 4 | 24 | 1 |
| SCR-003 | Billing | `/settings/billing` | 0 | 5 | 1 |

## Sub-screens

Modals, drawers, menus and dropdowns, deduplicated by identity — a dialog
reachable from twenty table rows is listed once.

| ID | Type | Name | Parent | Opened by | Fields | Actions |
|---|---|---|---|---|---|---|
| SCR-001.1 | Menu | Account menu | SCR-001 | ACT-0002 | 0 | Profile, Billing, Log out |
| SCR-002.1 | Modal | Edit project | SCR-002 | ACT-0003 | 2 | Cancel, Save |
| SCR-002.2 | Modal | Create project | SCR-002 | ACT-0005 | 1 | Cancel, Create |
| SCR-002.3 | Dropdown | Owner list | SCR-002 | ACT-0011 | 0 | Ahmed, Sara |
| SCR-002.4 | In-place view | Archived projects | SCR-002 | ACT-0012 | 0 | Restore, Purge |

## Screen detail

### SCR-001 — Home

**Route:** `/`

**Sections:** Dashboard · Recent

**Sub-screens:** SCR-001.1

### SCR-002 — Projects

**Route:** `/projects`

**Sections:** Projects

**Table columns:** Name, Owner, Status, Updated

**Empty-state text detected:** 1 region(s)

**Form — filter:**

| Field | Type | Required | Constraints |
|---|---|---|---|
| Search | search | no | — |
| Status | select | no | 3 options |

**Sub-screens:** SCR-002.1, SCR-002.2, SCR-002.3, SCR-002.4

### SCR-003 — Billing

**Route:** `/settings/billing`

**Sections:** Billing

**Form — card:**

| Field | Type | Required | Constraints |
|---|---|---|---|
| Billing email | email | yes | pattern .+@.+; max 120 |
