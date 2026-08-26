# Synthesis guide

How to turn the crawl artifacts into something a team can build from. The crawler
produces observations; this step produces understanding, and the gap between them
is entirely judgement.

## Contents

1. Working order
2. Deriving the data model
3. Deriving the API contract
4. Classifying interactions
5. Inferring what you could not observe
6. Sizing the rebuild
7. Quality bar

---

## 1. Working order

Do not start at route one and write linearly. Build the shared understanding
first, because it changes how you describe everything else.

1. **`manifest.json`** — route inventory and coverage stats. Note which routes
   had high control counts; those are the product, the rest is usually chrome.
2. **`api-surface.json`** — read it whole, before any route detail. The endpoint
   list tells you the domain model faster than the UI does, and once you know the
   entities, every route becomes "the CRUD surface for X" rather than a pile of
   buttons.
3. **Route detail**, grouped by area rather than alphabetically. `/settings/*`
   together, `/projects/*` together.
4. **`blocked-mutations.json`** last, as a checklist of what you inferred rather
   than saw.

## 2. Deriving the data model

Response shapes repeated across routes are your entities. Collapse them:

If `/api/projects` returns `{items: [{id, name, ownerId, status, createdAt}]}`
and `/api/projects/:id` returns `{id, name, ownerId, status, createdAt, members: [...]}`,
you have one `Project` entity with a list projection and a detail projection —
not two things. Spec the entity once, then note which fields each view needs.
That distinction drives real API design in the rebuild.

Watch for:

- **Enums** — a `status` field whose values you see repeated across responses.
  The UI filter dropdowns in `route.json` usually enumerate them completely.
- **Relationships** — `ownerId`, `projectId`, and nested arrays give you
  cardinality without any schema access.
- **Denormalisation** — the same entity embedded with different field subsets in
  different responses tells you what their read model looks like, which is a hint
  about performance constraints you may inherit.

## 3. Deriving the API contract

For each endpoint record: method, templatised path, query parameters, request
shape, response shape, observed status codes.

`query` keys on list endpoints are the most underrated output of the whole run.
`?page=&limit=&sort=&status=&q=` is a complete pagination, sorting, filtering and
search contract that would otherwise take a day of manual poking to establish.

Flag but do not guess:

- Auth scheme — you can see whether a bearer token or cookie is in play, not how
  it is issued
- Write payloads — in read-only mode these were aborted before sending, so any
  `requestShape` for a mutation is absent. Infer from the form fields in
  `route.json` and label it as inferred.
- Rate limits, idempotency behaviour, websocket protocols — usually invisible

## 4. Classifying interactions

Every entry in `interactions.json` falls into one of these. The classification
determines whether it belongs in the spec as a feature or a note:

| Observation | Meaning | Spec as |
|---|---|---|
| `opened` has a `role: dialog` | modal flow | a feature, with its fields and actions |
| `opened` has `role: menu` / `listbox` | dropdown | UI affordance; list its options |
| `navigatedTo` set | routing | an edge in the navigation map |
| network call, no visual change | background fetch | an API interaction |
| nothing happened | client-side state | UI behaviour, one line |
| `clicked: false`, destructive | write path exists | a feature, marked unverified |
| `error` set | selector went stale or control was covered | a coverage gap |

Deduplicate aggressively. Twenty row-level "Edit" buttons are one feature, not
twenty. Dedupe by the overlay's `heading` rather than by selector.

## 5. Inferring what you could not observe

You will always be inferring some of the spec. The rule is that inference is
allowed, and disguising it is not. Mark every inferred line explicitly.

Typical inference chains that are sound:

- A "Delete" button next to each row + a `GET /api/items/:id` → a
  `DELETE /api/items/:id` almost certainly exists
- A form with `email` and `role` fields + a members list → an invite flow with
  role assignment
- A `status` filter with four options → a four-state lifecycle, though the
  transitions between them are guesswork until someone verifies

Keep an explicit `OPEN-QUESTIONS.md`. Anything a developer would have to guess at
during implementation goes there. A twenty-item open-questions list is a sign of
a good audit, not a bad one.

## 6. Sizing the rebuild

Group features into epics along entity boundaries, not screen boundaries — a
rebuild organised by screen will duplicate backend work across epics.

For each epic note: the entities it needs, the endpoints it needs, the UI states
observed (empty, populated, loading, error), and whether the audit verified it or
inferred it. Sequence by dependency: auth and the core entity CRUD first, then
the features that hang off them.

Resist estimating in hours from a spec built on observation. Estimate in relative
size and flag the inferred parts as carrying variance.

## 7. Quality bar

Before delivering, check:

- Could a developer who has never seen the target build the feature from your
  description alone?
- Is every inferred claim marked as inferred?
- Is the coverage gap section honest and specific — named routes and roles, not
  "some areas were not covered"?
- Is the spec written in your own words throughout, with no copied markup, copy
  text, or assets?
- Are entities described once, or repeated across five route sections?
