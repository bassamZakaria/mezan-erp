# Action catalogue

Every interactive control observed, with what it did. `Instances` counts
repeated occurrences collapsed into one entry (e.g. a per-row Edit button).

| ID | Screen | Control | Type | Depth | Effect | API calls | Instances | Verified |
|---|---|---|---|---|---|---|---|---|
| ACT-0001 | SCR-001 | Projects | Button | 0 | Navigates to SCR-002 | — | 1 | ✓ |
| ACT-0002 | SCR-001 | Account | Menu trigger | 0 | Opens SCR-001.1 | — | 1 | ✓ |
| ACT-0003 | SCR-002 | Edit | Button | 0 | Opens SCR-002.1 | GET /api/projects/:id | 2 | ✓ |
| ACT-0004 | SCR-002 | Delete project | Button | 0 | Not exercised (write path) | — | 1 | — |
| ACT-0005 | SCR-002 | New project | Button | 0 | Opens SCR-002.2 | — | 1 | ✓ |
| ACT-0006 | SCR-002 | Export | Button | 0 | Disabled | — | 1 | — |
| ACT-0007 | SCR-002 | Status | Select | 0 | Background request | GET /api/projects | 1 | ✓ |
| ACT-0008 | SCR-002 | Archive view | Tab | 0 | Navigates to /projects/archive | — | 1 | ✓ |
| ACT-0009 | SCR-002 | Broken thing | Button | 0 | Interaction failed | — | 1 | — |
| ACT-0010 | SCR-002 | Save | Button | 1 | Not exercised (write path) | — | 1 | — |
| ACT-0011 | SCR-002 | Assign owner | Button | 1 | Opens SCR-002.3 | GET /api/users | 1 | ✓ |
| ACT-0012 | SCR-002 | Archived | Tab | 0 | Reveals SCR-002.4 | GET /api/projects?status=archived | 1 | ✓ |

## Unverified actions

These exist in the UI but were not exercised — write paths blocked by
read-only mode, disabled controls, or failed interactions. Each is still a
feature; its behaviour is inferred rather than observed.

| ID | Screen | Control | Reason |
|---|---|---|---|
| ACT-0004 | SCR-002 | Delete project | Not exercised (write path) |
| ACT-0006 | SCR-002 | Export | Disabled |
| ACT-0009 | SCR-002 | Broken thing | Interaction failed |
| ACT-0010 | SCR-002 | Save | Not exercised (write path) |