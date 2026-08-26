---
name: mezan-erp
description: >
  Working rules for Mezan — the Arabic/RTL, offline-first Egyptian ERP in this repo
  (accounting, GL, treasury, inventory/WAC costing, sales, purchases, payroll,
  licensing). Use this skill for ANY work on this codebase and for any finance/ERP
  task generally: posting to a ledger, money arithmetic and rounding, costing,
  sub-ledger vs control-account reconciliation, document lifecycles
  (draft/confirm/return/void), numbering sequences, fiscal periods, permissions
  and entitlement gating, seeding data, or verifying that a screen actually works.
  Trigger it when the user says anything like "fix the defects", "check the
  invoice/voucher/stock numbers", "does the trial balance balance", "wire this
  screen", "add a module", "test the app", "audit coverage", "why is AR wrong" —
  and also before starting any ERP feature elsewhere, because the failure modes
  here (money as float, built-but-unwired features, caller-supplied limits,
  one-sided postings) repeat in every ERP.
---

# Mezan ERP — how to work here without breaking the books

This skill is the distilled residue of a long build: 16 open + 10 fixed defects, a
964-scenario authoring pass, several live browser audits, and the user's repeated
corrections. Read the relevant reference before acting; they are short and each one
exists because something went wrong without it.

| Need | Read |
|---|---|
| Money, GL, costing, document and gating invariants | `references/ledger-invariants.md` |
| Known defects, their patterns, and false alarms | `references/defect-register.md` |
| How to prove anything works (seed, browser, gates) | `references/verification-protocol.md` |
| Scope, architecture, licensing, competitors | `references/product-and-market.md` |
| The user's standing preferences and process rules | `references/working-agreement.md` |

## The ten moves that found almost every real defect

Apply these first — they have the highest yield per minute.

1. **Never trust a number the caller supplied.** The worst defect found — the same
   goods returnable forever — validated the return quantity against an
   `availableQty` that arrived *in the same request body*. For any limit ask: who
   computed this? If the answer is "the client", it is not a limit; recompute it
   server-side from posted documents.
2. **A feature can be fully built and simply not wired.** The warehouse selector
   sent its header, the resolver parsed it, no route read it. The approval gate
   built its request and dropped it. The ETA queue has an `enqueue` nothing calls.
   The allocation sub-ledger has a `save` nothing calls. Reading the code convinces
   you it works; only driving it end to end finds these.
3. **Two numbers that must agree beat either alone.** Sub-ledger vs its GL control
   account caught four defects. One plausible figure hides anything; a pair that
   must match cannot.
4. **Empty screens hide everything.** A control on a screen with no rows cannot be
   proven to work. Seed first, then test — an empty list surface is itself a finding.
5. **When you find a defect, look for its twin.** Sales returns and purchase returns
   had the identical hole. After every fix, grep for the same shape elsewhere.
6. **A stale comment is a defect report.** `GET /items/:id` served a hardcoded zero
   behind "real figures arrive once Phase 2 lands" — Phase 2 had landed. Comments
   promising future work are claims to verify against the present.
7. **Distrust your own instrument first.** A run reported 86 contrast failures; all
   86 were one alpha-parsing bug. Anything that fails on *every* screen is almost
   always the measurement. Ten of the first twelve failures in the seams scenario
   suite were the scenario's own wrong field names, not product defects.
8. **A create route that upserts by id makes every lifecycle state decorative.**
   `POST /exchange-rates` with an existing id rewrote a **locked** rate and reset its
   status to pending (D25). Wherever a route persists a caller-supplied id, ask what
   happens when that id already exists — and what state the overwrite erases.
9. **A report that is right on screen can be compensating for a ledger that never
   recorded the fact.** The VAT return derives its rate by dividing tax by base
   because no posted line carries a rate (D28); the balance sheet derives retained
   earnings because no year-end close ever posts it (D34). Both look correct and both
   mean the ledger alone cannot answer the question. When a report computes something
   the books should hold, that is the finding.

10. **Read every form field as "which entity does this bind to?"** A quote line let
   the user *type* an item name and invented the id `ITEM-1` behind it; the screen
   still called the real API, still returned 201, still passed typecheck, lint,
   build and its own tests. Any field naming a domain entity — الصنف، المستودع،
   الفرع، العميل، المورد، الحساب، مركز التكلفة — must be a picker over that
   entity's endpoint, and the stored row must carry that entity's **real id**.
   Check the id in the database, not in the UI: a plausible label is exactly what a
   fabricated id looks like from the front. Free text where the reference picks an
   entity is a defect even when everything downstream answers 200.
