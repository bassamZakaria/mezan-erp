# Reference parity — عروض الأسعار (Sales Quotes)

**Method.** Enumerated from the running reference product on 2026-08-25 by
driving its own `/sales/quotes`, `/sales/quotes/new` and a quote detail page in
a browser and reading the DOM — not from `docs/catalog/`. The catalog records
labels; a label cannot tell you whether الصنف is a picker over the item
catalogue or a text input, which is exactly the defect that made this pass
necessary (F34 / D38 in `docs/defects.md`).

Re-run this enumeration before changing the screen. Credentials are the user's
to enter; ask them to sign in on the session's own browser tab.

---

## What the reference has, and what we now have

### List

| Reference | Mezan | Note |
|---|---|---|
| Header KPIs in **money**: total / accepted / converted value | ✅ | was three counts |
| Draft-count card | ➖ | counts live on the status chips instead |
| Free-text search (quote no. or customer) | ✅ | client-side; server has no `?q=` (D32) |
| Filter panel: branch · customer · date from · date to · Clear | ✅ | client-side |
| Status chips incl. **Expired** | ✅ | expired is derived, not stored |
| Columns: number (+customer +date) · expiry (+"expired N days ago") · total · status · **created by** | ⚠️ | created-by missing — the quote record carries no `createdBy` |
| Row action: "Send to Customer" on drafts · ⋯ menu (View / Print) | ⚠️ | send + view present; **no print** |
| Sortable column headers, rows-per-page selector | ⚠️ | pagination yes, sorting/page-size no |

### New quote

| Reference | Mezan | Note |
|---|---|---|
| Own route `/sales/quotes/new`, header actions Cancel / Save as Draft | ✅ | `#/sales/quotes/new` — hash routing, since the desktop edition loads from `file://` |
| Customer combobox (name + code) | ✅ | |
| **Amount owed** shown once a customer is picked | ✅ | from `/reports/aging/customers` |
| Branch select (required) | ✅ | was hardcoded `"BR1"` |
| Date, Expiry date | ✅ | native date inputs |
| Currency select | ✅ | base + the customer's own currency |
| Lines: item picker (name + code), qty, unit price, line total + tax badge | ✅ | price seeded from the customer's price list, else the item's sale price |
| Per-line expander: discount (% / amount), tax %, **line notes** (500 chars) | ⚠️ | discount % and tax % yes; **amount-discount and line notes need backend fields** |
| **Out of stock** warning on a line | ✅ | from `/inventory/stock-balance`; shows on-hand otherwise |
| Add line | ✅ | |
| Pricing adjustments (percentage / fixed amount) | ✅ | |
| Notes · Internal notes ("not visible on printouts") | ✅ | |
| Summary aside: price list · subtotal · tax · grand total | ✅ | |
| **Attachments** (upload file) | ❌ | no attachment store exists anywhere in Mezan |

### Detail

| Reference | Mezan | Note |
|---|---|---|
| Header: number + status pill + customer; Edit; More (Print / Delete); Share when converted | ⚠️ | **no edit, no print, no share**; cancel replaces delete (posted documents are never deleted here) |
| Status explainer banner | ✅ | as the "next step" card |
| Summary strip: customer · date · expiry (+expired flag) · branch · total | ✅ | plus currency |
| Next-step CTA | ✅ | send / accept / reject / convert, by status |
| 4-step progress: Draft → Sent → Accepted → Converted | ✅ | `DocumentStatusStepper` |
| "What will happen?" / "Effects of this quote" — 3 cards | ✅ | |
| Tabs: Quote Details · Attachments · Audit | ⚠️ | details + audit; attachments missing |
| Line table: item (+image, SKU) · qty (+unit) · unit price · discount % · tax % · total | ⚠️ | all but the **item image** (items carry no image field) |
| Totals: subtotal · tax · grand total; notes below | ✅ | |
| Converted: "Invoice created successfully" + **View Invoice** | ⚠️ | shows the invoice id; the deep link to `#/sales/sales-invoices/<docNo>` is not wired yet |

---

## Backend work the remaining gaps need

1. **`createdBy` on a quote** — domain `SalesQuote` has `createdAt` only; the
   service already receives an `actor`. Column + serializer + list column.
2. **Line notes** — `sales_quote_line` has no notes column; contract, domain
   line, SQLite table and serializer all need it (and a migration path for
   existing files, since the schema is `CREATE TABLE IF NOT EXISTS`).
3. **Line discount as an amount** — the domain line carries `discountPercent`
   only. Adding an amount variant touches `computeQuoteTotals` and its
   largest-remainder allocation; do it there, never by converting to a percent
   in the UI.
4. **Attachments** — no store, no route, no UI anywhere in the product. This is
   a module, not a field.
5. **Print** — `print-template-config` exists with a quote template; nothing
   renders a document to it.
6. ~~**URL routes per document**~~ — done: `apps/web/src/routing.ts` +
   `useSubPage()`. Remaining: link the converted quote to its invoice page, and
   convert the document screens not yet swept (see the F36 register entry).
7. **Server-side item validation** — D38: `itemId` is `z.string().min(1)` with
   no item repository on the route. Sales invoices share the hole.
