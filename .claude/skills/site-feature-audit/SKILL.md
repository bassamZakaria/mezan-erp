---
name: site-feature-audit
description: Systematically audit a live web application — every route, control, dropdown, modal, drawer, form and API call — and synthesise the findings into a feature specification, API surface inventory and rebuild backlog. Use this skill whenever the user wants to reverse-engineer, map, inventory, spec out, or reproduce an existing website or web app, including phrasings like "audit this site", "map every feature", "click through everything", "figure out what this app does", "competitive teardown", "I want to rebuild/clone this", "document the feature set of X", or when they hand over a URL and ask what it would take to build something equivalent. Also use it when planning a rewrite or migration of a legacy app the user already owns.
---

# Site Feature Audit

Turn a running web app into a written specification you can build from.

The naive approach — pointing a browser agent at a site and telling it to click
everything — fails at scale. It is non-deterministic, spends its budget on
navigation rather than analysis, and, critically, cannot tell you what it
*didn't* see. This skill splits the job in two:

1. **A deterministic crawler** (`scripts/crawl.mjs`) walks the app as a state
   machine and writes structured artifacts. Reproducible, cheap, and it reports
   its own coverage gaps.
2. **You** read those artifacts and write the spec. Judgement is where the model
   earns its keep; clicking is not.

## Before touching a third-party target

Read `references/operating-rules.md` first if the target is not owned by the
user. It covers the read-only guarantee, robots/ToS posture, and — the one that
actually changes the output — the difference between specifying behaviour and
copying expression. Do not skip it and do not soften it.

The short version, so it is in context regardless:

- **Read-only is the default and stays on** unless the user owns the target and
  says otherwise. The crawler enforces it at the network layer.
- **Never build in evasion.** If the target returns 403/429 or presents a
  CAPTCHA, stop and report it. Do not rotate user agents, add proxies, solve
  challenges, or slow-walk around rate limits. A blocked audit is a finding, not
  a problem to route around.
- **Specify behaviour, never transcribe expression.** The deliverable describes
  what the app does and how it is structured. It does not carry over their
  markup, CSS, asset files, or body copy. Short control labels ("Save draft")
  are fine as identifiers; paragraphs of their text are not.

## Workflow

### 1. Scope the run with the user

Get these before crawling — guessing wastes a long run:

- Base URL, and whether any part requires auth
- Whether they own the target (changes the read-only default)
- Which areas matter (marketing pages? the authed product? admin?)
- Depth: a 10-route smoke pass or a 100-route full sweep

If auth is needed, do **not** ask for or handle their password. Have the user log
in once themselves and export session state:

```bash
npx playwright open --save-storage=auth.json https://target.example.com
```

Then set `storageStatePath: "auth.json"` in the config. Warn them that the audit
will be scoped to whatever that account can see — a single-role crawl silently
produces a single-role spec, which is the most common way these audits end up
wrong.

### 2. Configure

Copy `scripts/config.example.json`, adjust, and show the user the config before
running. `references/crawler-config.md` documents every option and the tuning
that actually matters (`maxRoutes`, `interactionDepth`,
`destructiveLabelPatterns`, `excludePatterns`).

Sanity-check the estimate out loud: roughly
`maxRoutes × maxInteractionsPerRoute × (settleMs + politenessDelayMs + ~1.5s)`.
Forty routes at sixty controls each is several hours. Propose a narrow pilot run
first — one or two representative routes — and widen once the output looks right.

### 3. Run

```bash
cd scripts && npm install && node crawl.mjs --config ./audit.config.json
```

Watch the first few routes of output. If control counts are near zero, the app
probably renders behind a loading state — raise `settleMs` or add a
`waitForSelector` before widening the run.

### 4. Generate the inventory

```bash
node inventory.mjs --input ../audit-output
```

This emits `SCREENS.md`, `ACTIONS.md`, `NAVIGATION.md`, `COVERAGE.md` and
`inventory.json` — the screen register, sub-screen register, action catalogue and
navigation graph, with stable IDs (`SCR-001`, `SCR-002.1`, `ACT-0004`).

Generating these in code rather than by hand is deliberate: IDs stay stable
across re-runs so a task list remains traceable when the target changes, repeated
row-level controls collapse automatically, and you cannot accidentally invent a
screen that was never observed.

### 5. Synthesise

This is the part that requires you rather than the script. Read
`references/synthesis-guide.md` for the technical spec and
`references/ba-deliverables.md` for the workflow, task list and stakeholder
question outputs. `references/spec-template.md` holds the developer-facing
templates.

Order of operations:

1. Read `manifest.json` — route list, coverage stats, config actually used.
2. Work route by route. For each: `route.json` (structure, forms, headings),
   `interactions.json` (what each control did), `network.json` (what it called).
   Screenshots are there when the JSON is ambiguous; look at them rather than
   guessing.
