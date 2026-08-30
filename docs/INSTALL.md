# Mezan — install, rollout and recovery

**For the person standing at a client's counter, not for a developer.** `README.md` is
dev-setup (`pnpm install`, a Vite dev server, an in-memory database). This is what to do
with a real packaged build, on a real machine, with a real business's books on it.

Companion reading: `ROADMAP.md` §5.2 lists what is open by decision rather than by defect —
read it before you promise a client something this build does not yet do. `TESTING.md` §2.2
and T69 are the same ground from a tester's side, with the exact commands.

---

## 1. First run on a packaged build

### 1.1 There is a seeded account, and it is not yours to give the client

Every empty database — packaged or not — seeds one fallback company-admin account so a
brand-new install is never account-less: `admin@cyag.example`, fixed id `USER-ADMIN`
(`SEED_ADMIN_USER_ID` in `packages/backend/src/seed.ts`). The id is fixed and never edited;
the email and status are ordinary master data an admin can change later, which is why the
product answers "has this tenant been claimed" from a recorded fact and not from that
account's email — see §2.

**On a packaged build, that account's PIN is random and printed nowhere** —
`resolveSeedAdminSecrets()` in `seed.ts` generates it with the same CSPRNG the session
tokens use, and does not hand it to you. "Packaged" here means `MEZAN_PACKAGED=1` (set by
`apps/desktop/src/main/index.ts` from Electron's own `app.isPackaged`) **or**
`NODE_ENV=production` — the desktop build and a headless server deployment both get the
random path. That second condition was narrowed away once, on the reasoning that only the
desktop edition has a first-run wizard to recover through, and put back deliberately: the
alternative is a container or `apps/server` box silently seeding an admin nobody can ever log
in as, which is worse than a server build sharing the published `123456`. `apps/server/src/
index.ts` prints a freshly generated PIN once, to the console, on the run that seeded it —
the desktop shell's `recovery-pin.txt` and `--reset-admin` (§1.4) are both desktop-only and do
not exist on this surface, so watch the console on that first run or set
`MEZAN_SEED_ADMIN_PIN` (§1.3) before it. This is
deliberate, and it is the fix for a real
defect (S7): before it, every Mezan install in the country shipped with the same seeded PIN
(`123456`, the one every dev script and this doc's own test-plan section signs in with —
see `TESTING.md` §2.2), so an anonymous caller who knew that PIN held the company admin of
*any* Mezan install reachable on its shop wifi. **Do not try `123456` on a packaged build —
it will not work, and it will not tell you why**: the login route answers a wrong PIN and an
unknown account with the identical `INVALID_CREDENTIALS`, on purpose (`packages/backend/src/
auth-routes.ts` — an unknown-account response is hashed against a decoy so response time
gives nothing away either).

### 1.2 The path you are meant to take: the first-run wizard

Do not chase the seeded account. On first launch of a fresh install, the login screen reads
`GET /bootstrap/status`, sees `claimed: false`, and opens the first-run wizard AS the screen —
not a login form with a wizard link tucked into it. That distinction is itself a fixed defect:
a fresh install used to land on an ordinary login form with an empty account list and a blank
email box, no indication the machine had never been set up, and the wizard reachable only
through a small link at the bottom — the natural first move was to type the owner's own name,
fail five times, and land in a lockout on a brand-new install within ninety seconds. The wizard
has four steps (`apps/web/src/login/FirstRunWizard.tsx`):

1. **Activate the licence** — the entitlements source for this install (see §6 for what is
   and is not verified here today).
2. **Administrator account** — `POST /bootstrap/admin` with the owner's real name (Arabic
   and, optionally, English), a real email, and a PIN **they** choose. This call also
   idempotently seeds the empty database (chart of accounts, VAT, the main branch and
   warehouse, fiscal periods) if nothing has run `POST /bootstrap/seed` yet.
3. **Core data** — confirms/re-runs the same idempotent seed and shows what exists.
4. **Import** — hands off into the data migration wizard, §3 below.

After step 2, the seeded fallback account (`USER-ADMIN`) still exists in the database, PIN
unknown to anyone. It is not deleted and does not need to be — it plays no further role once
a real admin exists, and the product does not distinguish it from any other inactive-in-
practice account. Do not go looking for a way to "finish setting it up"; there isn't one, and
there does not need to be.

