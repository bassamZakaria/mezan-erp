# Output templates

Produce four files. Keep them separate — they have different readers and
different lifespans.

---

## `FEATURE-SPEC.md`

```markdown
# <Product> — Feature Specification
Derived from an automated audit of <baseUrl> on <date>.
All descriptions are original; no markup, styling, assets or copy from the
source are reproduced here.

## 1. Overview
What the product does, in three sentences. Primary user roles observed.
Detected stack hints (from `route.json` → `stack`).

## 2. Navigation map
Routes as a tree, with the primary entry points marked.
Note which routes were reachable only via in-app navigation vs. direct URL.

## 3. Features
### 3.<n> <Feature name>
- **Route(s):** /path
- **Purpose:** one line
- **Entry points:** how the user reaches it
- **UI structure:** regions, key controls
- **Interactions:** each control and what it does
- **Modals / overlays:** heading, fields, actions
- **Data displayed:** entities and fields
- **API calls:** method + path
- **States observed:** empty / populated / loading / error
- **Validation:** rules read from form attributes
- **Verified | Inferred:** and if inferred, from what

## 4. Cross-cutting behaviour
Auth and session handling, permissions, global navigation, notifications,
i18n, responsive behaviour, error handling patterns.

## 5. Coverage
Routes audited vs. discovered. Roles exercised. What was not reached and why.
```

---

## `API-SURFACE.md`

```markdown
# Observed API surface
Inferred from client traffic during audit. Request and response *shapes* only —
no payload data was retained.

## Entities
### <Entity>
| Field | Type | Notes |
Projections: list view returns <fields>; detail view adds <fields>.

## Endpoints
### <METHOD> /api/path/:id
- **Purpose:**
- **Query params:** name — inferred purpose
- **Request shape:**
- **Response shape:**
- **Observed statuses:**
- **Verified | Inferred**

## Not observable
Auth issuance, write payloads (aborted under read-only), rate limits,
websockets, idempotency semantics.
```

---

## `REBUILD-BACKLOG.md`

```markdown
# Rebuild backlog

## Epic: <name>
**Entities:** | **Endpoints:** | **Depends on:**
**Confidence:** high (verified) / medium / low (inferred)

### Story: <name>
As a <role>, I want <capability>, so that <outcome>.
**Acceptance criteria**
- [ ] observable, testable statement
**Notes:** states to handle, validation rules
**Relative size:** S / M / L
**Open questions:** links to OPEN-QUESTIONS.md items

## Suggested sequence
1. ... (dependency order, not screen order)
```

---

## `OPEN-QUESTIONS.md`

```markdown
# Open questions

| # | Question | Why it matters | How to resolve | Blocks |
|---|---|---|---|---|
| 1 | What triggers state X → Y? | Drives the lifecycle model | Manual walkthrough with a test account | Epic 3 |

## Unverified write paths
Detected but deliberately not exercised (read-only mode):
| Feature | Evidence | Assumed behaviour |

## Role coverage gaps
Audited as: <role>. Not audited: <roles>, which likely expose <areas>.
```
