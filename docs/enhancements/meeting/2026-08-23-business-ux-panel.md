# Mezan (ميزان) — Stakeholder Requirements Meeting: Business / UX Panel

**Date:** 2026-08-23
**Branch:** `feature-enhancements` (enhancements beyond parity; `main` stays parity-only)
**Session:** Business / UX half — six role-lens personas channeled from `.claude/agents/{product,client,end-user,designer,a11y,data-analyst}.md`
**Author:** Bassam Zakaria

> **What this document is.** The prior meeting in `requirements.md` was run by *domain* personas (Business Owner, Chief Accountant, Warehouse Manager, Cashier, Sales Manager, Auditor, IT Admin) — it asked *"what business capability is missing?"* and produced `ENH-001…ENH-063`.
>
> This panel is different. It is run by six *role-lens* personas — the product strategist, the buyer, the everyday operator, the designer, the accessibility advocate, and the data analyst. They ask a different question: not *"what feature is missing?"* but *"is what we're building the right thing, will anyone buy it, is it usable, is it usable **by everyone**, and does it produce trustworthy numbers?"* Where a point reinforces an existing requirement, it cites the `ENH-###`; where it is genuinely new, it gets a panel ID (`PRD/CLI/EU/DSGN/A11Y/DA-##`).
>
> **Sizing legend (same as `requirements.md`):** S = ≤1 week · M = 1–3 weeks · L = 3–6 weeks · XL = >6 weeks (multi-engineer). Sizes are relative to an already-built parity module.
>
> **Grounding:** `docs/plan.md` (v1 scope, 15 domains, module licensing, offline-first architecture), `docs/catalog/01..09-*.md` (33 reports, 268 permissions, 39 notification events, 26 workflow action types), `docs/enhancements/{requirements,workflows,market-analysis}.md`, `docs/enhancements/design/ux-enhancement-spec.md`.

---

## Attendees (role lenses)

| # | Persona | Lens | The question they hold |
|---|---|---|---|
| RL1 | **Product** | Outcomes & prioritization | Is this on-roadmap, does it serve the SMB lifecycle, what's the trade-off, ship/spec/defer/decline? |
| RL2 | **Client (Buyer)** | ROI / TCO | Will an Egyptian SMB owner pay for this, and can I defend the number to my partner? |
| RL3 | **End-user** | Daily friction | I sit down at 9:02 and open Mezan — how many clicks until I've done my job, and what makes me close it? |
| RL4 | **Designer** | UX / visual system | Does it fit the three-layer frontend, the teal-and-gold RTL identity, the density and overflow rules? |
| RL5 | **A11y** | Accessibility / RTL / Arabic | Does it work keyboard-only, for a screen reader in Arabic, and at AA contrast in both themes? |
| RL6 | **Data-analyst** | Reporting / BI / insight | What row gets written, at what grain, and what trustworthy question can a lead then answer? |

**Meeting frame.** Parity Mezan (v1) is done or nearly done across all 15 domains (`plan.md` build status). It is a *faithful* offline-first Arabic ERP. The domain panel already named the missing capabilities. This panel's job is to make sure those capabilities land as *product* (right bets, in order), as a *purchase* (defensible ROI), and as an *experience* (fast, beautiful, accessible, and measurable) — not just as more screens.

---

## RL1 — Product (outcomes & prioritization)

*Lens: decisions, not options. Locate on the roadmap, check fit, name the value, surface the trade-off, recommend.*

### Goals
- Keep the enhancements branch pointed at **one thesis**: turn Mezan from a *data-entry system that records what happened* into a *management instrument that prevents mistakes and surfaces insight* (the exact framing in `requirements.md` §A). Everything that doesn't serve that gets deferred or declined.
- Protect the **offline-first moat** (`market-analysis.md` §3.1) as the organizing constraint, not an afterthought. Any enhancement that quietly requires connectivity is scope creep into a different product.
- Sequence so each release is demoable against a *named competitor* a prospect actually compares us to — Daftra and SMACC (`market-analysis.md` §5).

### Pain points with a parity-only ERP
- The parity backlog is a flat list of 63 requirements with a MoSCoW table but **no explicit "why this before that" story an engineer can repeat back**. `ENH-001` (cockpit) and `ENH-050` (audit ledger) are both "Must" — but if I only ship one this quarter, which, and why?
- Parity treats every module as equal surface area. It isn't: the **dashboard is the #1 reason an owner opens the app daily** (`ENH-001` value line), yet it's sized the same L as van reconciliation which serves one vertical.
- No mechanism to *decline*. A parity roadmap grows monotonically; nothing on it ever says "we are deliberately not doing WhatsApp order intake in E1" out loud, so every stakeholder assumes theirs is next.

### Enhancement requirements / ideas

#### PRD-01 — A ranked "E1 spine" with a one-line defense per item
- **Problem:** MoSCoW buckets (`requirements.md` §D) tell us *importance* but not *order* or *dependency-honest sequencing*; the team can't self-serve "what do I pick up next."
- **Enhancement:** A single ordered E1 list — `ENH-001 Cockpit → ENH-002 Cash-runway → ENH-050 Audit ledger → ENH-010 Guided close → ENH-011 Bank rec → ENH-060 Backup drills` — each with a one-sentence rationale a requester can repeat without me in the room, plus the parity module it depends on (all already on `main`). Ship-now / spec / defer / decline stamped on every other ENH.
- **Value:** Removes re-litigation; every standup starts from an agreed order. Prioritization *is* the product work here.
- **Size:** S (planning artifact, not code).
- **Recommendation:** **Ship now.** This is the cheapest high-leverage thing in the whole panel.