### 1.3 Scripted or unattended rollout: `MEZAN_SEED_ADMIN_PIN`

For a rollout where the wizard's random PIN is inconvenient — a scripted deployment across
several machines, or a QA pass against a packaged build where you need a known credential —
set `MEZAN_SEED_ADMIN_PIN` to a six-digit string **before the process that first seeds the
database starts**. `resolveSeedAdminSecrets()` reads it and pins the fallback admin's PIN to
that value instead of generating one; it does not affect anything after the wizard has
already claimed the tenant. `MEZAN_SEED_ADMIN_PIN` set to anything that does not match
`^\d{6}$` is ignored, silently, and a random PIN is generated as usual — check it took by
confirming you can sign in as `admin@cyag.example` with it before you walk away from the
machine.

This is not a substitute for §1.2. It exists so *you*, the person running the rollout, have
a known door in while you drive the wizard — not so the client's till ships with a shared PIN
across sites again. Do not leave `MEZAN_SEED_ADMIN_PIN` set in an image or script that
multiple client machines are provisioned from unless every one of those machines is meant to
share that PIN until someone runs the wizard on it — which is exactly S7, reintroduced by
policy instead of by bug.

### 1.4 The recovery file, and what happens if nobody knows a PIN for this machine

Both pieces the security review called for now exist and are wired into the desktop shell
(`apps/desktop/src/main/recovery.ts`, called from `main/index.ts`):

- **`recovery-pin.txt`, written beside the database, owner-only (`0600`) permissions.** On the
  launch that actually generates a random admin PIN — i.e. the first launch that seeds an
  empty tenant on a packaged build (`takeSeededAdminSecrets()` returns a one-shot,
  `generated: true` result exactly once) — the shell writes this file next to `mezan.db`, with
  the PIN in both Arabic and English, and also prints the PIN to stdout as a fallback for the
  one failure this can't protect against: a first launch that cannot write to its own data
  directory at all. **Read this file, or the console, once, then finish the wizard.**
- **The file deletes itself.** On every subsequent launch, if nothing was freshly generated
  that run, the shell calls `clearRecoveryPinIfClaimed()`, which checks the same
  `settings.tenantClaimedAt` fact §2 relies on and removes the file the moment it is true —
  i.e. the moment the wizard has actually run and a real admin exists. Do not rely on the file
  surviving past that point; if you need the generated PIN for a record, copy it out before
  finishing the wizard.