11. **Two numbers can disagree because they mean different things, not because
   one is wrong.** The receivables tile and the aging ladder differed by 5,486.12
   because one summed a subtree and the other counted trade AR; three "AP"
   figures differed because one followed invoices, one allocations, one the GL.
   Before hunting arithmetic, ask what each figure is a count OF — and when they
   should be the same fact, make them read the same source.
12. **A fix is not done until its assertion is flipped.** The suite documents
   open defects by asserting the broken behaviour. Leave that in place after a
   fix and the suite goes red for the wrong reason; delete it and the regression
   has no guard. Rewrite it to assert what now holds, and say which defect it
   guards.


## Non-negotiables in this codebase

- **Money is never a float.** `Money` is a bigint at scale 1e-6. Parse from strings
  (`Money.fromMajor("1250.50")`), never `Number(...)`, not even to build a display
  string — that is exactly how a notification once rendered `478.8`. Rounding happens
  only at four named boundaries (line extension, tax, discount allocation, landed
  cost) and allocations use largest-remainder so parts sum **exactly** to the total.
- **Every stock or cash movement posts a balanced journal entry.** A confirm that
  moves the sub-ledger and posts nothing is this app's most common bug class (D2,
  D3). Posted entries are immutable: correct by reversal, never by edit or delete.
- **No mocked data in application code, ever.** Fixtures live in
  `packages/backend/src/demo-seed.ts` behind `MEZAN_SEED_DEMO=1`, and screens read
  them through the real API. If an endpoint is missing, build the endpoint. An
  invented number is indistinguishable from a bug.
- **Empty states are real states.** Render zero honestly rather than something
  plausible.
- **Verify in the running app.** Automated business-logic tests are disabled by
  decision (`docs/testing-policy.md`); do not add or run them. Proof is `pnpm typecheck
  && pnpm lint && pnpm build`, then `pnpm smoke`, `pnpm check:seed` and `pnpm
  scenarios` — plus driving the real UI on a seeded backend and reloading the page,
  which is what catches "works until you look again".
- **The defect register is the only tracker.** Read its OPEN list before testing, and
  update it in the same commit as any fix. A fixed defect is never deleted — it is
  how its regression gets recognised.

## Before you touch a financial path

Ask these in order; each maps to a defect that already happened.

1. Which GL accounts move, and does the entry balance to the cent?
2. Which sub-ledger changes, and does it still reconcile to its control account?
3. What date does the movement carry — the document's, or `now()`? Stamping
   `occurredAt` with the wall clock let a replay consume stock before the receipt that
   funded it.
4. Is the period open, closed or locked? Locked is terminal.
5. Who is allowed to do this — permission code, role code, branch and warehouse
   scope, module entitlement? (Role codes and permission codes are not
   interchangeable; passing one where the other is expected silently disables the
   gate for everyone but the `"*"` admin.)
6. Does the document number come from the transactional counter, inside the same
   transaction as the insert?
7. What is the reverse of what you just built — return, void, reversal, unallocate —
   and does it restore both sides?
8. What **metadata** travels with the posting — currency and rate, tax rate, cost
   centre, branch? A zod wire schema strips unknown keys, so a dimension the client
   sends but the contract omits vanishes behind a cheerful `201`: that is how a
   voucher's cost centre (D26), a payment's withholding (D27) and every foreign
   currency (D24) disappear. If a report will need it later, the contract must carry
   it now.

## Working style the user expects

Full detail in `references/working-agreement.md`; the load-bearing parts:

- Land it correctly, then quickly. Parallelism is a means, not a goal, and token
  spend matters — no agent logs, no narration, short answers.
- Work on a worktree branch; no `Co-Authored-By` trailers.
- Arabic-first RTL UI. Domain refusals must surface in Arabic, not raw English
  enum text.
- Browser work goes in this session's dedicated Chrome tab group, never the user's tabs.
- Design authority is `design/mezan-enhanced-mockups.html`, served over HTTP.
- Never name or reference the competing product the catalog was captured from.
