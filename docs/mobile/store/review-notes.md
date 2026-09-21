# Review notes and sign-in details

Pasted into App Store Connect → App Review Information, and Play Console →
App content → App access. Google requires them in English; Apple accepts
English. `{…}` values come from the deployed reviewer environment
(`docs/DEPLOY-REVIEW.md`) and are filled in at submission time — the PIN is a
secret and is never committed.

## Sign-in details

| Field | Value |
|---|---|
| Server address | prefilled by the app — `https://review.mezan.app/api` |
| Company code | `{REVIEW_TENANT_CODE}` (the runbook's default is `review`) |
| Email | `admin@cyag.example` |
| PIN | `{REVIEW_PIN}` — read from SSM `/mezan/review/review-pin` |
| Second account, for clock-in with a photo | `ahmed.shennawy@cyag.example`, same PIN (the seed records a full day for this employee on the date the tenant is seeded, so the photo path opens from the next day — D337) |

Google: App access → "All or some functionality is restricted" → add the
instructions below; the company code goes in "Any other instructions", since
the sign-in has three fields.

## Notes (English, both stores)

> Mezan is a business (B2B) app. It is the phone companion to Mezan, an
> accounting and business-management system that companies buy under a
> business agreement outside the app. Accounts are created by each company's
> own administrator; the app has no sign-up, no purchasing, and no link to
> any purchase.
>
> To sign in: leave the server address as prefilled, enter company code
> `{REVIEW_TENANT_CODE}`, email `admin@cyag.example` and PIN `{REVIEW_PIN}`.
> This is a demonstration company filled with sample data; you may create
> invoices, quotations and collections freely. The account is permanent and
> is not reset between reviews.
>
> Every feature is reachable from this account: Overview (home tab), Sell
> (create a sales invoice or quotation), Customers, Stock (search, or scan a
> barcode with the camera), and under More: Collect (a collection voucher),
> Clock (attendance) and Approvals.
>
> Clock: the administrator account is linked to an employee record, so
> "Clock in" and "Clock out" work from it directly. To see the clock-in photo,
> sign out (Overview → Sign out) and sign in as `ahmed.shennawy@cyag.example`
> with the same PIN; that employee's record requires a photo, taken with the
> front camera only when you tap "Take a selfie".
>
> Camera: used for the clock-in photo and for barcode scanning. Face ID: used
> only to unlock the app on the device; no biometric data leaves the phone.
>
> Privacy policy: https://review.mezan.app/legal/privacy?lang=en
> Account deletion: https://review.mezan.app/legal/account-deletion?lang=en
>
> Sign in with Apple is not offered because the app signs in only with the
> company's own account system for existing business accounts (Guideline 4.8).

## Answers to expect questions on

- **Guideline 3.1.1 / 3.1.3** — the company contracts outside the app; the app
  unlocks nothing and links to no purchase. The readiness check fails on any
  pricing, subscription, checkout, upgrade or sign-up string in
  `apps/mobile/src`.
- **Guideline 5.1.1(v)** — the app does not support account creation, so
  in-app deletion is not required; a deletion request page exists anyway.
- **Guideline 2.1** — the reviewer environment is always on (no cold start),
  keeps its data on a persistent disk, and has no password prompt in front of
  it.

## Before pasting — verify on the day

1. `curl -sS -o /dev/null -w '%{http_code}\n' https://review.mezan.app/healthz` → `200`.
2. Sign in on a release build with the credentials above; walk every tab.
3. Sign in as the employee; confirm the clock-in button is enabled today (the
   seed records a full day for the seeding date only).