- **`--reset-admin`** mints a fresh random PIN directly against the seeded admin account
  (`SEED_ADMIN_USER_ID`) and writes it into a NEW `recovery-pin.txt` (reason `"reset"`), then
  prints it and exits. Run it as `<mezan-binary> --reset-admin` against a packaged install with
  its database on disk — it refuses to run against the in-memory dev database, and it exits 1
  with a clear message if the target database has no seeded admin row at all (an empty or
  not-yet-created database — there's nothing to reset there). **If the seeded admin account
  had been deactivated — which happens, because one company admin may deactivate another and
  a shop can walk itself down to zero working logins by accident — the reset also reactivates
  it**, and says so in its output; a reset that leaves the door locked from the inside is not a
  reset.

**Both doors are authorised by filesystem access to the database directory, and only that.**
There is no permission check, no session, nothing reachable over the LAN socket, IPC or the
renderer — deliberately: whoever can read that directory already holds the unencrypted SQLite
file with the full customer list, every price and every salary in it (§7), so refusing them a
PIN reset protects nothing they could not already take, and would only cost the install. Do
not read this as a general precedent — it is specific to a machine's own local disk, not a
statement that permission checks elsewhere are optional.

**With both of these landed, §1.3's `MEZAN_SEED_ADMIN_PIN` is now a convenience for a known
credential during a scripted rollout, not the only way back in.** A genuinely locked-out
packaged install — nobody captured the recovery file, nobody set the env var in advance — is
recovered with `--reset-admin`, run on that machine, by whoever has a terminal on it.

---

## 2. Claiming the tenant, and what happens on a retry

`POST /bootstrap/admin` is intentionally open to an unauthenticated caller — on a genuine
first run there is nobody to authenticate as yet. What stops it being a standing door is that
the moment a tenant's claim is **recorded**, the route refuses everyone, permanently:

- **A second call returns a bare `409 TENANT_ALREADY_PROVISIONED`, with no session.** This
  changed. It used to return the *existing* admin's live session — meant as idempotency for a
  wizard double-submit — and the actual effect, measured, was that an anonymous caller who
  simply guessed a known admin's email address on an already-provisioned tenant received that
  admin's `permissions: ["*"]` token back for free (defect S1). There is no idempotency
  shortcut here any more: **a rollout script written against the old contract must catch the
  409 and fall back to `POST /auth/login`** with the credential the wizard actually set, not
  assume a repeated bootstrap call is safe to retry blindly.
- **Claimed-ness is a recorded fact, not an inference.** `settings.tenantClaimedAt` is written
  once, by `POST /bootstrap/admin`, and never cleared — it is not reachable from
  `PUT /settings` on purpose. Before this (defect S17), the check was "does any active account
  other than the seeded fallback exist" — which a fully provisioned tenant could fail by
  accident: deactivating the last non-seed admin (one company admin may deactivate another —
  they do not outrank each other), or a seasonal shop closing for the season and leaving every
  real account inactive, both read back as "unclaimed" and reopened the anonymous-admin door.
  An install provisioned before this field existed falls back to matching the seed admin's
  **fixed id** — never its editable email — against the account list.

Practically: run the wizard once per install, capture what the owner set (their email, and
confirm they know their own PIN — you set it together, on step 2, in front of them), and if
you ever need to re-run any part of the wizard against a machine you are not sure has been
claimed, check `GET /bootstrap/status` first (`claimed: true|false`) rather than assuming.

---

## 3. Loading opening balances and migrating the client's old data

`الإعدادات ← نقل البيانات` — the one-time go-live import tool
(`packages/api/src/data-migration-routes.ts`). Thirteen steps, dependency-ordered; this build
covers all thirteen across two surfaces.

### 3.1 The sequence

**Master data first (steps 1–9), each a preview/commit pair, each an all-or-nothing
transaction per batch** — every row is validated against what is already persisted AND
against every other row in the same batch before anything writes; one bad row and nothing in
that batch lands, with every row's error reported so the whole file can be fixed and
resubmitted in one pass:

| # | Step | Preview | Commit | Permission needed |
|---|---|---|---|---|
| 1 | الأقسام (Departments) | `POST /departments/preview` | `POST /departments/commit` | `admin.settings.view` / `.edit` |
| 2 | الموظفون (Employees) | `POST /employees/preview` | `POST /employees/commit` | `admin.settings.view` / `.edit` |
| 3 | حسابات الخزينة (Treasury accounts) | `POST /treasury-accounts/preview` | `POST /treasury-accounts/commit` | `admin.settings.view` / `.edit` |
| 4 | الموردون (Suppliers) | `POST /suppliers/preview` | `POST /suppliers/commit` | `admin.settings.view` / `.edit` |
| 5 | العملاء (Customers) | `POST /customers/preview` | `POST /customers/commit` | `admin.settings.view` / `.edit` |
| 6 | الأصناف (Items) | `POST /items/preview` | `POST /items/commit` | `admin.settings.view` / `.edit` |
| 7 | وحدات الأصناف (Item units) | `POST /item-units/preview` | `POST /item-units/commit` | `admin.settings.view` / `.edit` |
| 8 | تصنيفات الأصول (Asset categories) | `POST /asset-categories/preview` | `POST /asset-categories/commit` | `admin.settings.view` / `.edit` |
| 9 | الأصول الثابتة (Fixed assets) | `POST /assets/preview` | `POST /assets/commit` | `admin.settings.view` / `.edit` |

Import in this order — later steps reference earlier ones (an employee needs a department, an
asset needs a category) and the preview validation checks referential integrity against what
is already committed, not just shape.

**Item opening balances — one warehouse per batch, chosen once, not per row.** Once items
exist (step 6 above), load starting quantities and costs:
`POST /opening-balances/preview` and `POST /opening-balances/commit`, both gated on
`inventory.adjustment.create` (not `admin.settings.*` — this is a stock movement, not master
data, and the permission model treats it as one). Each row names an item code and a quantity
and cost; the batch commits as a single stock adjustment document against the warehouse named
once for the whole file.

**Historical documents (steps 10–13) reuse the ordinary historical-import routes, not this
module.** فواتير/مرتجعات المبيعات والمشتريات السابقة (prior sales/purchase invoices and
returns) go through `POST /purchases/historical-import/{preview,commit}` (gated on
`purchases.invoice.create`) and the sibling `/sales/historical-import` routes (gated on
`sales.invoice.create`), because that machinery already implements the settled/partial-
balance archive rule this wizard also promises — there was no reason to build it twice.
`GET /status` on the data-migration module folds these into one unified "registered: N" count
so the wizard shows a single progress picture across all 13 steps even though two different
route families serve it.

**Check progress at any point**: `GET /status` (`admin.settings.view`) returns the current
registered count for every one of steps 1–9 plus the historical-document counts, so you can
confirm a batch actually landed before moving to the next step or handing the machine back.

### 3.2 What to tell the client while doing this

- **Preview is a real dry run — nothing is written.** Use it liberally; there is no cost to
  running a file through preview five times while you clean it up with the client.
- **A partial file does not partially land.** If row 340 of 500 fails, none of the 500 are
  committed — this is deliberate (§3.1), not a bug to work around by splitting the file
  yourself before every retry. Fix the reported rows and resubmit the whole file.
- **This is a one-time tool, not an ongoing import path.** There is no "append more opening
  balances later" workflow here; once go-live has happened, further data entry goes through
  the ordinary screens (a new customer, a new invoice), not this wizard.

---

## 4. Recovery

### 4.1 Backups: where, and how often

Backups are written **outside** Electron's per-user app-data directory on purpose — a
sibling "Mezan Backups" folder next to `userData` (`defaultBackupsDir()` in
`apps/desktop/src/main/env.ts`) — so that uninstalling the app, which typically wipes
`userData`, never takes the backups with it. The live database sits at
`<userData>/mezan.db`.

A backup runs automatically:

- **Before every schema migration**, always (`backupThenMigrate` — there is no migration
  runner wired yet as of this writing, so this currently fires on every launch as a no-op
  migration step, but the backup itself is real).
- **Once daily** while the app is running (`scheduleBackups`, a 24-hour interval from launch).
- **On app close** (`will-quit`).

Retention is GFS (Grandfather-Father-Son): **7 daily, 4 weekly, 12 monthly** backups are
kept, pruned automatically after each new one — see `apps/desktop/src/backup/retention.ts` if
you need the exact bucketing rule. Each backup is a `.mezanbak` archive: a transactionally
consistent SQLite snapshot (via SQLite's own online-backup API, safe to take mid-write)
plus a manifest carrying a checksum and row counts.

**Tell the client explicitly**: the backup folder lives on the SAME machine, on the SAME
disk, as the database it backs up. A GFS retention schedule protects against a bad write or
a "we deleted the wrong thing last Tuesday"; it does not protect against the laptop itself
being stolen, flooded or dying. Getting a copy of "Mezan Backups" off-machine — a USB drive
taken home, a network share, anything — is the client's job, and this build does not do it
for them.

### 4.2 Restoring onto replacement hardware

The restore machinery is real, wired end to end, and exposed to the renderer — though not yet
driven by a settings screen a consultant can click through (see below).

**What actually happens, mechanically** (`apps/desktop/src/backup/restore-service.ts`,
called from `apps/desktop/src/main/restore-ipc.ts`): extract the archive → validate the
manifest → verify the checksum against what the manifest recorded at backup time → run
SQLite's own `integrity_check` on the extracted file → mount it atomically (write to a `.new`
sibling, then rename over the live path, so a crash mid-restore can never leave a half-written
database where the real one belongs). Around that core, `restore-ipc.ts` adds what a real
recovery needs:

- **A safety backup of the CURRENT database, taken first, before anything else touches
  disk.** If the wrong archive gets chosen — which is exactly what happens at 9pm with the
  shop shut and a worried owner on the phone — that mistake is itself recoverable.
- **Every live connection is closed before the rename** — the backend, the dedicated backup
  connection, the scheduled-backup timer — because leaving any of them open makes the atomic
  rename fail outright on Windows, and on POSIX lets it succeed while the still-running process
  keeps writing into an unlinked inode, which LOOKS like a working restore and shows the OLD
  data on the next launch.
- **The app relaunches itself** after a restore attempt either way (success or a failed
  verification) — a short delay lets the confirmation reach the screen first, then the process
  exits and restarts on whatever is now on disk.
- **Authorization is the live session, not the renderer's word for anything.** All three
  channels (`mezan:backup:list`, `:create`, `:restore` — exposed to the renderer as
  `window.mezan.backup.{list,create,restore}` via the preload bridge) take the caller's
  session token and check it against the SAME session registry every HTTP route checks
  against, requiring `admin.backup.restore` (or `*`) — its own permission pair rather than
  riding on `admin.tenant.settings.edit`, so the person who holds the recovery runbook does
  not also have to be handed every setting in the product. **All three channels check the
  same `admin.backup.restore` today, including list and create** — `admin.backup.view` exists
  in the permission catalog as a separate, weaker grant, but nothing in `restore-ipc.ts`
  currently checks it, so granting only `admin.backup.view` to someone does not let them even
  list the backups. Treat the two permissions as one until that is wired. The archive to
  restore is named by a bare filename validated against path traversal, never an absolute
  path the renderer could pick.

**`الإعدادات ← النسخ الاحتياطي والاستعادة` is a real screen now**
(`apps/web/src/settings/BackupRestorePage.tsx`, routed as `settings-backup`, listed in the
settings nav group) — this was the piece missing before: the IPC layer, the safety-backup-
first sequencing, and the permission check were all real and covered by tests, but
`window.mezan.backup` had no caller in `apps/web` and no tab a non-technical user could click
through. The screen lists every archive with its date, reason, app version and size; "إنشاء
نسخة الآن" takes a manual backup on demand; a damaged archive (failed its own checksum/
integrity re-check on read) shows a status pill instead of a restore button. **Restoring is
deliberately the one place in this product where friction is the feature**: choosing "استعادة"
opens a confirmation naming the exact loss ("everything entered since this date is gone") and
requires TYPING the archive's own date before the restore button enables — a single misclick
cannot replace the live database. A successful restore's last message is "the app is
relaunching," because it then does exactly that. On the web build (no Electron host, nothing
to hold the database file), the screen says so and renders nothing else rather than a dead
table. For a debug build, driving `window.mezan.backup.restore(token, fileName)` directly still works
and gets the same safety-backup-first behaviour — the screen and the direct call are the same
path underneath. If the app cannot even launch — the machine it was on is gone and this is a
fresh install on replacement hardware, with nothing yet to sign into — there is no screen to
reach: install fresh, then use the screen on the new install once it is up. Only if the app
installs but will not start at all is a manual file operation the last resort: with the app
fully closed, extract the chosen `.mezanbak` and copy its database over `<userData>/mezan.db`
by hand — you lose the safety-backup-first behaviour and the checksum/integrity re-check the
screen gives you for free, so prefer the screen whenever the app runs at all.

