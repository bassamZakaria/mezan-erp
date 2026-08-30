# Mezan — the manual test plan, by the person who would run it

The automated suite proves the arithmetic and the wiring. This proves the
product. Each file below is written from one role's chair: what they would open
first, what they would refuse to sign, and the observation that looks like
success and is not.

Every scenario carries the same five parts:

| Part | What it holds |
|---|---|
| **Persona / permission** | who is doing this, and with which permission code |
| **Preconditions** | the seeded demo tenant (`MEZAN_SEED_DEMO=1`) plus whatever else must exist |
| **Steps** | one physical action per line, quoting the UI strings exactly |
| **Expected** | what the screen shows AND what must be true in the books |
| **False pass** | the reading that looks right and is not — a status that flipped with no journal entry, a tile that agrees only with itself |

## The plans

| File | Role | Scenarios | ID prefix |
|---|---|---|---|
| `tax-expert.md` | Egyptian tax specialist | 65 | `MTP-TAX-` |
| `warehouse-keeper.md` | أمين مخزن | 64 | `MTP-WHS-` |
| `procurement.md` | مسؤول مشتريات | 61 | `MTP-PUR-` |
| `treasury-cashier.md` | أمين الخزنة | 60 | `MTP-TRS-` |
| `accountant.md` | محاسب | 58 | `MTP-ACC-` |
| `sales-manager.md` | مدير مبيعات / مندوب | 56 | `MTP-SAL-` |
| `internal-auditor.md` | fraud and abuse | 54 | `MTP-FRD-` |
| `owner.md` | صاحب المنشأة | 47 | `MTP-OWN-` |
| `end-user.md` | the everyday operator | 45 | `MTP-USR-` |
| `chartered-accountant.md` | محاسب قانوني (external auditor) | 15 — incomplete | `MTP-CA-` |

## How to run one

1. `pnpm typecheck && pnpm lint && pnpm build` — a red gate makes every later
   reading untrustworthy.
2. A **fresh** seeded database, never a reused one:
   ```bash
   S=$(mktemp -d)
   MEZAN_SEED_DEMO=1 MEZAN_DB=$S/test.db PORT=3300 pnpm exec tsx apps/server/src/index.ts &
   ```
3. One tester, one backend, one database, one browser tab. Two testers sharing a
   tab produce confidently wrong results — this happened, and a 72-screen report
   had to be thrown away.
4. Work a whole file in order. A scenario may depend on what an earlier one
   created; none depends on another file.
5. Record the reading, not the verdict. "AR shows 5,486.12 where the tile shows
   0.00" is a finding; "receivables look wrong" is a feeling.

## What a failure becomes

A row in `../ROADMAP.md` §5.0, with the measured evidence and the file it lives
in. A fixed one moves to `../archive/defect-register.md` with the commit that
fixed it — never deleted, because a fixed defect is how its regression is
recognised.

## Gaps

Each file ends with what its role wanted and could not test, because no screen or
route exists for it. That section is the product backlog seen from the outside,
and it is worth reading on its own: thirty-seven entries across the ten plans,
including the daily cash close, supplier evaluation, purchase requisitions,
exception reporting, and an owner-facing licence screen.
