# Coverage — what this audit did and did not see

> **Archived 2026-08-29 — a point-in-time record, not current state.** Read `../ROADMAP.md`
> for what is built and open, and `../TESTING.md` for how it is verified. Paths cited
> below may name documents that have since moved; `README.md` in this directory maps them.


Run 2026-08-26, three rounds, all against a live authenticated session.

## Method

The skill's deterministic crawler was **not** used: the reference app's
`robots.txt` returns `User-agent: * / Disallow: /`, and the skill's operating
rules put a disallowed path out of scope and forbid routing around it. On the user's instruction
the audit was therefore carried out manually through the UI, in their own
already-authenticated browser session, applying the skill's method by hand:

- Round 1 — list-surface fingerprint of 101 reference routes vs 116 Mezan routes
- Round 2 — create forms, entity detail panels, tab walks, row menus
- Round 3 — brute-force interaction (every non-destructive control clicked, every
  dropdown enumerated, search probed), plus `fetch`/`XHR` instrumentation to capture
  the API surface

## Read-only posture

No write was performed on the reference. Controls matching the destructive
vocabulary — حذف، مسح، إرسال، ترحيل، اعتماد، تأكيد، موافقة، رفض، دفع، سداد، إقفال،
تسوية، عكس القيد، جرد، طباعة، تصدير، استيراد، خروج and their English equivalents —
were enumerated but never clicked. Inside an opened form or modal, only tabs,
disclosures and dropdown triggers were exercised; no submit control was ever
activated. The only network verbs observed were `GET`.

## Covered

| Layer | Count |
|---|---|
| Reference routes fingerprinted | 101 |
| Mezan routes fingerprinted | 116 |
| Reference create forms opened and field-listed | 12 |
| Reference entity detail panels walked tab by tab | 6 (sales invoice, purchase invoice, work order, item, customer, supplier, employee) |
| Reference modals/dropdowns enumerated | 20+ |
| Distinct reference API endpoints captured | 201 GET |

## Not covered — read this before planning against the spec

1. **Every write contract.** No `POST`/`PUT`/`PATCH`/`DELETE` was sent, so no request
   payload was observed. Create/confirm/void/allocate shapes in any spec derived from
   this run are **inferred from form fields**, not verified.
2. **Every state-changing flow.** Confirming an invoice, posting a journal, closing a
   period, allocating a receipt, running depreciation, submitting to ETA — all exist,
   all were left unexercised. "The feature exists; its behaviour is unverified" is the
   honest line for each.
3. **Roles other than this account's.** A single-role crawl produces a single-role
   spec. Anything gated to a role this demo account does not hold is invisible here.
4. **POS.** Nine screens plus two POS reports were deliberately skipped — descoped
   from Mezan v1.
5. **States absent from the reference's own seed data.** Cost centres, promotions,
   leads, projects, purchase orders, cheques and installments all render zero rows on
   that tenant, so their populated behaviour — row menus, drill-downs, totals — could
   not be observed at all.
6. **`/inventory/physical-counts/new`** errors out on the reference and renders only a
   retry control; the physical-count creation flow is unmapped.
7. **Detail pages that do not exist.** Assets have no detail page on the reference, so
   there is nothing to compare our asset card against.
8. **Print output.** Print controls were on the skip list, so no rendered document was
   inspected.
9. **Validation rules.** The reference's forms carry almost no HTML validation
   attributes — the sales-invoice form has no `required` at all, only a `min` on the
   due date. Its validation is entirely in JavaScript and is therefore only observable
   by submitting, which read-only forbids. **Do not assume the absence of constraints
   means the absence of rules.**

## Confidence

| Area | Confidence |
|---|---|
| Screen and route inventory | High — enumerated from the live nav DOM twice |
| List columns, chips, KPI labels, filters | High — read from rendered DOM |
| Detail-panel tab sets and actions | High |
| Create-form field lists | Medium-high — read from the rendered form; conditional fields that appear only after another field is set may be missing |
| API read contract | High for GET; **absent** for writes |
| Business rules and validation | Low — inferred, never exercised |
| Anything behind another role | None |