#### PRD-02 — "Insight, not ledger" acceptance bar for every dashboard/report enhancement
- **Problem:** It's easy to build `ENH-001`/`ENH-004`/`ENH-042` as *prettier tables* and call it done, missing the thesis.
- **Enhancement:** A definition-of-done gate: a dashboard/report enhancement ships only if it (a) shows a *comparison* (vs last week / plan / floor), (b) offers *one primary action* on the exception it surfaces (the `ENH-001` drill-down, the `ux-enhancement-spec.md` §6 "needs attention" queue), and (c) auto-refreshes off the in-process event bus — no manual reload.
- **Value:** Guarantees the enhancements read as management tooling, which is the differentiator, not decoration.
- **Size:** S (a checklist folded into review).
- **Recommendation:** **Ship now**, apply retroactively to `ENH-001, 004, 042, 052`.

#### PRD-03 — Cut ENH-003 (remote/mobile glance) from E1; it fights the moat
- **Problem:** `ENH-003` (remote/mobile owner glance, L) and the P2 companion apps assume a sync/relay transport that **reintroduces the connectivity dependency the whole product is built to avoid** (`market-analysis.md` §3.6 note, §4.6).
- **Enhancement (decision):** Defer `ENH-003` behind the *hybrid sync tier* (`market-analysis.md` §4 P0-1). Until that transport is a deliberate, licensed capability, a "signed daily snapshot to a phone page" is the only offline-honest version — spec that S slice, decline the live-mobile version for now.
- **Value:** Keeps E1 shippable entirely offline; avoids a half-built sync path becoming load-bearing by accident.
- **Size:** S to spec the snapshot; the full feature stays out of E1.
- **Recommendation:** **Defer + spec.**

#### PRD-04 — Package enhancements as licensable value, matching the entitlement engine
- **Problem:** The licensing engine already models `activeModules[] + features{}` (`plan.md` dual-deployment table), but the enhancements are being designed as if they're all free/always-on. That leaves money and positioning on the table (`plan.md` "Market & competitive notes": competitor sells Installments/Manufacturing/AI as priced add-ons).
- **Enhancement:** Decide, per enhancement, whether it's *core*, a *paid module feature*, or a *persona bundle* ingredient (Retail / Distribution / Manufacturing). E.g. FEFO+expiry (`ENH-021`) → a "Pharma/F&B" feature flag; van reconciliation (`ENH-023`) → "Distribution" bundle; audit ledger + SoD (`ENH-050/051`) → "Compliance" bundle.
- **Value:** Converts the enhancement spend into a price sheet; ties directly to the buyer's ROI story (RL2).
- **Size:** M (entitlement mapping + flags; engine exists).
- **Recommendation:** **Spec it** now so features are built behind the right flag from day one, not retrofitted.

---

## RL2 — Client / Buyer (ROI & total cost of ownership)

*Lens: the Egyptian SMB owner writing the cheque — or the partner who has to approve it. Lead with the outcome and the number.*

### Goals
- Buy software I **own**, not rent forever. The perpetual/module license (`market-analysis.md` §3.3) is *why* I'm looking at Mezan over Daftra/SMACC's compounding SaaS.
- Know, before I sign, that when the internet drops the till keeps ringing and the books keep posting (`market-analysis.md` §3.1–3.2). That is the whole reason I'm not on the cloud product my accountant suggested.
- Have a number I can defend to my business partner: "this pays for itself in X months because it stops Y leakage / saves Z hours."

### Pain points with a parity-only ERP
- Parity is a beautiful faithful clone — but **"faithful clone of the app we already rejected as cloud-only" is not a sales argument.** Nobody buys parity; they buy the reason to switch.
- The ROI is *implied* in the domain requirements ("stops van leakage," "cuts close time") but **never quantified or surfaced inside the product**, so I can't see the payback accruing after I've bought.
- The one real friction of an offline perpetual license — re-hosting to new hardware, adding a seat, adding a module — has **no self-service story** (`market-analysis.md` §4 P0-4); every SaaS competitor solves this trivially with "just log in."
- Many of us **outsource bookkeeping** to an external accountant who needs to touch the books monthly. A pure offline desktop app doesn't answer "how does my accountant get in?" (`market-analysis.md` §4 P1-8).

### Enhancement requirements / ideas

#### CLI-01 — In-product "value realized" ledger (payback meter)
- **Problem:** The owner can't see the ROI accruing; the payback lives in a sales deck, not the app.
- **Enhancement:** A quiet owner-facing panel that totals *money the system caught*: below-floor discounts blocked (`ENH-041`), overdue AR recovered after a dunning reminder (`ENH-043`), stock variances found on count (`ENH-020`), duplicate/void catches from the daily digest (`ENH-004`). "Mezan flagged EGP 47,300 this quarter you'd otherwise have leaked."
- **Value:** Turns the purchase from a cost line into a demonstrable return; the single strongest renewal/expansion argument.
- **Size:** M (aggregates events other enhancements already emit).
- **Parity/panel dependency:** `ENH-041, 043, 020, 004`, event bus.