**What a restored database means for credentials — this is the part that catches people out.**
A backup taken from a working install is, by definition, from a tenant that has already been
claimed (`settings.tenantClaimedAt` is set). Restoring it does not reopen §2's bootstrap door —
the wizard will not offer to create a new admin on a restored database, because the fact that
this tenant was claimed travels with the backup. **The way in is a PIN somebody already knows
from the machine the backup came from, OR `--reset-admin` run against the restored database**
(§1.4) — the seeded fallback admin account is still in that database even on a long-claimed
tenant, the flag mints it a fresh PIN and reactivates it if it had been deactivated, and both
are authorised purely by filesystem access to the restored machine, exactly as they would be
on the original one. This closed what used to be a genuine dead end: before `--reset-admin`
existed, a replacement-hardware setup where nobody had a working login for the tenant — the
owner unreachable, the PIN never written down, the dead machine the only one anyone was ever
logged into — had no way back in short of hand-editing a scrypt hash into the SQLite file.
Still worth doing anyway: capture a working admin credential (or set `MEZAN_SEED_ADMIN_PIN` at
install time and keep a record of it somewhere safe) as a standing part of every rollout, so
`--reset-admin` is a convenience you don't need rather than the only door left.

---

## 5. Login lockout on training day

`packages/api/src/login-throttle.ts` — five consecutive wrong PINs against one account start
a lockout: 60 seconds, then doubling with each further failure (120s, 240s, …) to a ceiling of
**15 minutes**. A quiet hour (no failures for 60 minutes) forgets the streak entirely.

