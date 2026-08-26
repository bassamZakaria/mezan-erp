# BA / PO deliverables

The registers from `inventory.mjs` give you screens, sub-screens and actions
mechanically. This document covers the four things that require judgement:
workflows, business rules, the task list, and the questions you still have to
ask a human.

## Contents

1. What an audit gives you, and what it cannot
2. Reconstructing workflows
3. Extracting business rules
4. Writing the task list
5. Turning gaps into a workshop agenda
6. Output templates

---

## 1. What an audit gives you, and what it cannot

Be clear with the user about this, once, before they plan a roadmap against the
output. An exhaustive crawl produces an excellent inventory of **what exists**.
A business analyst and a product owner in a room produce something different:
**why it exists, what it is worth, and what it must never do.**

| Available from the audit | Only available from people |
|---|---|
| Every screen, sub-screen, control | Why the feature was built |
| Navigation edges and reachability | Which flows are actually used |
| Form fields and client-side validation | Server-side rules and invariants |
| Observed API contract | Business logic behind the endpoints |
| UI states that happened to render | States requiring specific data or dates |
| That a feature exists | Whether it matters, and to whom |

The consequence for the task list: it will be complete on scope and blind on
priority. Do not silently invent priorities to fill the column. Mark them
`TBD — needs PO input` and put the question in the workshop agenda. A backlog
that is honest about missing priority is usable; one with invented priority is
worse than none, because someone will sequence a quarter against it.

Two structural blind spots worth naming explicitly in every handover:

- **Role scope.** One session state audits one permission tier. Screens gated
  behind roles you did not hold do not appear as gaps — the crawler never saw a
  door to knock on.
- **Write paths.** Under read-only mode, multi-step flows that create or modify
  data are observed only up to the first write. You will see the form and the
  submit button; you will not see the confirmation screen, the resulting state,
  or the validation the server applies.

---

## 2. Reconstructing workflows

`NAVIGATION.md` gives reachability. A workflow is a *purposeful path* through
that graph, and inferring it is the analytical core of this whole exercise.

Build them from three signals:

**Entity lifecycle.** Group screens and actions by the entity they touch. For
each entity, look for the CRUD quartet: a list screen, a create affordance, a
detail or edit sub-screen, a destructive action. That quartet is a workflow even
when no single crawl path walked it end to end.

**Sub-screen action names.** A dialog whose actions are `Cancel / Save` is a
terminal step. One whose actions are `Back / Next` or `Continue` is a wizard —
and a wizard is a multi-step workflow whose later steps the crawl almost
certainly never reached. Flag every one of these as partially observed.

**Endpoint semantics.** `GET /api/orders/:id/invoice` implies an invoicing flow
even if no button in the register points at it. Endpoints without a
corresponding action are strong evidence of a screen you did not reach.

Write each workflow as an ordered sequence of `SCR-xxx` / `ACT-xxxx` references,
with the inferred steps marked. If more than about a third of a workflow's steps
are inferred, say so at the top of that workflow rather than burying it per-step.

**Cover the unhappy paths.** For each workflow, note what the audit could and
could not tell you about: validation failure, permission denial, empty state,
concurrent edit, network failure. Almost all of these will be unobserved. Listing
them as unobserved is itself valuable — it is the list of things a rebuild will
otherwise discover in QA.

---

## 3. Extracting business rules

Three sources, in descending order of reliability:

1. **Form attributes** (`required`, `pattern`, `maxLength`, `<select>` options) —
   these are facts. Carry them across as constraints verbatim.
2. **Enum values** observed in API responses and filter dropdowns — reliable for
   the value set, silent on which transitions between them are legal.
3. **Disabled controls** — a control disabled in one context and enabled in
   another encodes a rule. Note the difference and infer the condition, marked as
   inferred.

Never promote an inference to a rule. "Status can be Active, Archived or Draft"
is observed. "A Draft project cannot be archived directly" is a hypothesis, and
belongs in the workshop agenda.

---

## 4. Writing the task list

Every task traces to at least one screen or action ID. That traceability is what
makes the list defensible when someone asks where a requirement came from, and
what makes a re-run diffable against the last audit.

Structure by entity and capability, not by screen. A screen-shaped backlog
duplicates backend work across tasks and hides shared components.

Each task needs:

- A user-story statement with a real role, not "as a user"
- Acceptance criteria that are observable and testable
- The screen and action IDs it implements
- Endpoints it depends on
- **Confidence**: `Observed` / `Partially observed` / `Inferred`
- Relative size, not hours — estimating hours from observation is false precision
- Open questions blocking it

Sequence by dependency: authentication, then core entity CRUD, then dependent
features, then the flows you could only infer (they will need discovery time).

---

## 5. Turning gaps into a workshop agenda

This is the highest-value output and the easiest to skip. `COVERAGE.md` plus your
inferred workflows constitute a precise list of what a human still needs to
answer — which is exactly the agenda for the meeting the user wishes they had had
in the first place.

Group questions by who can answer them:

- **Product owner** — priority, intent, which flows matter, what is deprecated
- **Business analyst / ops** — rules, edge cases, why a state exists
- **Engineering** — server-side validation, integrations, non-functional limits
- **Design** — states you never saw rendered, responsive behaviour

Order them so the ones blocking the earliest tasks come first. Half a day of
someone's time against a sharp list of forty questions will produce more usable
requirements than a week of unfocused workshops.

---

## 6. Output templates

### `WORKFLOWS.md`

```markdown
# Workflows

## WF-01 — <name>
**Entity:** | **Actor:** | **Confidence:** Observed / Partially observed / Inferred
**Trigger:** what starts it

| # | Screen | Action | What happens | Observed? |
|---|---|---|---|---|
| 1 | SCR-002 | ACT-0005 | Opens the create dialog | ✓ |
| 2 | SCR-002.2 | — | User completes name field | ✓ |
| 3 | — | — | Submits; assumed POST /api/projects | inferred |

**Unhappy paths:** validation / permission / empty / conflict — state observed or not
**Open questions:** OQ-xx
```

### `TASKS.md`

```markdown
# Task list

## Epic <n> — <name>
**Entities:** | **Depends on:** | **Confidence:**

### T-<n>.<n> — <title>
As a <role>, I want <capability>, so that <outcome>.

**Acceptance criteria**
- [ ] observable statement
- [ ] state handling: empty / loading / error / permission

**Traces to:** SCR-002, SCR-002.1, ACT-0003
**Endpoints:** GET /api/projects/:id
**Confidence:** Observed
**Size:** M
**Priority:** TBD — needs PO input
**Open questions:** OQ-04
```

### `QUESTIONS-FOR-STAKEHOLDERS.md`

```markdown
# Stakeholder questions

## For the product owner
| # | Question | Why it matters | Blocks |
|---|---|---|---|
| OQ-01 | Which of these flows are actually used? | Sequencing; possible scope cut | Epics 3–5 |

## For business / operations
## For engineering
## For design

## Unaudited surface
Audited as role: <role>. Not audited: <roles> — likely exposing <areas>.
Write paths not exercised: <list from ACTIONS.md unverified table>.
```
