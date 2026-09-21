# App Privacy (Apple) and Data safety (Google) answers

Both forms are answered from the privacy policy served at `/legal/privacy`
(`apps/server/src/legal-content.ts`, `PRIVACY`), and each answer below quotes
the policy sentence it rests on. If a form and the policy ever disagree, the
policy is changed first and the form second — never the other way round.

The policy is a **draft that needs legal review**. Both forms go in only after
the owner has had it signed off.

## What the app actually does, from the code

| Data | Leaves the phone? | Where in the code |
|---|---|---|
| Company code, email, PIN | Yes, at sign-in | `apps/mobile/src/session/SessionProvider.tsx` (`POST /auth/login`) |
| Name, role, permissions, scopes | Received from the server, shown, kept on device | `apps/mobile/src/session/storage.ts` |
| Clock-in photo | Yes, only when the user taps capture and the company requires it | `apps/mobile/src/screens/clock/index.tsx` (`takePictureAsync`, `POST /hr/self/clock`) |
| Business records (invoices, quotes, vouchers, approvals, look-ups) | Yes | `apps/mobile/src/api/queries.ts` |
| Barcode frames | No — decoded on device, only the number is used | `apps/mobile/src/screens/stock/index.tsx` (`onBarcodeScanned`) |
| Face ID / fingerprint | No — the OS answers yes or no | `expo-local-authentication` (lane M2) |
| Session token | No — iOS Keychain / Android Keystore | `storage.ts` (`SecureStore`) |
| Cached reads, ≤ 7 days | No — AsyncStorage, erased on sign-out | `apps/mobile/src/api/query-cache.ts` |
| Location, contacts, photo library | Never read | no import of a location, contacts or media-library module |
| Analytics, crash reports, ads | None | no such SDK in `apps/mobile/package.json` |

## Apple — App Privacy

**Do you or your third-party partners collect data from this app?** Yes.

**Is data used to track?** No. Policy: "No advertising, no tracking of you
across other apps or websites, and no sale of your data."

| Apple data type | Collected | Linked to the user | Tracking | Purposes | Policy sentence |
|---|---|---|---|---|---|
| Contact Info → Name | Yes | Yes | No | App Functionality | "Your account profile: your name, email, role, permissions…" |
| Contact Info → Email Address | Yes | Yes | No | App Functionality | "Sign-in details: the company code, your email address and your six-digit PIN, to sign you in." |
| User Content → Photos or Videos | Yes | Yes | No | App Functionality | "Clock-in photo: … It is kept in your company's attendance records as evidence of attendance." |
| User Content → Other User Content | Yes | Yes | No | App Functionality | "Business records you enter: sales invoices, quotations, collection vouchers, approval decisions, and customer and item look-ups." |
| Identifiers → User ID | Yes | Yes | No | App Functionality | "the server records successful and failed sign-ins and sensitive actions, with the account and the time" |

Not collected: Health & Fitness, Financial Info (the user's own), Location,
Sensitive Info (biometrics never leave the device — "your biometric data never
leaves the phone and we never receive it"), Contacts, Browsing History, Search
History (item and customer searches are requests to the company's own records,
declared under Other User Content), Identifiers → Device ID, Purchases, Usage
Data, Diagnostics, Other Data.

**Privacy policy URL:** `https://{REVIEW_HOST}/legal/privacy?lang=en` (Arabic:
`/legal/privacy`).

## Google — Data safety

**Does your app collect or share any of the required user data types?** Yes.

**Is all of the user data collected by your app encrypted in transit?** Yes.
Policy: "Every connection between the app and the server is encrypted (HTTPS)."

**Do you provide a way for users to request that their data is deleted?** Yes —
`https://{REVIEW_HOST}/legal/account-deletion?lang=en`.

**Account creation.** Choose the option that the app does not allow users to
create an account (the company administrator creates it — policy: "You cannot
create an account inside the app"). Still give the deletion URL above. This
holds only while the app has no link to the web sign-up; the readiness check's
`no-purchase-path` rule fails the build on any `/signup` link.

**Shared with third parties?** No. The hosting provider stores data on our
behalf and is a service provider, which Google's form does not count as
sharing. Policy: "The hosting provider that stores the data on our behalf:
Amazon Web Services (AWS)…"

| Google category → type | Collected | Shared | Ephemeral | Required / optional | Purposes |
|---|---|---|---|---|---|
| Personal info → Name | Yes | No | No | Required | App functionality, Account management |
| Personal info → Email address | Yes | No | No | Required | App functionality, Account management |
| Personal info → User IDs | Yes | No | No | Required | App functionality, Account management, Fraud prevention, security, and compliance |
| Photos and videos → Photos | Yes | No | No | Optional — only when the user clocks in and the company requires a photo | App functionality |
| App activity → Other user-generated content | Yes | No | No | Required | App functionality |

Not collected: Location, Financial info, Health and fitness, Messages, Audio,
Files and docs, Calendar, Contacts, Web browsing, App info and performance
(no crash logs or diagnostics — "The app contains no third-party analytics or
crash-reporting tool"), Device or other IDs.

Google counts only data that leaves the device, so the Keychain token, the
AsyncStorage cache and the biometric check are correctly absent.