**A served lock steps the ladder down ONE RUNG — it does not reset the streak to zero.** That
reset-to-zero behaviour was this file's first fix and did not survive contact with its own
suite: giving a served lock a full five free attempts again means 7,200 guesses a day are
available for free, which walks a six-digit PIN's keyspace in about **four months** instead of
the ~28 years the doubling ceiling is supposed to buy. Stepping down one rung instead keeps
that ceiling (one guess per fifteen minutes at the top) while still fixing the real complaint
that drove the original change — that a served lock used to leave the streak at its
high-water mark, so one more typo after waiting out fifteen minutes bought **thirty**, not
another fifteen. The person who is genuinely locked out and cannot wait still has the same
answer: `POST /users/:id/unlock`, which — unlike a served lock — clears the streak to zero,
because an admin pressing «فكّ القفل» means "this person can sign in now," not "one rung
closer to sign in."

**The counting key is not the same for everyone, and this is the answer to "why is the till
locked and mine isn't."**

- **The host's own console — the machine physically running Mezan — is counted per account,
  full stop.** No source distinction, because there is only one: whoever is sitting at that
  keyboard.
- **A remote caller — anything arriving over the LAN socket (§6) or through `apps/server`** —
  is counted per **(account, source)**, where the source is the actual TCP peer address
  (`request-origin.ts` — read off the socket, never a header a client could forge). This is
  why one till fumbling its trainee's PIN five times does not lock a different till signed in
  as the same shared account: they are different sources, counted separately.