#### CLI-02 — Public per-module perpetual price sheet + persona bundles
- **Problem:** "Own it, don't rent it" is an architectural fact, not yet a *marketable, comparable* one; Daftra and SMACC win trust with transparent tiered pricing pages (`market-analysis.md` §4 P0-3).
- **Enhancement:** A published module-by-module perpetual/term price list mirroring competitor transparency, plus curated **persona bundles** (Retail & F&B / Wholesale & Distribution / Manufacturing) and the 4 capacity axes (seats / branches / warehouses / POS terminals) from `plan.md`'s competitive notes.
- **Value:** Lets a buyer do the TCO math themselves and see the "no compounding subscription" saving over 3 years — the core displacement wedge.
- **Size:** S (commercial artifact; depends on the entitlements engine already built).
- **Panel dependency:** `PRD-04`.

#### CLI-03 — License self-service portal (re-host / add-seat / add-module offline)
- **Problem:** The one genuine friction of offline perpetual licensing vs SaaS is hardware moves and seat/module changes needing vendor intervention.
- **Enhancement:** A lightweight offline-friendly flow to re-issue/transfer an Ed25519 license to new hardware, add a seat, or unlock a module — challenge/response by file or short code, no always-on server required.
- **Value:** Removes the last "but SaaS is more convenient" objection; reduces support cost (a cost *I* ultimately pay in a support contract).
- **Size:** M.
- **Parity dependency:** Licensing/entitlements engine (`plan.md`).

#### CLI-04 — External-accountant collaboration mode (scoped, offline-honest)
- **Problem:** Most SMBs outsource bookkeeping; the offline desktop app has no clean answer for the monthly external accountant.
- **Enhancement:** A constrained, scoped-write "external accountant" role (`market-analysis.md` §4 P1-8) plus an offline exchange: a signed period export the accountant reviews/adjusts and a signed import of their journal entries back — reusing the audit ledger (`ENH-050`) so every external change is evidenced.
- **Value:** Answers a workflow every cloud rival solves with "just log in," without breaking the offline model; removes a common deal-blocker.
- **Size:** M–L.
- **Parity/panel dependency:** Roles/permissions, `ENH-050`, `ENH-052` (evidence pack), numbering.

#### CLI-05 — Guided switch-in from Daftra / QuickBooks / Excel
- **Problem:** Switching cost — re-keying the chart of accounts, customers, items, opening balances — is the real reason a shop stays on the tool it dislikes.
- **Enhancement:** Import wizards from the three most common "what I use today" answers (`market-analysis.md` §4 P2-12): Daftra export, QuickBooks, and Excel bookkeeping, mapping into COA / customers / suppliers / items / opening stock (`INITIAL_STOCK` reason already exists) / AR-AP opening balances.
- **Value:** Collapses onboarding from weeks to a day; directly targets displacement of the named rivals.
- **Size:** L.
- **Parity dependency:** Accounting, Inventory (opening stock), Sales/Purchases (opening balances), Integrations/import (shared with `ENH-011` bank import, `ENH-062` API).

---

## RL3 — End-user (daily friction)

*Lens: first person, present tense. I do 3–8 documents a day across modules. I hate extra clicks and forms filled twice. I love keyboard shortcuts. Under 250 words of pain, then what I'd actually use.*

### Goals & morning walk
I sit down at 9:02. I have twelve invoices to enter from yesterday's paper pile, three supplier deliveries to receive, and the boss will ask "how much cash do we have" before lunch. I want the page to load already knowing what I owe it — not a blank dashboard I have to go fishing in.

### Pain points with a parity-only ERP
- **Every document is a mouse safari.** Parity forms are faithful to the source app, which means click the customer dropdown, scroll, click, tab, click the item, scroll, click, repeat. Twelve invoices like that is my whole morning. There's no scan-to-add, no `⌘K` "new invoice for Ahmed," no `⌘S` to post.
- **I fill the same thing twice.** Customer, then the customer's price list, then the customer's tax — the app knows all three from the first field but makes me confirm each. If a field is optional and costs me 10 seconds, I skip it (so the *velocity data the analyst wants never gets entered*). If it's required and pointless, I resent it.
- **I find out I'm wrong too late.** I enter an item that's out of stock and the sale just… fails at post, after I've keyed the whole thing (`ENH-022` is exactly this pain). Same with a below-cost price — nothing warns me *as I type* (`ENH-041`).
- **The "will I be late / did I mess up" signal is a shaming one.** A red error at post feels like the app caught me in front of the boss. I want the calm nudge *before* I commit, not the public red *after*.
- **A crash eats my work.** If the PC hiccups mid-invoice like it does at the busy till (`ENH-032`), I re-key the lot.

### Enhancement requirements / ideas

#### EU-01 — Keyboard-first document entry across all documents (not just POS)
- **Problem:** `ENH-030` gives the *POS* a keyboard/scanner fast-lane, but I live in **sales invoices, purchase GRNs, and journals** all day and those are still mouse-driven.
- **Enhancement:** Extend the `ux-enhancement-spec.md` §7 keyboard model app-wide: always-visible command bar (`⌘K` routes to "new invoice / receive goods"), `⌘N` create, `⌘S`/`⌘Enter` post, `/` to focus in-form search, scan-to-add-line and quantity-multiplier on any line-item document, `j`/`k` to move the line selection.
- **Value:** Turns my twelve-invoice morning from an hour into fifteen minutes; it's the difference between resenting the app and flying in it.
- **Size:** M.
- **Parity/panel dependency:** All line-item documents, command-bar composite (`ux-enhancement-spec.md`), overlaps `ENH-030`.

