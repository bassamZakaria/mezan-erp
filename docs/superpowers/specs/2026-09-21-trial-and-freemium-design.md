# Free trial and freemium — design and decision

**Date** 2026-09-21 · **Decision** DEC-31 · **Status** decided, building

Asked for: "allow a free trial and a freemium option for features". What exists today, and the
three ways to get from there to what was asked.

## 1. What already exists

- A plan carries `trialDays` (14 on all three seeded plans), and a subscription can start
  `trialing` with a `trialEndsAt`.
- Entitlements are **modules + boolean features + seats, branches and warehouses**. There are no
  usage quotas (no "documents per month") and no free plan — the cheapest plan is 490 EGP/month.
- **When a trial ends, the whole tenant goes `READ_ONLY` (`TRIAL_ENDED`).** The owner can read
  their books and cannot record a sale until they pay.
- A locked module answers `403 MODULE_NOT_LICENSED` to every route, reads included.

## 2. Three ways to build it

```
 A · TRIAL → PAYWALL            B · FREEMIUM + FEATURE TRIALS     C · REVERSE TRIAL (chosen)
   (today, plus a free plan)

 sign-up                          sign-up                           sign-up
   │                                │                                 │
   ▼                                ▼                                 ▼
 14 days on a paid plan           Free, for ever                    14 days on the TOP plan
   │                                │  └─ "try HR for 14 days"        │  everything unlocked
   ▼                                │     per module, once            ▼
 READ-ONLY until paid             ▼                                 drops to Free — still
   (or pick Free by hand)         pays to lift a limit                 working, within limits
                                                                     │  └─ per-module trials
                                                                     ▼     still available
                                                                    pays to lift a limit

 The owner meets the product      The owner never sees what the     The owner uses the whole
 whole, then is LOCKED OUT of     paid plans do unless they go      product first, and is never
 their own books. Conversion by   looking. Conversion by hitting    locked out of their books.
 hostage.                         a wall.                           Conversion by missing what
                                                                    they had.
```

**The difference that decides it is what happens on day 15.** In A the books freeze — for an ERP
that is the owner's own legal records held behind a paywall, and the support ticket writes
itself. In B nobody ever discovers the paid modules. C gives the full product first and then
leaves the owner on a free tier that still records sales, so their books are never hostage.
Zoho Books (free plan plus a trial of paid tiers) and Odoo ("one app free") are the Egyptian-market
reference points; the reverse trial is what Notion and Canva moved to for the same reason.

## 3. The rules

1. **Sign-up starts a 14-day reverse trial on the top public plan.** No card.
2. **Day 15: the tenant drops to the Free plan, not to read-only.** `TRIAL_ENDED` stops being a
   lock; it becomes a transition.
3. **Free is a real plan, free for ever**, with limits held on the plan so the platform console
   can change them — initial values, a business call rather than a fact:
   core modules (accounting, sales, purchases, inventory, treasury); **2 users, 1 branch,
   1 warehouse; 100 sales invoices a month**.
4. **Per-module trial.** On any paid plan or on Free, a locked module can be tried for 14 days,
   once per module per tenant, from the web billing screen.
5. **Nothing is ever deleted and nothing already recorded is ever hidden.** A module that leaves
   the plan becomes **read-only**, not forbidden: its data can be read and exported. A resource
   over the new limit (a third user, a second branch) stays readable; only new writes that depend
   on it are refused.
6. **Limits apply to creating new things, never to finishing old ones.** A quota never blocks a
   return, a void, a collection against an existing invoice, the e-receipt of a sale already
   recorded, a period close, or an export. The ETA obligations of a recorded sale are always met.
7. **Every refusal names the limit** in Arabic and English, and — on the web only — where to lift it.
8. **The phone never sells.** It may show "trial ends in 5 days" and "not in your plan — ask your
   administrator"; it never shows a price, an upgrade button or a link to buy (Apple 3.1.3(f)).

## 4. What it costs and what it risks

- **Apple 3.1.3(c).** A free tier an individual can start, then pay for on the web, strengthens
  the case that this is a consumer sale that should use in-app purchase. §3.5 already flags the
  web sign-up; freemium raises the stakes. The submission rests on 3.1.3(f) and keeps rule 8.
- **Abuse.** Trial → add twenty users → drop to Free and keep them. Rule 5 answers it: over-limit
  users cannot sign in; the admin picks which ones stay active within the free seat count.
- **Revenue.** Some tenants will live on Free for ever. That is the point of freemium; the 100
  invoices a month is where a real shop outgrows it.