This split exists because counting purely per account is right for stopping brute force and
wrong for a shop: the owner's email is printed on every invoice this product produces, so
counting only by account would let anyone on the shop wifi hold the owner's login at the
fifteen-minute ceiling indefinitely — one deliberately-wrong request every quarter hour is
enough — with no credential and no way for the owner to get back in from their own machine.
The host-local console is immune to a lockout someone else triggers over the wifi; a remote
attacker rotating source addresses to dodge their own lockout is also rotating away from
whichever address they can actually reach the shop from.

**The support answer, in order:**

1. **Wait it out.** The ceiling is 15 minutes; tell the trainee to go make tea. This is
   usually the right answer on training day specifically — the lockout is doing exactly what
   it is for. The login screen itself now disables its submit button for the exact wait the
   server named and counts it down — it used to print "حاول بعد 900 ثانية" and leave the button
   pressable, so every immediate retry read to the person typing as one more failure of their
   own PIN rather than the lockout it actually was.
2. **`POST /users/:id/unlock`**, gated on `admin.users.unlock` (a role granted separately from
   `admin.users.edit`, so a branch manager standing at the counter can clear a lockout without
   also holding every colleague's PIN). Clears the lock **and resets the streak** on every key
   it was counted under for that account — an unlock means "this person can sign in now," not
   "this person can sign in now and is one typo from being locked again."
3. **`الإعدادات ← المستخدمون` has a "فكّ القفل" row action now.** It shows only on an active
   account (`apps/web/src/pages/UsersPage.tsx`), scopes its pending state to the one row being
   unlocked rather than freezing the whole list, and is a no-op on a second click while one is
   in flight — the standard per-row-action shape this codebase requires. The action is both
   real and audited (`ACCOUNT_UNLOCKED` at WARNING severity in the security audit stream).
   Calling `POST /users/:id/unlock` directly is still fine for a scripted rollout; it is no
   longer the only way in for a consultant working from the screen.

---

## 6. LAN multi-till setup

Licensed by the `lan.multi_till` feature flag (`packages/domain/src/lan/feature-flag.ts`).
Entitlements today come from `MEZAN_ENTITLEMENTS_JSON`, an environment variable read and
schema-validated but **not cryptographically verified** — see §7. Absent or invalid
entitlements resolve to fully unlicensed (zero seats, no features), never to a permissive
default.

### 6.1 What actually opens on the network

When the license carries `lan.multi_till`, the desktop shell binds a second, LAN-visible HTTP
socket alongside its normal no-port IPC bridge (`apps/desktop/src/main/lan-host.ts`). Two
things gate what a device on the shop wifi can reach through it, in addition to whatever
session/permission gate the route itself carries:

- **A bind-address default that is not "every interface."** The socket now binds the first
  non-internal IPv4 interface it finds, not `0.0.0.0` — a machine with a 4G dongle, a bridged
  VM adapter, or a second NIC on a guest network no longer publishes the books past the subnet
  the shop actually meant to share them on. `0.0.0.0` is still the fallback when the host has
  no such interface at all (no cable, no wifi), and it logs loudly when that happens, because
  that is a state worth someone looking at rather than shipping into silently.
- **A path allow-list, checked before anything else.** Only `POST /auth/login`,
  `POST /auth/logout`, `GET /tenant`, `GET /health`, and everything under `/lan/*` is
  forwarded to the app at all — `/bootstrap/*`, `/users`, `/gl`, `/reports`, everything else
  gets a 404 that is byte-identical to Hono's own not-found body (a 403 would confirm the
  route exists and is merely fenced off, which is the one fact a stranger on the wifi should
  not be handed). This is a second, independent guard on top of `/bootstrap/admin`'s own
  claimed-tenant check (§2) — the anonymous-takeover route is simply not reachable from the
  LAN socket at all, licensed or not.
