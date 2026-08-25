# Zemam (زمام) — reference product intel

Captured 2026-08-22 from the public marketing site `getzemam.com` and the
login page of `staging.getzemam.com`. The staging app itself is credential-gated
and was **not** entered — no login was attempted, so everything below is from
public marketing pages, not from inside the product. Treat it as the vendor's
own claims, not verified behavior.

This is the product Mezan's `docs/catalog/` was recon'd from, and the "competing
Egyptian ERP" whose module pricing appears in `docs/plan.md`. The pricing there
matches this site exactly, so the plan's competitive section is current.

## Positioning

Cloud, Arabic-first ERP for Egyptian SMBs. The headline claim is a **single
double-entry ledger as the source of truth** — marketing leans hard on
"most small-business systems in the region are just invoice front-ends; ours
posts a balanced journal entry automatically for every operation". They show a
real posted JE (receivable / revenue / VAT 14%) on the homepage as proof.

Trial: 14 days, no credit card. Annual billing = two months free.

## Login shape

`رمز المنشأة` (company code, placeholder MAIN) + email + password. Matches the
tenant-resolution shape recorded in `docs/plan.md` §1.

## Modules (their packaging)

**Core, always included:** Accounting & Treasury, Sales & CRM, Purchases,
Inventory — 1,500 EGP/month.

**Paid add-ons (EGP/month):** POS +500, Manufacturing +500, AI Assistant +500,
HR & Payroll +400, Installments & Cheques +250, Multi-currency +200, Fixed
Assets +200, Loyalty Points +150.

**Capacity axes priced separately:** full seats (3 included), branches (1
included), warehouses (1 included), POS terminals (0, requires the POS module).

**Persona bundles** on top: Manufacturing 2,000 · Retail & F&B 1,792 ·
Wholesale & Distribution 1,625 (marked "most popular"). Every bundle is
described as editable — drop a module and the price updates live. There is an
interactive plan calculator on the pricing page.

## Capability claims worth noting

- **Inventory:** multi-UoM, **WAC *and* FIFO** valuation, batch/expiry tracking
  with **FEFO**, transfers, adjustments, physical count, landed cost.
- **Sales:** quotations, price lists, **tiered quantity pricing**, leads and
  pipeline, 360° customer view, delivery + cash-on-delivery collection.
- **Wholesale:** **live credit decision at the point of sale**, full cheque
  cycle, aging.
- **Van sales:** every van is a mobile warehouse; the rep sells, collects and
  accepts returns from the phone; route recorded; daily close with count and
  cash reconciliation.
- **Contracting:** BOQ, quantity surveys, progress certificates with retention,
  advance recovery and tax, per-project profit from the ledger.
- **Restaurants:** table mode, live kitchen display, bill splitting, own-fleet
  delivery with tracking.
- **POS:** desktop app, offline with sync, delivery routing, driver app; one
  device included with the module.
- **Three clients, one system:** web (full system), mobile (reps and managers —
  approvals, field sales), POS desktop (offline).
- **AI assistant over MCP** — they advertise connecting **ChatGPT and Claude**
  directly to the tenant's live data to answer natural-language business
  questions, permission-scoped. Sold as a +500 module.
- **Notification rule engine** shown visually: event → recipient → channels
  (in-app, email, **WhatsApp**) → priority, with branded email templates, and
  claimed to work with no complex setup.
- **Security marketing:** role permissions, **optional per-action approvals**,
  full audit log, automatic backup, tenant isolation.
- **ETA e-invoicing:** shipped, with test and production environments and
  automatic submission on confirmation, plus a published integration guide.
- **Published roadmap with honesty framing:** automatic bank feeds, open API,
  and self-signup + online payment are all listed as "coming soon".

## Verticals they market (13)

Retail · Wholesale & distribution · Restaurants & cafés · **Clubs with multiple
cafeterias** · Real-estate marketing & development · **Auto parts** · Van sales
& distribution · Pharmacies · Contracting & projects · Manufacturing · HR &
payroll · Inventory · ETA e-invoicing.

They also publish an explicit **"we may not be the right fit"** list: complex
multi-entity global integrations, and highly specialized sectors (medical,
advanced banking).

## Go-to-market surfaces Mezan has no answer to yet

- **Academy**: practical accounting articles in Egyptian colloquial Arabic,
  positioned as useful whether or not you buy.
- **Accounting-office page**: "run more clients with the same team".
- WhatsApp as a first-class contact channel on every page.
- A live pricing calculator that lets a buyer self-qualify before talking to
  sales.

## The three gaps `docs/plan.md` flagged as "possible catalog gaps" are real

FEFO, BOQ/progress-certificates/retention, and own-fleet delivery tracking are
all marketed features here. They are competitive requirements for the pharmacy,
contracting and restaurant segments, not optional depth.

## Where Mezan still differs structurally

Zemam is **cloud SaaS**; only its POS is offline-capable. Mezan's entire desktop
edition runs with no internet at all, and is licensed offline rather than
subscribed. That remains the real differentiator — not feature count.