3. Read `api-surface.json` whole. Deduped endpoints with request/response
   *shapes* — this is most of a backend contract and the highest-value artifact
   in the run.
4. Read `blocked-mutations.json`. Every entry is a write path that exists and was
   deliberately not exercised. These are features you must infer and flag as
   unverified, not features that are absent.
5. Write the deliverables. Which set depends on the audience — ask if unclear:
   - **Developer-facing** (`references/spec-template.md`): `FEATURE-SPEC.md`,
     `API-SURFACE.md`, `REBUILD-BACKLOG.md`, `OPEN-QUESTIONS.md`
   - **BA / PO-facing** (`references/ba-deliverables.md`): `WORKFLOWS.md`,
     `TASKS.md`, `QUESTIONS-FOR-STAKEHOLDERS.md`, alongside the generated
     registers

   When someone asks for "everything a business and product owner meeting would
   produce", they want the second set — and they need to hear that an audit
   supplies scope but not intent. See section 1 of `ba-deliverables.md`.

### 6. Report coverage honestly

Close with what was *not* covered: routes behind roles you didn't have, flows
gated by writes, anything that 403'd, and states that need seed data to appear. A
spec that hides its gaps is worse than a short one, because someone will plan a
sprint against it.

## Reading the artifacts

```
audit-output/
  manifest.json            run config, route list, coverage stats
  api-surface.json         deduped endpoints, request/response shapes
  blocked-mutations.json   write paths detected but not exercised
  routes/<slug>/
    route.json             title, headings, landmarks, forms, tables, stack hints
    interactions.json      every control: clicked or skipped, and what happened
    network.json           calls attributable to that route
    screenshots/           route.png plus one per state-changing interaction
  inventory/               generated by inventory.mjs
    SCREENS.md             screen + sub-screen registers, form fields per screen
    ACTIONS.md             every control, its effect, its API calls, verified or not
    NAVIGATION.md          mermaid graph of observed edges; orphaned screens
    COVERAGE.md            counts and an itemised gap list
    inventory.json         the same data, for programmatic use
```

Two fields carry more signal than the rest:

**`interactions[].opened`** — the overlays a click produced, detected by diffing
portal roots and ARIA overlay roles before and after. Each entry carries the
dialog's heading, its fields, and its action buttons. This is your modal and menu
inventory; it is the thing manual audits miss most often.

**`interactions[].revealed`** — content that changed *in place* with no overlay
and no navigation: tab panels, accordions, filter results. Detected by comparing
a content signature before and after the click. Without this a tab reads as a
dead button, which on a tabbed line-of-business app silently loses most of the
product.

**`interactions[].depth`** — `0` for controls on the route itself, `1` for
controls found inside a modal or revealed panel. Depth-1 entries carry a `path`,
the click sequence needed to reach them. Set `interactionDepth: 2` to collect
them; at `1` the crawler describes overlay interiors without entering them.

**`network[].responseShape`** — key names and value *types*, never values. Enough
to derive the data model, without hoovering up the target's actual content.

## Interpreting what you find

- **A control that opens nothing and calls nothing** is usually client-side
  state (a tab, a filter, a sort). Record it as UI behaviour, not a feature.
- **A `GET` that returns a large array right after page load** is a list view;
  its `query` keys give you the pagination, sort, and filter contract for free.
- **Repeated response shapes across routes** reveal shared entities. Name them in
  the data model rather than describing the same object five times.
- **Form field attributes** (`required`, `pattern`, `maxLength`) are the
  validation rules. Carry them into the spec verbatim as constraints — they are
  facts about the contract, not expression.
- **Skipped destructive controls** still tell you a feature exists. "Delete
  project — exists, behaviour not verified" is a legitimate and useful spec line.

## Failure modes to expect

| Symptom | Cause | Fix |
|---|---|---|
| Almost no controls found | SPA still loading | raise `settleMs`; add a wait selector |
| Every route is the login page | session expired | re-export `storageState` |
| 403 / 429 partway through | target is refusing automation | stop; report; do not evade |
| Overlays never detected | custom overlay markup | add its selector to `OVERLAY_SELECTOR` |
| Tabs recorded as dead buttons | content changed below the signature threshold | raise `settleMs`; the panel likely had not rendered |
| Modal interiors missing | `interactionDepth: 1` | set it to `2` |
| `budgetExhausted` in the manifest | `maxInteractionsPerRoute` too low for a dense screen | raise it for that route via a scoped second run |
| Crawl runs for hours | scope too wide | lower `maxRoutes`, use `includePatterns` |
| Same modal recorded many times | shared component per row | dedupe by heading during synthesis |

## Scope boundary

This skill maps and specifies. It does not copy an implementation. If asked to
pull down their bundles, lift their stylesheets, or reproduce their pages
verbatim, say plainly that the audit produces a spec to build from and that
copying the implementation is both a legal problem and a worse foundation than a
clean build — then carry on with the spec.