- **An own-subnet check on every request, not cached at bind time.** A request whose remote
  address does not sit inside one of this host's own attached subnets gets `403 OFF_SUBNET`,
  re-evaluated per request — deliberately, so a shop laptop that later goes home on a phone
  hotspot doesn't keep trusting whoever it trusted at boot.

None of this is a substitute for the session/permission gates inside the app — see §7 for what
it does not do (encrypt the wire).

**`الأجهزة المتصلة` now shows the address to point a till at.** Before this, finding the LAN
socket's bind address meant reading the desktop process's own console line
(`[lan] multi-till host listening on http://<address>:<port> …`) or asking whoever set the
machine up — there was nowhere in `apps/web` that showed it. `ConnectedDevicesPanel.tsx`'s
`LanAddress` component now reads it from `mezan:licence:status` (a session-gated IPC channel,
`apps/desktop/src/main/licence-ipc.ts`, exposed as `window.mezan.licence.status`) and renders
one of: the copyable `http://<address>:<port>` URL, "not running" when the socket never
started, or "address unknown" specifically for the `0.0.0.0` fallback case (§6.1) — a bound
socket with no single dialable address reads as unknown rather than printing a URL nobody
could actually reach. The browser build (no Electron host) says plainly that it cannot know
the host's address, rather than guessing.

### 6.2 Seats, connecting, and freeing a stuck one

Seats are enforced by `SeatSessionRegistry` (`packages/domain/src/lan/session-registry.ts`),
sized from `entitlements.seats`, re-read on every gated `/lan/*` call so a re-verified license
takes effect without a restart.

- **A till connects** by first signing in over the LAN socket (`POST /auth/login`, which the
  path allow-list permits precisely because a till needs to authenticate before it can hold a
  seat), then presenting that session's bearer token to `POST /lan/sessions` with a `deviceId`
  (and optionally a human-readable `deviceLabel`). **The seat's identity is the AUTHENTICATED
  caller's `userId`, resolved from the session token — never anything the request body
  names.** Before the PR #54 review the seat key was a caller-supplied `sessionId`, so any
  signed-in account could loop with fresh random ids and burn every seat until the whole
  install was locked out; a `maxSeatsPerUser` cap (`UserSeatLimitExceededError`, 409) now bounds
  how many concurrent seats one account may hold no matter how many device labels it invents.
