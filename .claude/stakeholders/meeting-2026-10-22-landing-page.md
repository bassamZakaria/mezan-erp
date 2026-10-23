# Stakeholder meeting — public landing page with pricing (2026-10-22)

**Subject:** a public marketing landing page with pricing for the cloud edition at https://mezan.cyag.net.
**Panel (independent, parallel):** ceo-founder, cfo, legal-compliance, marketing, designer, ux-writer, owner (buyer), client-accounting-office (buyer), plus a competitor-research agent (live pricing pages, seen 2026-10-22).

## Verdict

Go, shrunk: one Arabic-first page, one primary action («ابدأ التجربة المجانية» → `/signup`), prices read live from `GET /api/signup/plans`. Lead with the trust promise (14 days of everything, no card, then a working Free plan; your books are never locked), not with price. Legal says do not make it public until the Terms of Service exist and the privacy-policy placeholders are resolved.

## Competitor facts (research, 2026-10-22)

| | Mezan (monthly / yearly÷12) | Daftra (monthly / annual-billed) | Wafeq (EGP) | Others |
|---|---|---|---|---|
| Entry | 490 / 408 | 733 / 489.5 | 966 / 805 | SMACC ≈7,190 (USD); Edara ≈2,700; Odoo ≈1,340 |
| Mid | 980 / 817 | 1,225 / 977.58 | 1,386 / 1,155 | |
| Top | 1,960 / 1,633 | 2,448 / 1,960 | 2,490 / 1,991 | |

- plan.md §8 understated Daftra: 489.5/977.58/1,960 are its **annual-billed** rates. Mezan is 20–33% below Daftra on monthly billing and ~17% below on annual.
- Daftra hides users/branches per tier; offline POS is on every Daftra tier; Wafeq makes no ETA claim on its Egypt pages; Qoyod is still "coming soon" in Egypt; Zoho has no Egypt edition.
- New: **DEXEF** (Egyptian desktop, one-time 4,000–15,000 EGP + 15%/yr) is the only published benchmark for Mezan's desktop edition. KashBoss (unverified) is the only cloud product under Core.
- Patterns everyone uses: Arabic-first; "ابدأ مجانًا" + "بلا بطاقة"; secondary "talk to sales"; monthly/yearly toggle; "most popular" ribbon; WhatsApp button; compliance badges; customer counts and ratings.
- Gaps nobody fills: EGP prices **with** users/branches stated; a full offline back office; treasury/cheques/instalments on the pricing page; a data-ownership promise; a real Egypt-specific FAQ.

## Consensus (2+ roles)

> Note: the CEO, CFO, owner and marketing rounds read Daftra's annual-billed prices as monthly and concluded "we are not cheaper". Corrected by research: Mezan is 20–33% below Daftra on monthly billing and ~17% on annual. Price is a second argument, usable without naming anyone («أقل من الأنظمة السحابية المعتادة») per legal.

1. Lead with the reverse trial + Free plan + "never locked" (CEO, CFO, marketing, owner, research).
2. Prices live from `/api/signup/plans`, never hard-coded; show exactly what the API returns (CFO, CEO, designer, marketing).
3. No ETA e-invoicing "compliant/certified" claim — ROADMAP §4.4 (DEC-10) says do not claim it. The B2C e-receipt **may** be claimed (§4.4) (CEO, legal, marketing, accounting office).
4. "Works offline" only for the desktop edition (legal, marketing, CEO, ux-writer).
5. No data-in-Egypt claim (hosted in the EU); the buyer asks "where is my data" — answer honestly in the FAQ (legal, owner, marketing).
6. No fake logos, testimonials, customer counts, "unlimited", "free forever", refund or SLA promises (legal, CFO, marketing, CEO).
7. Desktop: no public price, a contact line (CEO, CFO, marketing). Owner dissents (see conflicts).
8. Real product UI as the hero visual, not illustration (marketing, designer, owner).
9. A visible WhatsApp/phone contact is the buyer's top proof need (owner, research); no number exists yet.

## Conflicts — need an owner decision

- **Desktop price:** "contact us" (CEO, CFO) vs a "starts from" price (owner: no price feels like "priced by how I look"). CFO's indicative range: one-time ≈12,000–15,000 EGP + ~20%/yr; DEXEF benchmark 4,000–15,000 + 15%/yr.
- **Register:** marketing drafted Egyptian colloquial; ux-writer says plain MSA to match the app and signup strings. Recommended: MSA.
- **Annual discount:** 2 months free (16.7%) vs competitors' 20–33%. CFO suggests testing ~25–30%. Prices are console-editable, so this is a console change, not page work.
- **Free plan generosity:** 100 invoices/month equals what Daftra charges 489.5 for. Confirm intentional.
- **Naming competitors:** legal advises no named comparison table (unfair-competition / trademark / Law 181/2018 risk). Use "typical cloud systems" or unnamed facts.

## Role-specific must-fixes

- **Legal (blockers before going public):** Terms of Service written and linked; privacy-policy `[[TODO]]`s resolved (legal entity, commercial register, contact, PDPC wording); VAT and renewal wording beside prices; backup location contradiction (policy says Contabo Object Storage, deploy uses Google Drive) — fix facts or policy.
- **CFO:** interim VAT line «الأسعار بالجنيه المصري، وقد تُضاف ضريبة القيمة المضافة وفق القانون»; no card-payment button/logos until Paymob live keys; no add-on prices until billing supports them.
- **CEO:** metric = verified signups that confirm a first sales invoice within 7 days; SMTP must be on or signup shows the verify link to the submitter.
- **Designer:** brand is Cyag blue (tokens.css), not teal+gold; `max-w-[560px]` signup shell too narrow → wider site layout; larger marketing type scale; no forced light theme; reduced-motion rule; pricing card ≠ selectable signup `PlanCard`; `/` route conflict.
- **UX writer:** reuse the app's strings («ابدأ التجربة المجانية», «بلا بطاقة ائتمان», plan names المجانية/الأساسية/الأعمال/المؤسسات, «الباقة» never «الخطة»); Western digits for prices; new strings go in `catalog.ts`.
- **Accounting office:** state only verified depth (GL, journal, fiscal periods with closed-period refusal, reversal-not-edit, trial balance, financial statements, cost centres, multi-currency/FX revaluation, bank reconciliation, VAT net payable); no partner programme — say so honestly; one tenant per client today.

## Positives

The reverse trial and Free plan are unique in the Egyptian market; Mezan is the only one stating EGP prices with user and branch counts; prices are below Daftra and Wafeq on every comparable tier.

## Open decisions (owner)

1. Desktop price shown or not. 2. WhatsApp/phone number and support email. 3. Terms of Service + privacy TODOs before launch. 4. Annual discount and Free quota. 5. SMTP on. 6. Paymob live keys.
