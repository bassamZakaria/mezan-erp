# Coverage report

**Target:** https://demo.example.com
**Screens:** 3
**Sub-screens:** 5
**Actions:** 12
**Verified actions:** 8 of 12
**API endpoints:** 7

## Gaps

- **route-failed:** 1
- **unexercised-action:** 2
- **unmapped-destination:** 1
- **interaction-error:** 1

| Type | Reference | Detail |
|---|---|---|
| route-failed | /broken | timeout |
| unexercised-action | SCR-002 · Delete project | side-effecting label — recorded, not clicked |
| unmapped-destination | SCR-002 · Archive view | /projects/archive |
| interaction-error | SCR-002 · Broken thing | locator timeout |
| unexercised-action | SCR-002 · Save | side-effecting label — recorded, not clicked |

## Discovered but never swept

Reached by clicking, but `maxRoutes` was hit first. These are real screens
that are entirely absent from the registers above.

- `/projects/archive`
- `/invoices`

## Routes truncated by interaction budget

`maxInteractionsPerRoute` was exhausted before the queue emptied, so some
controls on these screens were never tried.

| Screen | Controls left in queue |
|---|---|
| `/projects` | 14 |

## Read this before planning against the output

Coverage is bounded by the account used. One session state audits one role;
anything gated behind a permission tier you did not hold is absent from these
registers and will not appear as a gap, because the crawler never saw a door
to knock on. State the audited role explicitly when handing this over.