- **`GET /lan/sessions`** (lists connected devices — the admin panel's data source) needs
  `admin.devices.view`; **`DELETE /lan/sessions/:sessionId`** (frees a seat) needs
  `admin.devices.manage` — the permission the catalog comment describes as deliberately
  separate from `admin.settings.*`, "because freeing a stuck seat is a shop-floor act": a branch
  manager can hold it without also getting general settings access.
- **A disconnect now revokes the actual bearer token that device connected with, not just the
  seat number.** This closed a real gap (PR #54 review finding #3, "disconnect is cosmetic — it
  frees a number, not a connection"): before it, freeing a seat let a NEW till take the slot
  while the disconnected device's own token stayed live and kept working against every other
  route. The route also pushes a `disconnected` SSE event to every open `/lan/events` stream, so
  a till that just got kicked learns about it in real time rather than on its next poll.
- **`الأجهزة المتصلة` (Connected Devices) is a real screen now**, reachable from
  `الإعدادات` (`apps/web/src/screens/ConnectedDevicesScreen.tsx`, routed as `devices` in
  `router/screens.ts`, listed in the settings nav group). This is the panel that drives the
  routes above — before this screen was wired into routing, the component existed and had a
  test but nothing in the shipped navigation could reach it, so freeing a stuck seat had no
  control surface in the actual product regardless of what the API allowed.
- **A crashed till does not hold its seat forever any more.** Before, an explicit disconnect
  was the only way to free a seat — no idle expiry at all — so a till that lost power or
  crashed mid-shift kept its seat until someone found the Connected Devices screen and
  disconnected it by hand. Sessions with no heartbeat for 3× the SSE keep-alive interval
  (default 45s, since the heartbeat defaults to 15s) are now reaped automatically on the next
  connect or list. If a seat looks stuck on the panel, give it under a minute before manually
  disconnecting it — it may already be on its way out on its own.

---

## 7. What is NOT secure yet — tell the client the truth

A consultant who cannot say this plainly is setting the client up to find out the hard way.

- **LAN traffic is cleartext HTTP.** Every PIN and every bearer session token crosses the shop
  wifi unencrypted. §6's path allow-list and subnet check narrow WHO can even address the
  socket; neither one encrypts a single byte on the wire. Anyone who can see the shop wifi's
  traffic — a compromised access point, another device on the same network doing a passive
  capture — reads a token in the clear, and a sniffed bearer token is the whole ERP for as
  long as that session stays valid (`session-auth.ts`'s 12-hour idle timeout is the outer
  bound). This is tracked as open by decision, not by patch, in `ROADMAP.md` §5.2 — closing it
  needs TLS with a certificate pinned at each till's first pairing, not a certificate a browser
  would recognise, since none of these hostnames will ever see a public CA.
- **The SQLite file is unencrypted at rest.** `mezan.db`, and every backup made from it, is
  readable with any SQLite browser by anyone who can get at the file — a stolen laptop is the
  whole set of books. `ROADMAP.md` §5.2 has the detail on what closing this actually requires
  (SQLCipher or an OS-keychain-sealed key, plus a recovery story for losing the machine and
  the key together).
- **Updates are not code-signed or notarized.** Today's build runs on developer trust alone —
  neither macOS Gatekeeper nor Windows SmartScreen can vouch for it. Do not tell a client "this
  installer is provably from us" until that changes.
- **License verification is a stub — but a licence problem now says so, on screen, instead of
  disappearing.** `MEZAN_ENTITLEMENTS_JSON` is still trusted with a schema check and no
  signature — an env var unlocks LAN mode and every module, and the real Ed25519 verifier in
  `packages/domain/src/licensing/license.ts` is not wired up yet. What closed
  (`apps/desktop/src/main/entitlements.ts`'s `diagnoseDesktopEntitlements()`, resolved once at
  startup in `main/index.ts` and read by every gate from that one call): a missing, malformed
  or schema-invalid `MEZAN_ENTITLEMENTS_JSON` used to fall to `console.warn` and an install
  that simply looked absent — no LAN mode, no modules, no message anywhere a shop owner or a
  consultant could see. It now resolves to a status (`licensed`/`missing`/`malformed`/
  `invalid`/`expired`), a short stable code (`LIC-OK`/`LIC-MISSING`/`LIC-MALFORMED`/
  `LIC-INVALID`/`LIC-EXPIRED` — safe to read down the phone to support) and an Arabic message,
  read over a session-gated IPC channel (`mezan:licence:status`, no permission beyond being
  signed in — a licence problem is the owner's to see) and rendered on `الإعدادات ←
  الأجهزة المتصلة` by `LicenceStatusNotice` above the seat panel it explains: an install with
  no licence, or one past expiry, is why the seat count reads zero and no till can connect.
  **Past `expiresAt`, the capability set is deliberately left exactly as granted rather than
  dropped to unlicensed** — a licensing lapse never withholds a shop's own data — with the
  status still reporting `expired` so the client is told, while the real cutover
  (active → grace → read-only) is left to `verifyLicense()` once it lands.
- **The audit trail stops the app's own code from editing its history, not a person with the
  file.** A SQLite trigger refuses `UPDATE`/`DELETE` against audit rows from anything the
  application itself does — which is real, and is what closed several audit gaps this rollout
  depends on (a login lockout, a PIN reset, an approval-config change all now leave a row that
  cannot be quietly edited back out by the app). It does not stop someone with direct
  filesystem access to `mezan.db` — in practice, the company admin — from opening the file with
  another tool and editing past the trigger, or from restoring an older backup that never had
  the entry in question.
