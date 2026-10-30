# Mezan Mobile — iOS and Android, design and decision

**Date** 2026-09-20 · **Status** decided, building · **Decision id** DEC-30 · **Branch** `feat/mobile-app`

Mezan runs on a desktop that sits in the back office. The people who create most of the
company's documents — the sales rep in the car, the warehouse keeper at the bay, the owner
away from the shop — do not sit at that desktop. This is the design for the phone app that
reaches them, and the reasoning for the scope it has.

---

## 1. Who it is for

Judged against the five named target users, in the order the module earns its keep:

| Persona | What the phone gives them that the desktop cannot | Priority |
|---|---|---|
| **المندوب** — sales rep / van sales | Creating the quote, the invoice and the collection voucher at the customer's counter instead of writing them on paper and re-keying at 6pm | **v1** |
| **صاحب المنشأة** — the owner | Cash position, today's sales, receivables and the approvals waiting on them, from anywhere | **v1** |
| **الموظف** — any employee | Clock-in with the phone's own camera and fingerprint — the two device capabilities the web clock has to beg the browser for | **v1** |
| **أمين المخزن** — warehouse keeper | Barcode stock lookup at the bay | **v1 (lookup only)** |
| **المحاسب** — the accountant | Nothing. They have a desk, two monitors and a keyboard, and every study of ERP mobile use says they keep using them | **never** |

The accountant is deliberately not a mobile user. An app that tries to be the whole ERP on a
5-inch screen is how ERP mobile apps become unused.

---

## 2. Three ways to build it

```
  A · COMPANION                B · FIELD APP                C · OFFLINE-FIRST FIELD APP
  (read-only)                  (writes, online)             (writes, local mirror)

  ┌──────────┐                 ┌──────────┐                 ┌──────────────────────┐
  │  phone   │                 │  phone   │                 │  phone               │
  │  views   │                 │  forms   │                 │  forms → local SQLite│
  └────┬─────┘                 └────┬─────┘                 │         ↓ write queue│
       │ GET                        │ GET + POST            └────┬─────────────────┘
       ▼                            ▼                            │ sync, resolve
  ┌──────────┐                 ┌──────────┐                 ┌────▼─────┐
  │  server  │                 │  server  │                 │  server  │
  │  ledger  │                 │  ledger  │                 │  ledger  │
  └──────────┘                 └──────────┘                 └──────────┘
   one writer                   one writer                   TWO writers

  Ships fastest.               Ships in weeks.              Ships in months.
  Rep still re-keys at 6pm.    Rep needs a signal.          Rep needs nothing.
  Owner served. Rep is not.    Reads cached for the         Document numbers, period
                               dead-signal case.            locks and stock checks now
                                                            have to be decided twice,
                                                            and reconciled.
```

**The difference that decides it** is the bottom row. In A and B the server is the only thing
that ever writes to the ledger, so the fiscal-period lock, the transactional document counter,
the credit limit and the stock-availability check each exist once. In C the phone has to make
provisional versions of all four and then reconcile them — which means a number the client
supplied becomes a number the books trust, the exact shape of the worst defect this codebase
has ever had.

**Chosen: B.** Writes go online, and say so in Arabic when there is no connection. Reads are
cached so the app still opens and still shows yesterday's figures on a dead signal. Offline
writing is a later slice with its own decision, not a feature smuggled in under a spinner.

---

## 3. Architecture

```
  apps/mobile  (Expo · React Native · expo-router)
  ├── app/                     file-based routes, Arabic-first RTL
  ├── src/api/                 fetch client  ─── Bearer token + x-mezan-tenant
  ├── src/session/             expo-secure-store (token), SecureStore ≠ AsyncStorage
  ├── src/ui/                  native components on the Mezan tokens (#003ce1 on slate)
  └── src/i18n/                ar (default) · en
              │
              │  the SAME zod contracts the web client parses with
              ▼
  packages/contracts ──────────────────────────────────────┐
                                                           │
  ┌────────────────────────────────────────────────────────▼────────┐
  │  apps/server · cloud-app.ts   (tenant-routed HTTP API)          │
  │  POST /auth/login  → { token, permissions, branchScope, … }     │
  │  every call: authorization: Bearer <token>                      │
  │              x-mezan-tenant: <code>                             │
  │              x-branch-scope / x-warehouse-scope  (narrowing)    │
  └─────────────────────────────┬───────────────────────────────────┘
                                ▼
                        packages/domain · the ledger
```

Three things this buys:

1. **No second API.** The phone is one more client of the same routes, gated by the same
   permissions and the same module entitlements. A permission the rep does not hold hides the
   screen and refuses the call — the server decides, as it does for the web.
2. **No second contract.** `@mezan/contracts` is pure zod with no Node dependency, so the
   phone parses every response against the same schema the server validated it with. A field
   the contract omits cannot silently reach the phone either.
3. **No second money type.** `Money` is a bigint at scale 1e-6, and Hermes has BigInt. The
   phone never sees a float.

**Desktop-only tenants.** The desktop edition's LAN socket allow-lists five routes and is not
a general API, so v1 targets the cloud edition. A desktop shop reaches the app when it takes
the cloud edition — that is the honest sentence, and it goes on the sales sheet.

---

## 4. What is in v1

| Area | Screens | Writes? |
|---|---|---|
| **Sign in** | tenant code → email + password → session; biometric unlock on return | — |
| **Owner home** | cash on hand and at bank, today's sales, receivables ladder, approvals waiting | no |
| **Customers** | list, search, 360 (balance, aging, last documents) | no |
| **Sell** | quote → invoice, item picker over the real catalogue, price list and credit limit honoured by the server | **yes** |
| **Collect** | collection voucher against an invoice, cash or cheque | **yes** |
| **Stock** | barcode scan → item, on-hand by warehouse | no |
| **Clock** | حضوري — punch with camera frame and platform biometrics when the employee's record requires them | **yes** |
| **Approvals** | the workflow queue this user's role is an approver on: approve / refuse with a reason | **yes** |

Every entity field is a picker over that entity's endpoint and stores that entity's real id.
No screen types an item name into a text box.

## 5. What is deliberately not in v1

Offline writing · POS · the whole report catalogue (four figures, not thirty-three) ·
journal entry · payroll · manufacturing · contracting certificates · any screen an accountant
would rather do on a keyboard.

---

## 6. Release

Expo + **EAS Build** produces the `.ipa` and the `.aab` without a Mac build farm, and
**EAS Update** ships JavaScript fixes without a store review — which matters because the two
stores' review queues are the slowest thing in this plan. Store accounts, the Apple developer
membership and the Play console listing are the owner's to provide; the build works against
the simulator until they exist.

## 7. The risks, stated

- **A rep with no signal cannot invoice.** Accepted for v1, and the reason offline is slice 2.
- **Arabic RTL on React Native** is forced at the native layer (`I18nManager`) and needs a
  relaunch to take effect; the app does that on first run rather than rendering one screen
  the wrong way round.
- **Two stores, two review queues.** The first submission is the long one; budget for it.