#### EU-02 — Inline "as-you-type" guardrails, not post-time errors
- **Problem:** Stock-out, below-floor price, missing tax code (`ENH-011b`), and blocked-period all currently fail at *post*, after I've done the work.
- **Enhancement:** Show the problem on the line the instant it's true: live stock badge, live margin/floor indicator (`ENH-041`), ETA pre-check inline (`ENH-011b`), "period is locked" before I start — all `aria-live="polite"` so it's a calm nudge, never a shaming red wall.
- **Value:** I never re-key a doomed document; the app feels like it's helping me, not grading me.
- **Size:** M.
- **Parity/panel dependency:** Sales/Purchases entry, Inventory, ETA, `ENH-041`, `ENH-011b`.

#### EU-03 — Autofill the second and third field from the first
- **Problem:** Choosing a customer already implies their price list, payment terms, tax profile, and default warehouse — but I still confirm each.
- **Enhancement:** On entity select, pre-fill every downstream field the entity determines, visibly (so I can see and override), and remember my last-used warehouse/branch per document type. Optional fields get smart defaults so I stop skipping them.
- **Value:** Fewer keystrokes *and* more complete data (which quietly fixes the analyst's "velocity data never entered" gap).
- **Size:** S–M.
- **Parity dependency:** Customers/Suppliers (price lists, terms), Inventory (warehouses).

#### EU-04 — Crash-safe drafts on every document, not only the cart
- **Problem:** `ENH-032` autosaves the *POS cart*; a half-keyed sales invoice or GRN on the back-office PC is just as lossy when the machine restarts.
- **Enhancement:** Continuous local autosave of any in-progress document, with "recover your draft" on relaunch — the same pattern `ENH-032` uses at the till, generalized.
- **Value:** Zero re-keying after a crash anywhere in the app; on a single-shop offline PC this is real reliability, not a nicety.
- **Size:** S.
- **Parity/panel dependency:** All document forms; reuses `ENH-032` mechanism.

#### EU-05 — A morning "start here" queue instead of a blank dashboard
- **Problem:** I open the app and have to *remember* what's outstanding; the parity dashboard shows numbers, not my to-do.
- **Enhancement:** The `ux-enhancement-spec.md` §6 "needs attention" column, scoped to *me/my role*: documents to post, deliveries to receive, ETA rejections to fix, drafts to resume — each a one-key jump.
- **Value:** I know what my day is the second the page loads; nothing falls through.
- **Size:** M.
- **Parity/panel dependency:** Dashboard, notification/event taxonomy (39 events), overlaps `ENH-001`.

**What I'd actually use:** the version I'd open every morning without being told to is one where I press `⌘K`, type "invoice Ahmed," and I'm on a form that already knows Ahmed's prices and terms; I scan or type item lines with the number pad, a calm grey badge tells me line 4 is low on stock *before* I care, `⌘S` posts it, and if the PC dies on invoice nine I get all nine back. That's not new features — that's the same features, minus the friction.

---

## RL4 — Designer (UX / visual system)

*Lens: the three-layer frontend (atoms → primitives → composites → pages), the teal-and-gold RTL identity, density and overflow safety, and full loading/empty/error/pending states. Findings as Critical / Warning / Suggestion.*

### Goals
- Ship the enhancements *inside one visual system*, not as a pile of new one-off screens. The `ux-enhancement-spec.md` direction (deep-pine chrome spine, Tajawal display, the *mizan* balance-beam motif, 8px data radii, `tabular-nums` LTR-isolated figures) is the frame every enhancement must land in.
- Make **density** a first-class decision: an ERP operator scans hundreds of rows; the enhancements (cockpit, close checklist, dunning worklist, replenishment list, SoD report) are all list/queue surfaces and must use the 36px dense row rhythm, sticky headers, tinted zebra, and hover-only row actions — not marketing-page whitespace.
- Keep **RTL-first** honest: these are Arabic screens where Western digits and Latin codes are the exception that must be LTR-isolated, not the default.

### Pain points with a parity-only ERP
- Parity is coherent but generic — "a good Arabic ERP, not a distinctive one" (`ux-enhancement-spec.md` §1). If enhancements are bolted on without the motif and chrome spine, they'll look like a *third* design era stacked on the parity one.
- New composite screens are where **layering rot** starts: a cockpit tile that calls React Query directly, a worklist that imports `lucide-react` instead of the `Icon` atom, a KPI card with a raw hex color instead of a token.
- Enhancement screens are dense and *numeric* — the highest risk for **overflow and misalignment** at 1280px+ (long Arabic customer names next to mono figure columns, status pills, and row actions in one flex row).

### Enhancement requirements / ideas

#### DSGN-01 — Enhancement component kit: reuse the primitives, extend three composites
- **Problem:** Cockpit (`ENH-001`), worklists (`ENH-022/043/051`), and checklists (`ENH-010`) will each be tempted to hand-roll cards, KPI tiles, and queues.
- **Enhancement:** Before building any enhancement screen, land three shared composites in `web/src/ui/`: a **KPI card** (label + `tabular-nums` value + directional micro-beam delta + optional sparkline, per `ux-enhancement-spec.md` §5), a **worklist/queue** (dense rows, chip-row filters with live counts, hover row-action, faint total footer), and a **checklist gate** (red/green item + jump-to-fix link, for `ENH-010`). Every enhancement composes these; none re-imports `lucide-react` or calls an API client directly (shell-widget allowlist only).
- **Value:** All ~28 enhancements inherit one look, one density, one state-handling contract for free; review gets trivial.
- **Size:** M.
- **Layer note (Critical):** these are `primitives`/`composites`; they read `tokens.ts`, never raw hex; every styled element gets a `dark:` variant.

#### DSGN-02 — The *mizan* motif carried into the enhancements, in graded doses
- **Problem:** The balance-beam identity (`ux-enhancement-spec.md` §4) is the one thing that makes Mezan not-generic; if enhancements ignore it, it stays a logo.
- **Enhancement:** Apply the three graded doses to enhancement surfaces: the **fulcrum rule** under every new page title; **variance micro-beams** in cockpit deltas, the conversion funnel (`ENH-042`), aging, and report period-over-period cells; the **balance-beam hero** as the cockpit thesis object (`ENH-001`) rather than a generic first chart.
- **Value:** The enhancements *are* the brand moment; a `main` user recognizes the same product levelled up.
- **Size:** M (motif primitives) — the beam is the one deliberately-bold object; everything else ambient/cheap.
- **A11y handoff:** the beam and micro-beams convey direction by *tilt + number + label*, never color alone, and render already-settled under `prefers-reduced-motion` (see RL5).

#### DSGN-03 — Overflow & density audit spec for numeric/RTL enhancement tables
- **Problem:** Enhancement screens pack Arabic entity names + mono figures + status pills + row actions into tight 1280px rows — the exact overflow trap the designer role guards.
- **Enhancement:** A per-table checklist enforced in review: figures right-aligned mono `tabular-nums` LTR-isolated; long names `truncate`/`line-clamp-2` with title tooltip; buttons `whitespace-nowrap shrink-0`; rows with 5+ elements split or move secondary actions into the hover row-action; selects `min-w-0 flex-1`.
- **Value:** No enhancement ships with a broken row at the resolution our desktop users actually run.
- **Size:** S (a spec + review gate).

#### DSGN-04 — States are part of the feature, not a follow-up
- **Problem:** Enhancement screens that pull live/aggregate data (cockpit, forecast, worklists) are precisely where blank-on-load, silent-error, and no-empty-state regressions appear.
- **Enhancement:** Every enhancement surface ships all four states from day one: loading → `Skeleton` (never blank), empty → `EmptyState` with copy + primary action, error → inline `text-red-600` (never silent), mutation pending → per-row pending (never a mutation-wide flag disabling the whole list — the list-UI rule from the project conventions).
- **Value:** The enhancements feel finished and trustworthy; no "why is it blank" support calls.
- **Size:** S (contract, enforced in review; overlaps `PRD-02`).

---

## RL5 — A11y (accessibility / RTL / Arabic)

*Lens: WCAG 2.1 AA is the floor. Keyboard-only, screen-reader in Arabic, contrast in both themes, motion sensitivity. The design system already mandates `aria-label` and a `dark:` variant — verify those plus what the design rules don't enforce.*

### Goals
- Make the keyboard-first posture (`ux-enhancement-spec.md` §7, `EU-01`) a genuine *accessibility* win, not just a power-user speed feature: keyboard-operable is the same requirement for the fast cashier and the motor-impaired accountant.
- Guarantee the new **custom widgets** the enhancements introduce — the balance beam, drag-to-reorder, the count-session scanner UI, the calendar/kanban of the CRM pipeline — have a real role + keyboard model, because none of them are native elements.
- Hold the line on **Arabic RTL screen-reader** correctness, the thing every global competitor gets rough (`market-analysis.md`: Odoo/ERPNext/Dynamics RTL is bolted-on and buggy) — this is a place Mezan can be *better*, not merely present.

### Pain points with a parity-only ERP
- Parity meets the design-system floor (`aria-label`, `dark:`) but the enhancements add exactly the widget classes the floor doesn't cover: **custom drag-to-reorder** (kanban stages `ENH-040`), **grids** (calendar/aging matrix), **timer/scanner controls** (count sessions `ENH-020`, drawer `ENH-033`), and an **animated hero** (the balance beam).
- **Dynamic numbers with no announcement.** Cockpit auto-refresh, running "unreconciled difference → 0" (`ENH-011`/WF-03), cash-count variance (`ENH-033`) — these update silently; a screen-reader user never hears the total change.
- **Contrast risk in the new palette.** The `ux-enhancement-spec.md` deep-pine chrome, antique-brass accent, and warm porcelain ground are re-tuned values; brass-on-teal and status pills need re-verification at 4.5:1 in *both* themes including hover/focus, not assumed from parity.
- **Color-only meaning.** Red/green close-checklist gates (`ENH-010`), the funnel, aging heat tint, and the balance beam all risk encoding state in hue alone.
- **Bilingual announcement.** Arabic RTL prose with LTR-isolated Western digits/Latin codes must read correctly in a screen reader, and `⌘K` shortcut hints must be discoverable, not folklore.

### Enhancement requirements / ideas

#### A11Y-01 — Accessible custom-widget contract for every net-new widget
- **Problem:** The enhancements introduce non-native widgets with no default keyboard/AT behavior.
- **Enhancement:** A required per-widget spec — explicit `role`, keyboard model, and tested AT behavior — for: kanban drag-to-reorder (`ENH-040`) must be arrow-key reorderable, not drag-only; the aging/calendar grids get `role="grid"` with arrow navigation; scanner/count and drawer controls (`ENH-020/033`) are real `<button>`/`<input>` via primitives, never `<div onClick>`; modals/side panels trap focus correctly and honor `Esc` (the `ux-enhancement-spec.md` §7 `Esc`-closes rule).
- **Value:** The enhancements are operable by keyboard-only and screen-reader users — and, not incidentally, faster for everyone.
- **Size:** M (spread across the widgets as they're built).
- **WCAG:** 2.1.1 Keyboard, 4.1.2 Name/Role/Value.

#### A11Y-02 — `aria-live` on every dynamic total the enhancements introduce
- **Problem:** Auto-refreshing cockpit tiles, the reconciliation countdown, and cash-count variance change silently.
- **Enhancement:** Wrap non-urgent live figures (running totals, ETAs, "unreconciled difference," variance) in `aria-live="polite"`; reserve `assertive` for true alerts (backup-integrity failure `ENH-060`, anomaly alert `ENH-004`). Toasts already do this right; these custom inline updates must too.
- **Value:** A blind accountant hears the reconciliation reach zero and the cash drawer balance — otherwise the enhancement is invisible to them.
- **Size:** S.
- **WCAG:** 4.1.3 Status Messages.

#### A11Y-03 — Re-verify contrast for the enhanced palette, both themes, all states
- **Problem:** `ux-enhancement-spec.md` re-tunes brand/accent/ground/chrome; contrast can't be inherited from parity.
- **Enhancement:** Verify 4.5:1 body / 3:1 large + non-text on every enhancement surface *combination* — brass-on-pine chrome, status pills, zebra rows, KPI deltas, `:focus-visible` brass ring — in light, dark, *and* OS-default, including hover/focus. Fix by token adjustment, not per-component overrides.
- **Value:** The "premium level-up" doesn't cost readability for low-vision users; keeps the AA guarantee the spec claims (`ux-enhancement-spec.md` §2 "checked so body clears AA").
- **Size:** S–M.
- **WCAG:** 1.4.3 Contrast, 1.4.11 Non-text Contrast.

#### A11Y-04 — No meaning by color alone (beams, gates, funnel, heat)
- **Problem:** Balance beam, red/green close gates, funnel stages, and aging heat tint risk hue-only encoding.
- **Enhancement:** Pair every state with a non-color cue: the beam reads *tilt + net figure + label*; close-gate items carry an icon + text ("مكتمل / محتاج إجراء"), not just red/green; aging cells show the bucket label/number, not only warmth; funnel stages are labeled.
- **Value:** Colorblind and low-vision users get the same signal; also satisfies the designer's motif goals without conflict.
- **Size:** S.
- **WCAG:** 1.4.1 Use of Color.

#### A11Y-05 — Motion honored, and RTL/bilingual reading verified
- **Problem:** The balance-beam settle, page-load stagger, and panel slides (`ux-enhancement-spec.md` §8) are motion; and Arabic RTL + LTR-isolated digits must read correctly to AT.
- **Enhancement:** Every animation gated by `prefers-reduced-motion` (beam renders already-settled — the spec already commits to this; verify it holds across enhancement screens). Plus an Arabic screen-reader pass: RTL prose + LTR-isolated Western numerals/Latin codes announce in correct order; `kbd` shortcut hints have accessible names.
- **Value:** No vestibular triggers; the RTL screen-reader correctness becomes a genuine edge over the bolted-on-RTL competitors.
- **Size:** S.
- **WCAG:** 2.3.3 Animation from Interactions, 1.3.2 Meaningful Sequence.

**Manual tests required before merge:** (1) keyboard-only walk of the cockpit + one worklist + the kanban reorder, focus never lost; (2) Arabic screen-reader (VoiceOver/NVDA) pass on a document form with live guardrails and on the reconciliation countdown; (3) contrast sampling of brass-on-pine chrome + status pills + focus ring in light/dark/OS-default; (4) `prefers-reduced-motion` on — confirm the beam renders settled and the stagger is off.

---

## RL6 — Data-analyst (reporting / BI / insight)

*Lens: turn operational events into trustworthy charts a lead relies on. For each feature — what row gets written, at what grain and key; is the plan snapshotted; whose "day" is the day; can we backfill; does it double-count an existing surface? Output: persistence model, reportable questions, risks.*

### Goals
- Make the enhancements *reportable by construction*. Mezan already has **33 reports across 8 domains** (`08-reports.md`) with a built-in GL reconciliation control ("مطابقة دفتر الأستاذ") and previous-period comparison baked into the by-period report — the enhancements must feed that discipline, not spawn a parallel truth.
- Establish the **plan-vs-actual** spine the parity app lacks: reorder points, price floors, cash forecast, and van settlement are all "committed expectation vs. what happened" — only useful if the *expectation* is snapshotted immutably at commit time.
- Nail **day-boundary and currency** semantics once, centrally, so weekly/monthly rollups and the multi-currency (EGP + 10) figures don't quietly lie.

### Pain points with a parity-only ERP
- Parity reports are **read models over current state** — they answer "what is the balance now," not "what did we *expect* and how did we do against it." There's no persisted plan to compare against, so `ENH-002` (cash forecast), `ENH-022` (reorder), `ENH-041` (floor), `ENH-023` (van) have nothing to grade actuals by after the fact.
- No **event grain** for the new operational moments: a discount *blocked*, a dunning reminder *sent*, a variance *found*, an ETA *rejected then fixed* — these are the exact rows the buyer's payback meter (`CLI-01`) and the leaderboard (`ENH-042`) need, and parity writes none of them.
- **Day-boundary ambiguity.** Van settlement, POS shift Z-reports (`ENH-033`), and the daily digest (`ENH-004`) each imply a "day" — user-local? branch? UTC? Parity never fixes it, so a shift that crosses midnight or a branch in a different practice will produce numbers that don't tie.
- **Double-counting risk.** The cockpit (`ENH-001`), daily digest (`ENH-004`), and the standup-style summaries would happily each compute "today's sales" their own way. There must be *one* query behind a number, or two surfaces will disagree in front of the owner.

### Enhancement requirements / ideas

#### DA-01 — Immutable plan/expectation snapshots for every plan-vs-actual feature
- **Problem:** Reorder point, price floor, cash-forecast assumptions, and van load-out are *expectations*; if edited in place they become invisible to history and un-gradeable.
- **Enhancement:** Persist the committed expectation as an immutable snapshot row at commit time:
  - `reorder_policy_snapshot` (PK `id`; `itemId+warehouseId`, `min`, `max`, `leadTimeDays`, `velocityBasis`, `effectiveFrom`) — so a later "did the reorder point hold?" is answerable.
  - `van_loadout_snapshot` (PK `id`; FK `repId`, `warehouseId`, `date`; expected stock + expected cash) vs. the settlement actuals (`ENH-023`).
  - `cash_forecast_run` (PK `id`; `runAt`, horizon, assumptions) so a forecast can be compared to what actually happened.
- **Value:** Enables the entire plan-vs-actual reporting layer; without it these features are point-in-time toys.
- **Size:** M (schema + write-at-commit hooks; read models follow).
- **Parity dependency:** Inventory, Treasury (cheque register for forecast), Sales AR / Purchases AP, `ENH-002/022/023/041`.

#### DA-02 — A canonical operational-event table feeding payback, leaderboard, and digest
- **Problem:** Blocked discounts, sent reminders, found variances, and ETA fix-loops are un-persisted, so `CLI-01`, `ENH-042`, and `ENH-004` each can't be built on solid data.
- **Enhancement:** One append-only `ops_event` table (PK `id`; `type`, `userId`, `entityType`, `entityId`, `amountImpact`, `branchId`, `occurredAt`, `localDate`) capturing the value-bearing moments, distinct from and complementary to the immutable audit ledger (`ENH-050`, which is *field-level before/after*). This is the *analytic* event stream; the audit ledger is the *evidence* stream — one source each, not two truths.
- **Value:** Powers the payback meter (`CLI-01`), rep leaderboard (`ENH-042`), and daily digest (`ENH-004`) from a single query; a lead can answer "how much did guardrails save this month, by user."
- **Size:** M.
- **Risk guarded:** explicitly *not* the audit ledger — different grain, different purpose; documented so the two don't get merged or double-counted.

#### DA-03 — One day-boundary & currency contract for all rollups
- **Problem:** "Day," "period," and currency conversion are defined ad hoc per surface; shift-crossing-midnight and multi-branch/multi-currency rollups will disagree.
- **Enhancement:** A central policy: every reportable row stores `localDate` computed from the **branch's** timezone (the operational unit), the raw `occurredAt` (UTC), and — for money — both the transaction currency and the EGP-equivalent at a *stated* rate row (tie to the existing FX revaluation / exchange-rate tables). Shifts (`ENH-033`) and van days (`ENH-023`) key on the *business day* they opened, not wall-clock midnight.
- **Value:** Weekly/monthly and cross-branch rollups tie; the multi-currency figures are reproducible and auditable.
- **Size:** M (a shared helper + a migration to backfill `localDate`/rate on new rows).
- **Parity dependency:** Multi-currency (exchange rates, FX revaluation), Settings (branch TZ).

#### DA-04 — Single-source-of-truth guard against duplicate "today's sales"
- **Problem:** Cockpit (`ENH-001`), daily digest (`ENH-004`), and any standup-style summary can each compute the same KPI independently and disagree.
- **Enhancement:** Every headline KPI (today's sales, gross margin, cash on hand, overdue AR) is defined **once** in the reports layer (`api/src/apps/reports/`) and consumed by all surfaces; the cockpit and digest call the *same* query, never their own. Reuse the existing GL-reconciliation control ("مطابقة دفتر الأستاذ") on the enhancement reports so a total can be cross-checked to the ledger.
- **Value:** The owner never sees two numbers for the same thing; trust in the whole BI story survives.
- **Size:** S–M (discipline + shared query modules).
- **Parity dependency:** Reports engine, overlaps `ENH-001/004`.

#### DA-05 — Backfill/recompute strategy so history survives an algorithm change
- **Problem:** Velocity-based reorder qty, collection-risk scoring, and forecast models *will* change; if history is only stored as computed outputs, changing the formula orphans the past.
- **Enhancement:** Keep raw rows (the `ops_event` stream, snapshots, `time`/document facts) separately from rollups; make rollups recomputable from raw; state a retention policy (raw ≥ 24 months, rollups indefinitely). Version the algorithm on the row (`algoVersion`) so a recompute is explainable.
- **Value:** We can improve the models without lying about last quarter; comparability over time is preserved — the analyst's core fear addressed.
- **Size:** M.
- **Parity/panel dependency:** `DA-01`, `DA-02`, reports engine.

**Reportable questions this unlocks (for a lead / the director):** given this data — *"how much did price-floor and dunning guardrails save us this month, and by whom?"* (`CLI-01`, `DA-02`); *"did our reorder points actually prevent stock-outs, or were they set wrong?"* (`DA-01`); *"which rep converts quotes to cash fastest, at what margin?"* (`ENH-042`, `DA-02`); *"is week-3's forecast cash dip real, and did last month's forecast prove accurate?"* (`ENH-002`, `DA-01`); *"do today's sales tie between the cockpit, the digest, and the GL?"* (`DA-04`).

---

## Cross-panel synthesis

**Convergences (multiple lenses ask for the same thing — build these first):**
- **Keyboard-first everywhere** — asked by End-user (`EU-01`), Designer (`ux-enhancement-spec.md` §7 command bar), and A11y (`A11Y-01`, keyboard = accessibility). One build, three wins. **→ E1.**
- **Insight-not-ledger dashboards** — Product's acceptance bar (`PRD-02`), Designer's motif hero (`DSGN-02`), End-user's morning queue (`EU-05`), Data-analyst's single-source KPIs (`DA-04`) all describe the *same* cockpit. Build it once, to all four contracts.
- **Snapshot the expectation** — Data-analyst's `DA-01` is the hidden prerequisite for the buyer's payback meter (`CLI-01`) and half the domain ENHs (`ENH-002/022/023/041`). It's plumbing, but it's load-bearing plumbing.
- **Offline-honest by construction** — Product (`PRD-03`), Buyer (`CLI-01/03/04`), and the market analysis all agree: nothing in E1 may quietly require connectivity. This is the moat; guard it in review.

**Tensions to resolve:**
- **Remote/mobile access** (owner wants it, `ENH-003`) vs. **offline-first moat** (Product `PRD-03`, market §3.6). Resolution: gate it behind the deliberate hybrid-sync tier; ship the signed-snapshot slice only until then.
- **Premium visual level-up** (`ux-enhancement-spec.md`) vs. **AA contrast + density** (A11y `A11Y-03`, Designer `DSGN-03`). Resolution: the re-tuned palette must be re-verified, not inherited; density and contrast are gates, not follow-ups.
- **Paid-module packaging** (`PRD-04`, `CLI-02`) vs. **feels-complete out of the box** (End-user). Resolution: package by *vertical bundle*, not by nickel-and-diming daily-driver friction fixes — the keyboard/guardrail/autosave wins (`EU-01..05`) stay core.

**Recommended E1 spine (Product's call, `PRD-01`):**
`DA-01/02 snapshots+events (plumbing)` → `EU-01 keyboard-first` → `ENH-001 cockpit (to PRD-02/DSGN-02/DA-04 contracts)` → `ENH-002 cash-runway` → `ENH-050 audit ledger` → `ENH-010 guided close` → `ENH-060 backup drills`, with `DSGN-01` kit and the `A11Y`/`DSGN` gates applied throughout.

---

## Panel enhancement index

| ID | Persona | Title | Size |
|---|---|---|---|
| PRD-01 | Product | Ranked E1 spine with per-item defense | S |
| PRD-02 | Product | "Insight, not ledger" DoD gate | S |
| PRD-03 | Product | Defer ENH-003 behind hybrid-sync tier | S |
| PRD-04 | Product | Package enhancements as licensable value | M |
| CLI-01 | Buyer | In-product "value realized" payback meter | M |
| CLI-02 | Buyer | Public perpetual price sheet + persona bundles | S |
| CLI-03 | Buyer | License self-service portal (offline) | M |
| CLI-04 | Buyer | External-accountant collaboration mode | M–L |
| CLI-05 | Buyer | Guided switch-in from Daftra/QuickBooks/Excel | L |
| EU-01 | End-user | Keyboard-first document entry app-wide | M |
| EU-02 | End-user | Inline as-you-type guardrails | M |
| EU-03 | End-user | Autofill downstream fields from the first | S–M |
| EU-04 | End-user | Crash-safe drafts on every document | S |
| EU-05 | End-user | Morning "start here" role queue | M |
| DSGN-01 | Designer | Shared enhancement component kit | M |
| DSGN-02 | Designer | *mizan* motif carried into enhancements | M |
| DSGN-03 | Designer | Overflow & density audit for numeric/RTL tables | S |
| DSGN-04 | Designer | Four states shipped from day one | S |
| A11Y-01 | A11y | Accessible custom-widget contract | M |
| A11Y-02 | A11y | `aria-live` on dynamic totals | S |
| A11Y-03 | A11y | Re-verify contrast, both themes, all states | S–M |
| A11Y-04 | A11y | No meaning by color alone | S |
| A11Y-05 | A11y | Motion honored + RTL/bilingual AT pass | S |
| DA-01 | Data-analyst | Immutable plan/expectation snapshots | M |
| DA-02 | Data-analyst | Canonical operational-event table | M |
| DA-03 | Data-analyst | One day-boundary & currency contract | M |
| DA-04 | Data-analyst | Single-source-of-truth KPI guard | S–M |
| DA-05 | Data-analyst | Backfill/recompute strategy | M |

**Total: 28 enhancement items across 6 business/UX personas.** They complement — not duplicate — the 28 domain requirements in `requirements.md`: the domain panel named *what capability* is missing; this panel governs *how* those capabilities become the right product, a defensible purchase, and a fast, beautiful, accessible, trustworthy experience.
