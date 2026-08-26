# Mezan — open decisions

**The single list of decisions that block work but are not defects.** A defect
has a right answer and belongs in `defects.md`; a decision here has two or more
defensible answers, and each one changes a shared contract, so it is not a
one-line patch. Nothing else tracks these.

Updated 2026-08-25. Previously split between `STATUS.md` ("Decisions waiting on
you") and the retired `tasks.md` ("Open design decisions"), which disagreed with
each other.

## How to use this file

- **Taking a decision** → record the option chosen and why, move the row to
  DECIDED, and link the commit that implemented it. Do not delete it — the next
  person needs to know the alternative was considered and rejected.
- **A decision that turns out to have a right answer** → it was a defect. Move
  it to `defects.md` with measured evidence.
- Each entry states the options, not a recommendation dressed as a fact. Where
  one option has the smaller blast radius, that is said explicitly.

---

## OPEN

### DEC-1 — Workflow `minAmount` is configurable but never read

`/settings/workflow` stores and edits a minimum-amount threshold per gated
action, and the UI presents it as enforced. Nothing reads it at confirm time:
`DocumentWorkflowInput` (the shared type every gated document passes to
`workflow/gate.ts`) carries no amount field, so the gate cannot see the value it
is meant to compare against.

Fixing it means extending that port, which touches **every** gated document type
— sales invoices, sales/purchase returns, landed costs, vouchers.

| Option | Cost | Risk |
|---|---|---|
| Add an optional `amount` to `DocumentWorkflowInput` | Smallest change; every existing caller keeps compiling | Silently unenforced for whichever types forget to pass it — the same failure being fixed |
| Make it required | A change at each call site | None; the gap cannot reappear |
| Resolve the amount inside the gate from the document id | Callers untouched | Gives the gate a repository dependency it does not have, weakening its purity |

Until this is decided, the threshold field should be labelled as not yet
enforced rather than presented as active.

### DEC-2 — The gate expects role codes; two routes pass permission codes

`GateStep.role` is a **role code** — `gate.ts`'s own doc comment, its tests, and
the reference product's role picker all agree. But `sales-invoices-routes.ts`
and `vouchers-routes.ts` pass `ctx.permissions` (the resolved *permission* set)
as `actorRoles`. A role code is never a permission code, so a role-gated step
configured through `/settings/workflow` can only be satisfied by the
company-admin `"*"` bypass through those two handlers.

The approvals endpoints resolve the real role code via `uow.users` → `uow.roles`
and behave correctly, so the two sides currently disagree.

| Option | Effect |
|---|---|
| Fix the two routes to resolve the actor's role before calling the gate | Keeps gate semantics as documented; the approvals endpoints already prove the lookup path. **Smaller blast radius, and matches what the type already claims.** |
| Let the gate accept either, matching a step against roles *or* permissions | No route change needed, but broadens the meaning of every existing gate configuration |

### DEC-3 — `recordPayment` and the allocation sub-ledger are two stores of the same fact

Tracked as **D1** in `defects.md`, with a reproduction. The UI prefers
allocations and the aging reports take the larger of the two, but the backend
can still record one collection twice. Converging `recordPayment` onto
allocations removes the fallback entirely — the decision is whether to do that
migration now or keep the two-store read-preference until the collections screen
is rebuilt.

### DEC-4 — The promotion discount reduces the revenue credit

Surfaced when promotions were persisted onto documents, and deliberately not
taken then: the discount currently reduces the revenue credit rather than
posting to a contra-revenue "discounts granted" account. That is a
chart-of-accounts call, not an application-code call — it changes what the
income statement shows for gross revenue.

### DEC-5 — The purchase chain emits no events

This build emits **5 of the 39 catalogued events**. The number is derived live
from the bridge mappings in `create-backend.ts`, and
`/notification-rules/triggers` and `/webhooks/events` agree with it exactly. The
purchase order/receipt/invoice chain publishes nothing because it is not a
`DocumentService` and so has no `DocumentEventPublisher`.

The decision: route the purchase chain through `DocumentService`, give it a
publisher of its own, or accept that purchase events cannot be subscribed to.
Inventing bridges for it without deciding was declined.

### DEC-6 — Leave-policy presets carry inferred statutory numbers

Annual 21 and sick 180 are solid; **casual 7 and paternity 1 under Law 14/2025
are the least certain** and want a legal review before release. Each line cites
its article. Not an engineering decision — it needs someone who can read the
law.

### DEC-7 — Sales-by-salesperson needs a schema change, not report code

The report needs a rep field on sales invoices. Adding it is a schema migration
plus a field on every invoice-creating surface; the alternative is deriving the
rep from the document's `createdBy`, which is the person who typed it, not
necessarily the person who sold it.

---

## Longer-standing product decisions

These predate the build and are carried in `backlog.md` §5 and `plan.md` §6.3;
none of them blocks ongoing development, but each blocks calling its specific
issue done: licensing mechanism finalization, the installment late-fee rule,
FIFO-in-v1 scope, delivery notes, branch-scoped numbering, lead → opportunity
conversion mechanism, projects progress billing (مستخلصات), and a third locale.

---

## DECIDED

| # | Decision | Taken |
|---|---|---|
| — | **Purchase receipt/invoice cancel routes 404** — turned out to be a defect, not a decision: `create-backend` now passes `purchases.layers`, which mounts both. Cancelling a confirmed invoice marks the original entry `reversed` and posts a linked mirror entry, and an invoice whose goods were already sold is refused with `PURCHASE_ITEMS_ALREADY_CONSUMED`. | 2026-08-25 |
| — | **Promotions persisted onto documents** as a value snapshot, not a foreign key, so a campaign edited later cannot retroactively change what a historical invoice says it granted. Evaluated server-side at confirm against the invoice's real lines. | 2026-08-25 |
| — | **`AuditEvent` carries `branchId`**, recorded from the scope the shell already sends and filterable in the viewer. Historical rows stay null: the table is append-only by trigger, so a back-fill is impossible by design and a default would fabricate evidence. | 2026-08-25 |
| — | **Automated business-logic test execution is disabled** in favour of live verification against a seeded backend. Reversible; the reasoning and the replacement are in `testing-policy.md`. | 2026-08-23 |
