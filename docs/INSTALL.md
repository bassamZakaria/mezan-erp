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
3. **Core data** — confirms/re-runs the same idempotent seed and shows what exists. This step
   runs `POST /bootstrap/seed` **after** step 2 has already claimed the tenant, so that route
   is deliberately **not** gated on claimed-ness. The invariant it actually enforces is
   emptiness, inside `seedIfEmpty` — a claimed-tenant guard here was tried and reverted,
   because it 409'd the wizard on its own next click on a brand-new install.
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

> ### ⚠️ THE KEY CARD: DO THIS ON INSTALL DAY OR THE BACKUPS ARE WORTHLESS
>
> **Every backup archive is now encrypted, with a key that does not travel inside it.** The
> key is sealed by Electron's `safeStorage` to **this OS user account on this machine**. That
> is what makes a stolen laptop useless to a thief — and it is exactly what makes an archive
> useless to *you* on replacement hardware, which is the entire scenario §4.2 exists for.
>
> Restoring an encrypted archive on a machine that does not hold the key fails with
> `BackupKeyMismatchError`: *"The backup archive is encrypted with a different key than this
> installation holds — it was taken on other hardware or under another OS user account."*
> There is no recovery from that. Not by support, not by us. The books are gone.
>
> **The one thing standing between the client and that outcome is a text file.** On first
> encryption the app writes `database-key.txt` beside the database — owner-only (`0600`),
> bilingual Arabic/English, containing the key and an explanation. Every launch warns while
> it is still sitting there.
>
> **On install day, in front of the owner:**
> 1. Open `database-key.txt`.
> 2. Copy the key into the client's safe, their password manager, or a notebook that lives
>    somewhere other than this building.
> 3. **Delete the file.**
> 4. Tell them, in these words: *anyone holding this key and one backup archive can read your
>    entire books — customers, prices, salaries.* It is a bearer secret. It does not go over
>    WhatsApp and it does not go in an email.
>
> If the owner lost it, `<mezan-binary> --export-database-key` writes it again and exits.
> If the owner never kept it and the machine is already dead, there is nothing to run it on.

**The pre-conversion safety archive is PLAINTEXT.** When an existing unencrypted install is
converted (see below), the safety backup taken beforehand was made from a plaintext database
and is therefore itself plaintext. The startup log names its path and says
`UNENCRYPTED — delete it once you trust this build`. Nothing deletes it automatically, on
purpose: silently destroying the only pre-conversion copy of a shop's books to tidy up is the
worse failure. Delete it yourself once the converted install has been used for real work.

### 4.2 Restoring onto replacement hardware

**Read the key-card box in §4.1 first. On replacement hardware it is the whole ballgame:** an
encrypted archive restored onto a machine that does not hold its key fails at the integrity
check with `BackupKeyMismatchError` and cannot be opened by anyone, ever. Bring the key with
you to the new machine, or do not bother bringing the archive.

Two cases behave differently, and it is worth knowing which one you are in:

- **An archive taken from an ENCRYPTED install** carries no key inside it. The restoring
  machine must already hold that key — meaning you entered it from the key card during
  setup, or you are restoring onto the same machine and OS user account it came from.
- **A legacy archive taken before encryption existed** is plaintext, and still restores
  normally onto an encrypted install. The restored file lands as plaintext and **the next
  launch converts it** to encrypted storage under this machine's own key. Nothing special to
  do; just expect the conversion message on the following start.

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


### 4.3 Encryption at rest, and the flags for a machine that is in trouble

**What is encrypted, and when it happened.** The desktop tenant database is stored encrypted
(SQLCipher-style, through `better-sqlite3-multiple-ciphers`), and so is every backup archive
written from it. This is desktop-only: `packages/persistence` still opens plain
`better-sqlite3`, and only the desktop shell injects the cipher driver, so `apps/server`, the
scenarios and the test suite are untouched by it.

**An existing plaintext install converts itself on first launch, safely.** The sequence is:
take a full verified backup **first** (that archive is plaintext — see §4.1) → `VACUUM INTO` a
staging file → `PRAGMA rekey` → verify the result (no `SQLite format 3` header, `integrity_check`
passes, row counts match the source) → atomically rename into place. It is interruptible at
every point without loss: **before** the rename the original database is untouched, and
**after** it the next launch simply sees an encrypted header and does nothing. If the machine
loses power halfway through, start it again.

**A machine with no OS keyring does not start.** `safeStorage` has nothing to seal the key
with on, in practice, a bare Linux desktop without gnome-keyring or kwallet. The app refuses
to launch and says why, rather than quietly writing the books in plaintext — the two honest
answers are "do not start" and "start unencrypted, loudly", and it must never pick a third.

| Flag | What it does | When you actually need it |
|---|---|---|
| `--allow-unencrypted-database` | Runs the old plaintext path, with a loud warning on every launch: the database **and every backup** are written in the clear | A machine with no OS keyring, where the alternative is not running at all. **Never the right answer on a customer machine.** It is **refused** on a database that is already encrypted — it cannot decrypt one, and letting it try would report "file is not a database", a corruption message for an intact file, which is how books get thrown away |
| `--export-database-key` | Re-writes `database-key.txt` beside the database and exits | The owner lost the key card and the machine still runs. Do it, hand it over, delete the file again |
| `--reset-admin` | Mints a fresh random PIN for the seeded admin, prints it, and exits (§1.4) | Nobody has a working login on this install |

All three are authorised by filesystem access to the database directory and nothing else.
None is reachable over the LAN socket, over IPC, or from the renderer.

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

When the license carries `lan.multi_till`, the desktop shell binds a second, LAN-visible
**HTTPS** socket alongside its normal no-port IPC bridge (`apps/desktop/src/main/lan-host.ts`).
Three things gate what a device on the shop wifi can reach through it, in addition to whatever
session/permission gate the route itself carries:

- **TLS, with no plain-HTTP fallback anywhere.** The socket serves HTTPS only, using a
  self-signed identity the host mints once and keeps for the life of the install
  (`apps/desktop/src/main/lan-tls.ts`; `lan-tls-key.pem` at `0600` and `lan-tls-cert.pem`,
  beside the database). `tls` is a **required** option on `startLanHost` — there is no
  argument that produces an unencrypted socket. If the identity cannot be obtained the socket
  **stays closed** and the log says so (`[lan] multi-till is LICENSED but STAYED CLOSED …
  no plain-HTTP fallback by design`). A shop that believes its wire is encrypted when it is
  not is worse off than one that knows it is not, because nobody looks for a leak they have
  been told cannot happen. The certificate is **never re-minted** over a present-but-damaged
  key pair: a new fingerprint is, from a paired till's side, indistinguishable from an
  impostor. §6.3 is the human half of that, and without it the whole defence is decorative.

- **A bind-address default that is not "every interface."** The socket now binds the first
  non-internal IPv4 interface it finds, not `0.0.0.0` — a machine with a 4G dongle, a bridged
  VM adapter, or a second NIC on a guest network no longer publishes the books past the subnet
  the shop actually meant to share them on. `0.0.0.0` is still the fallback when the host has
  no such interface at all (no cable, no wifi), and it logs loudly when that happens, because
  that is a state worth someone looking at rather than shipping into silently.
- **A public list, a never-list, and a seat.** Unauthenticated, a caller reaches only
  `POST /auth/login`, `POST /auth/logout`, `GET /tenant`, `GET /health` and `/lan/*`.
  `/bootstrap/*` is on the **never**-list — unreachable over this socket for anybody,
  licensed, authenticated and seated included, because it is the second half of the
  anonymous-tenant-takeover chain (§2) and claiming a tenant is something you do standing at
  the host. Everything else is forwarded **only** to a caller who holds a live session minted
  over this socket AND a licensed seat (`main/lan-authorization.ts`); a licence is not a
  credential, and signing in is not connecting. Anything refused gets a 404 byte-identical to
  Hono's own not-found body — never a 403, which would confirm the route exists and is merely
  fenced off.

  Until the client edition landed, that list of five WAS the whole surface, which meant the
  second machine in a shop could sign in, take a seat, and then read nothing and post nothing.

  Refusals carry an `x-mezan-lan-refused: 1` header. It leaks nothing — it is on every
  refusal this socket makes, so it tells a stranger exactly what the 404 already did — and it
  is what lets a client tell "this customer was deleted" from "I am not connected", which are
  otherwise the same response. Without it a client's boot sequence, which fires before its
  stored session is restored, reads as a dozen missing routes and the shell renders
  «الصفحة غير موجودة» over a perfectly healthy host.
- **An own-subnet check on every request, not cached at bind time.** A request whose remote
  address does not sit inside one of this host's own attached subnets gets `403 OFF_SUBNET`,
  re-evaluated per request — deliberately, so a shop laptop that later goes home on a phone
  hotspot doesn't keep trusting whoever it trusted at boot.

None of this is a substitute for the session/permission gates inside the app — see §7 for what
it still does not do.

**`الأجهزة المتصلة` shows the address to point a till at, and the fingerprint to compare it
against.** Before this, finding the LAN socket's bind address meant reading the desktop
process's own console line or asking whoever set the machine up — there was nowhere in
`apps/web` that showed it. That log line now reads:

```
[lan] multi-till host listening on https://<address>:<port> (seats=<n>, sha256=<AB:CD:…>, routes=/auth/login /auth/logout /tenant /health /lan)
```

`ConnectedDevicesPanel.tsx`'s `LanAddress` component reads both values from
`mezan:licence:status` (a session-gated IPC channel, `apps/desktop/src/main/licence-ipc.ts`,
exposed as `window.mezan.licence.status`) and renders the copyable `https://<address>:<port>`
URL **and** the certificate's SHA-256 fingerprint in `AB:CD:…` pairs — both forced LTR and
selectable, each with its own copy button, because they are compared character by character
by a human and an RTL run would reorder the groups on screen. It renders "not running" when
the socket never started, and "address unknown" specifically for the `0.0.0.0` fallback case —
a bound socket with no single dialable address reads as unknown rather than printing a URL
nobody could reach. The browser build (no Electron host) says plainly that it cannot know the
host's address, rather than guessing.

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

### 6.3 Pairing a till: compare the fingerprint, in the shop, by eye

**Do this once per till, at the counter, before you type a PIN into it. If you skip it, the
TLS in §6.1 protects the shop against a passive listener and against nobody else.**

The host's certificate is self-signed. No public certificate authority will ever certify
`192.168.1.7`, and most of these installs have no internet at all, so there is no chain for a
till to validate. What the till trusts instead is **this** certificate's fingerprint, which it
remembers from the first connection — and the only thing that makes that first connection
trustworthy is a person comparing two strings.

1. On the **host** machine, open `الإعدادات ← الأجهزة المتصلة` (Settings → Connected Devices).
   Read the two values in §6.1: the `https://<address>:<port>` URL and the `sha256=AB:CD:…`
   fingerprint.
2. On the **till**, enter that URL.
3. The till will refuse the certificate — correctly, it is self-signed — and show you the
   fingerprint of whatever answered.
4. **Compare the two strings, character by character, standing in the shop with both screens
   in front of you.** Not "it starts with AB and ends with 9F". The whole string. Both screens
   are LTR and copyable precisely so this comparison is possible.
5. **Match → pin it.** From then on that till trusts only this certificate.
6. **Mismatch → STOP.** Do not pin, do not type a PIN, do not "try again". A different
   certificate on that address means something other than the host answered you. Disconnect
   the till from the network and find out what, before any credential goes near it.

**What this buys and what it does not.** Pinning is trust-on-first-use: it makes every
connection after the first one safe against an impostor, and it makes the first one safe only
because a human checked. An attacker who is already impersonating the host **at the moment
you pair** gets pinned instead — silently, permanently, with no later warning of any kind.
Step 4 is the only thing standing there. It is a procedure, not a mechanism, and it is why
this section exists rather than a sentence saying "the LAN is encrypted now."

**If the key ever leaks, or you must replace it:** there is no revocation and no rotation
path. Recovery is deleting `lan-tls-key.pem` and `lan-tls-cert.pem` from beside the database,
restarting the host so it mints a fresh identity, and then **re-pairing every till by hand**,
repeating steps 1–6 at each one. Budget for that before you promise a client a same-day fix.

---

## 7. What is NOT secure yet — tell the client the truth

A consultant who cannot say this plainly is setting the client up to find out the hard way.

- **LAN traffic is encrypted now, but the trust decision is a human one.** The socket is HTTPS
  only, with no plain-HTTP fallback anywhere in `lan-host.ts` (§6.1). What that does NOT do:
  - **Pairing is trust-on-first-use.** An attacker already impersonating the host at the
    moment a till is paired gets pinned instead — silently and permanently, with no later
    warning. §6.3's character-by-character fingerprint comparison is the only defence, and it
    is a procedure a person performs, not something the software enforces. If you paired a
    till without doing it, you do not know what that till trusts.
  - **Nothing authenticates the client.** TLS here is one-way — no client certificates. Any
    device that can reach the socket can attempt to log in; the subnet check and the path
    allow-list remain the only things narrowing who and what.
  - **A stolen session token is still the whole ERP.** Untouched by this work:
    `packages/api/src/session-auth.ts` binds a session to no device, no address and no seat,
    and it lives 12 hours. TLS stops the token being read off the air; it does nothing about a
    token taken from a till someone walked up to.
  - **The private key is protected by filesystem permissions only** (`lan-tls-key.pem`, `0600`,
    beside the database). Anyone with the file is the host.
  - **No revocation, no rotation path.** If the key leaks, recovery is deleting both PEM files
    and re-pairing every till by hand — see §6.3.
- **The SQLite file and its backups are encrypted at rest now.** `mezan.db` is opened with
  `better-sqlite3-multiple-ciphers` under a 32-byte random key sealed to this OS user account
  by Electron's `safeStorage` (macOS Keychain, Windows DPAPI, libsecret/kwallet on Linux) —
  `apps/desktop/src/main/encrypted-database.ts`. Every backup archive is encrypted with the
  same key. An existing plaintext install is converted on first launch, and takes a full
  verified backup **before** a byte of the plaintext file is touched. What you must still tell
  the client:
  - **The key is bound to this machine and this OS account, and so every backup is.** That is
    the point — a stolen disk is useless — and it is also why losing the machine loses the
    backups unless the key was written down. On first encryption the app writes
    `database-key.txt` beside the database (owner-only) containing the key in Arabic and
    English, and warns on **every** launch while that file is still there. **Copy it into the
    client's safe or password manager and delete the file, in front of them, on install day.**
    `--export-database-key` writes it again for an owner who lost it.
  - **Anyone holding that card and one backup archive reads the entire books** — customers,
    prices, salaries. It is a bearer secret. It must not travel by WhatsApp or email.
  - **The pre-conversion safety copy is UNENCRYPTED.** The startup log names its path. Delete
    it once you trust the converted install; until you do, it is a full plaintext set of books
    sitting in the backups folder.
  - **A machine with no OS keyring does not start**, rather than quietly running in plaintext.
    That is mostly a bare Linux desktop with no gnome-keyring/kwallet.
    `--allow-unencrypted-database` is the operator's explicit, logged way to run anyway — it
    means the database **and every backup** are written in the clear, and it is never the right
    answer on a customer machine.
- **Updates are still not code-signed in any build you can hand a client today — but the
  product is now ready to sign, and cannot ship unsigned by accident.** What exists:
  `apps/desktop/electron-builder.yml` carries a complete macOS (Developer ID + hardened
  runtime + notarization) and Windows (Authenticode + RFC-3161 timestamp) configuration driven
  entirely from CI secrets, with `forceCodeSigning: true` so a mac/win package that could not
  be signed **fails** instead of shipping; `.github/workflows/release.yml` refuses to start
  without the certificates and refuses to publish an artifact `apps/desktop/scripts/check-signed.mjs`
  cannot get the operating system to vouch for; and the auto-updater refuses to run at all on a
  build whose own signature it cannot confirm (see below). What does **not** exist: **the
  certificates**. Nobody has bought an Apple Developer ID, an Apple notarization key or a
  Windows OV/EV certificate yet, so no signed installer has ever been produced. Until they are
  bought and §8's secrets are set, **do not tell a client "this installer is provably from
  us"** — it is not, and saying so is the one sentence in this section that would actually
  cost them money.
- **The auto-updater is off, and now refuses rather than trusts.** It needs
  `MEZAN_AUTO_UPDATE=1` to run at all and a separate `MEZAN_AUTO_UPDATE_INSTALL=1` before it
  will write anything. On top of that it now checks, at launch, whether the app it is running
  inside is itself signed by a Developer ID certificate, and **refuses** if the answer is no or
  merely unknown — including on Windows and Linux, where there is nothing to check. The
  reasoning is in `apps/desktop/src/main/updater.ts`: an unsigned app has no publisher, so
  electron-updater has nothing to verify a download against, and this product also binds a LAN
  socket — anyone on the shop wifi could answer for the update feed. There is an override,
  `MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED=1`, spelled that way on purpose. **Never set it on a
  customer install.**
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

---

## 7A. Building the installer, and rolling out the second machine

Everything in this section was verified end to end on two live instances before it was
written: a packaged host, a packaged client on the same wifi, a real TLS socket between
them, and a customer created from the client that is still in the host's encrypted database.

### 7A.1 One command builds the installers

```bash
pnpm desktop:package            # this machine's platform
pnpm desktop:package --mac      # macOS .dmg (x64 + arm64)
pnpm desktop:package --win      # Windows NSIS .exe — must be run ON Windows, see below
pnpm desktop:package --help
```

It runs the six steps in the order that matters, and `scripts/package-desktop.mjs` says why
each one is there. Three are easy to skip and each produces an installer that looks fine and
is not: fetching the Electron **binary** (`pnpm install` never does — `allowBuilds.electron:
false`), rebuilding the native modules for **Electron's** ABI rather than Node's, and
verifying that by launching the real Electron and opening a real encrypted database.

**The build is UNSIGNED unless you pass `--signed`.** That is right for a build you are about
to test on your own machine and wrong for anything a client installs — see §8. An unsigned
macOS build is refused by Gatekeeper on any machine but the one that built it, and the
auto-updater refuses to run on it at all.

**Windows must be built on Windows.** Not an electron-builder limitation: `better-sqlite3` and
`better-sqlite3-multiple-ciphers` are native modules that need a Windows binary for Electron's
ABI, and those cannot be cross-compiled from macOS or Linux. A `.exe` produced that way opens
no database. Build it on a Windows machine, or push a `v*` tag and let the windows-latest
runner in `.github/workflows/release.yml` do it — that path also signs it.

**After a package build, the native modules are left compiled for Electron**, so `pnpm test`
cannot load them. The command rebuilds them for Node on the way out unless you pass
`--keep-electron-abi`.

### 7A.2 One host, many clients — and exactly one copy of the books

Mezan ships ONE executable that plays one of two roles.

- The **host** holds `mezan.db`, takes the backups, holds the licence, and opens the LAN
  socket (§6).
- A **client** holds no database at all. It renders the same UI, and every request it makes
  is forwarded to the host over the pinned TLS socket. There is one copy of the ledger, on
  one machine, and **no synchronisation anywhere** — two copies of a ledger that have to be
  merged is not a feature, it is a class of defect nothing recovers from.

`client.json`, beside the database, IS the role: no file, host; a file, client. A damaged
client.json stops the app rather than falling back to either role, because a client that
silently became a host would open its own empty database, seed its own chart of accounts,
look entirely normal, and take a day of somebody's invoices into books nobody else can see.

### 7A.3 The rollout, in order

**1. On the host: put the licence where the app can read it.** Entitlements now come from
`licence.json` beside the database (`MEZAN_ENTITLEMENTS_JSON` still wins if it is set, for
development). Before this, entitlements were env-var-only — which a packaged app launched
from the Start menu or the Dock never has, so **no shipped install could be licensed at
all**, and `lan.multi_till` was unreachable by anyone. It is schema-validated and **not**
cryptographically verified; see §7 and `main/licence-file.ts` for what that does and does not
buy you.

```json
{
  "plan": "ENTERPRISE",
  "activeModules": ["sales", "purchases", "inventory", "accounting", "treasury"],
  "features": { "lan.multi_till": true },
  "seats": 3,
  "expiresAt": null
}
```

**2. Start the host and let the OS firewall let it in.** The socket binds, and on both macOS
and Windows the operating system's own firewall silently drops the incoming connections until
the app is allowed. This is the single most likely reason a correctly configured client says
"no answer from the host": on macOS the app must be added to System Settings → Network →
Firewall → Options; on Windows, approve the prompt on first launch (or add an inbound rule for
the Mezan executable). Nothing in the product can tell you this is happening — from the
client's side an OS-blocked port and an unplugged machine are the same silence.

**3. Read the address and the fingerprint off the host's «الأجهزة المتصلة» screen** — or off
its console line — and compare the fingerprint by eye, in the shop (§6.3). They are also both
printed at startup:

```
[lan] multi-till host listening on https://192.168.1.7:4173 (seats=3, sha256=49:0E:…, …)
```

**4. Pair each client, once, from a shortcut or a terminal:**

```
Mezan --pair-host=https://192.168.1.7:4173 --pair-fingerprint=49:0E:E0:… --device-label="مكتب المحاسب"
```

It writes `client.json` (mode `0600`) and exits. It refuses to run on a machine that already
has a `mezan.db`, because a client holds no books of its own and pairing would orphan them.
Re-pairing an existing client keeps its `deviceId`, so repointing a till at a rebuilt host
does not burn a second seat.

**5. Start the client and sign in.** It claims a licensed seat automatically as part of
signing in, and re-announces itself every 15 seconds — the host reaps a device it has not
seen for 45 seconds, so without that heartbeat the app loads on login and goes empty a minute
later. If the licence has no free seat, the **login itself** is refused with an Arabic
message; there is deliberately no "signed in but seatless" state, because it renders as a
complete application in which every single screen is empty.

### 7A.4 What a client cannot do, and says so

Backups and restore are the host's (`النسخ الاحتياطي يُدار من الجهاز الرئيسي`), and the
licence panel on a client reports which host it is paired with and which certificate it
pinned rather than restating a licence it does not own. The client also does **not** run the
auto-updater: a client and its host must be the same version, so the host is updated first,
deliberately, by a person.

---

## 8. Release runbook — signing a build so a client can trust it

**For the maintainer who cuts releases, not the consultant at the counter.** Everything in this
section is a one-time setup plus a short per-release checklist. Until step 8.1 is done, the
release workflow produces **nothing at all** — deliberately. There is no unsigned fallback,
because an unsigned installer on a product that also binds a LAN socket is a remote-code-execution
path, not a stopgap.

### 8.1 The certificates somebody has to buy

None of this can be generated, borrowed or faked. Three things must be purchased and held by
the business, and each takes real calendar time to obtain:

| What | Where it comes from | Realistic lead time |
|---|---|---|
| **Apple Developer ID Application certificate** | Apple Developer Program membership (~$99/year). Create the certificate in the Apple Developer portal → Certificates → "Developer ID Application", then export it from Keychain Access as a `.p12` **with a password** | Days — Apple verifies the organisation, and a company enrolment needs a D-U-N-S number |
| **Apple App Store Connect API key** (for notarization) | App Store Connect → Users and Access → Integrations → Keys → generate. Downloads once as `AuthKey_XXXXXXXX.p8` and can never be downloaded again. Note the **Key ID** and the **Issuer ID** shown on that page | Minutes, once the membership exists |
| **Windows OV or EV code-signing certificate** | A commercial CA (DigiCert, Sectigo, SSL.com, GlobalSign). OV comes as a `.p12`/`.pfx`. **EV is held in an HSM and has no exportable file** | Days to weeks — the CA does its own business verification |

Two notes that decide how §8.2 is configured:

- **OV vs EV changes the wiring.** An OV certificate exports to a `.pfx` and works with the
  `WINDOWS_CERTIFICATE_PFX` secret below. An **EV** certificate cannot be exported at all;
  switch `win.signtoolOptions` in `apps/desktop/electron-builder.yml` to `win.azureSignOptions`
  (Azure Trusted Signing) and supply `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
  `AZURE_CLIENT_SECRET` instead. electron-builder refuses to use both and silently prefers
  Azure if both are present.
- **SmartScreen reputation is earned, not bought, on an OV certificate.** The first few hundred
  downloads of a freshly-OV-signed installer still show a SmartScreen warning. EV skips that.
  Budget for it either way — do not promise a client a warning-free first install.

### 8.2 The secrets and variables a maintainer must create

All of these live in the GitHub repository's **Settings → Secrets and variables → Actions**.
`.github/workflows/release.yml`'s `preflight` job checks every one of them for emptiness and
fails the whole run, naming all the missing ones at once, before anything is built.

**Secrets** (Settings → Secrets and variables → Actions → *Secrets* tab):

| Secret | What it is | How to produce its value |
|---|---|---|
| `MACOS_CERTIFICATE_P12` | The Developer ID Application certificate | `base64 -i DeveloperID.p12 \| pbcopy` — electron-builder reads it as `CSC_LINK` and accepts base64 directly |
| `MACOS_CERTIFICATE_PASSWORD` | The password set when exporting that `.p12` | Type it. Read as `CSC_KEY_PASSWORD` |
| `APPLE_API_KEY_P8` | The App Store Connect private key | `base64 -i AuthKey_XXXXXXXX.p8 \| pbcopy`. The workflow decodes it to a `0600` file on the runner and points `APPLE_API_KEY` at that **path** — `@electron/notarize@2.5.0` reads that variable as a file path, not as contents, whatever the electron-builder docs site says |
| `APPLE_API_KEY_ID` | The Key ID from the same App Store Connect page | Copy it. Read as `APPLE_API_KEY_ID` |
| `APPLE_API_ISSUER` | The Issuer ID from that page (a UUID) | Copy it. Read as `APPLE_API_ISSUER` |
| `WINDOWS_CERTIFICATE_PFX` | The Windows code-signing certificate (OV) | `base64 -w0 cert.pfx`. Read as `WIN_CSC_LINK` |
| `WINDOWS_CERTIFICATE_PASSWORD` | That certificate's password | Type it. Read as `WIN_CSC_KEY_PASSWORD` |

**Variables** (the *Variables* tab — not a secret, and it should be readable in logs):

| Variable | What it is |
|---|---|
| `MEZAN_UPDATE_FEED_URL` | The HTTPS base URL electron-updater will poll, e.g. the base URL of the release assets or an S3/self-hosted directory. `preflight` rejects anything that is not `https://`. It is passed to electron-builder as `--config.publish.url`, so the placeholder feed in `electron-builder.yml` is **overridden per release** rather than edited — a developer build can never inherit the production feed |

Nothing above is ever committed. `electron-builder.yml` holds no credential, no team ID and no
certificate path; every signing option in it activates from one of these variables and is inert
without it.

### 8.3 Cutting a release

1. Push a `v*` tag (or run the workflow manually — the draft-release step is tag-only).
2. `preflight` verifies every secret above exists and that the feed URL is HTTPS. **If anything
   is missing the run stops here and produces no artifact.** That is the intended behaviour, not
   a bug to work around.
3. The `macos` job packages, signs with the Developer ID certificate, and notarizes.
4. The `windows` job packages and signs with Authenticode plus an RFC-3161 timestamp.
5. **Each job then runs `apps/desktop/scripts/check-signed.mjs` against its own artifacts, on
   its own OS.** This is the gate — see §8.4.
6. Only if both pass does `draft-release` collect the artifacts, print a SHA-256 manifest, and
   open a **draft** GitHub release. A human reads the manifest and presses publish.

Linux is not on this path. AppImage and `.deb` carry no per-application signature that
electron-updater or the gate could verify, so a green Linux release would be a claim nobody
checked. Linux stays a CI test artifact.

### 8.4 What the gate actually checks, and why each check is there

`apps/desktop/scripts/check-signed.mjs` asks the operating system's own tools the same question
a customer's machine will ask. **Every path that cannot answer exits non-zero** — a missing
`codesign`, a missing `signtool` *and* PowerShell, an empty release directory, an unexpected
platform. "I could not tell" must never read as "it is fine".

On **macOS**:
- `codesign --verify --deep --strict` — the signature is intact.
- The signature is **not ad-hoc**, and its authority **is** a `Developer ID Application`
  certificate. `codesign --verify` passes on an ad-hoc signature, which carries no publisher at
  all — precisely the state in which electron-updater has nothing to verify a download against.
- `spctl --assess --type execute` reports `source=Notarized Developer ID`. This is the only
  check that can tell **notarized** from merely **signed**, and it is the reason the script
  exists: `mac.notarize: true` does not force notarization, it only means the integration was
  not switched off. With the Apple key variables missing, electron-builder logs "notarize
  options were unable to be generated", **succeeds**, and emits a signed DMG that Gatekeeper
  blocks on the customer's Mac.
- `xcrun stapler validate` on the DMG — the notarization ticket is stapled, so Gatekeeper can
  approve it on a machine with no internet. Most of these shops have a bad line.

On **Windows**:
- `signtool verify /pa /tw` (Authenticode policy; `/tw` makes "not timestamped" an error), or
  PowerShell `Get-AuthenticodeSignature` requiring `Status = Valid` **and** a timestamp
  certificate, when the Windows SDK is absent. An untimestamped signature stops verifying the
  day the certificate expires — retroactively, on every installer already in the field.

On **both**:
- The `app-update.yml` inside the packaged app points at a real HTTPS host, not the reserved
  `.example` placeholder. A release shipped pointed at nothing teaches the field that "updates
  don't work here", which is how the whole mechanism dies.

### 8.5 Verifying a signed build by hand before it goes out

The gate already ran in CI. Do this anyway for the first release from a new certificate, on a
machine that is not the build machine:

```sh
# macOS — download the DMG, then:
codesign --verify --deep --strict --verbose=2 /Volumes/Mezan/Mezan.app
codesign --display --verbose=4 /Volumes/Mezan/Mezan.app   # Authority= must say Developer ID Application
spctl --assess --type execute --verbose=4 /Volumes/Mezan/Mezan.app   # must say: source=Notarized Developer ID
xcrun stapler validate ~/Downloads/Mezan-x.y.z.dmg
```

```powershell
# Windows — download the .exe, then:
Get-AuthenticodeSignature .\Mezan-Setup-x.y.z.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
# Status must be Valid, and TimeStamperCertificate must not be empty.
```

Then do the thing no command can do for you: **double-click the installer on a clean machine
that has never seen this product**, and confirm neither Gatekeeper nor SmartScreen shows a
warning that would make a shop owner cancel. That is the actual acceptance criterion — the
whole point of §8 is a client who is not asked to click past a security warning to install
their accounting system.

### 8.6 What is still impossible without real certificates

To be plain about the boundary of this work: everything above is configuration and verification.
**No signed Mezan installer has ever been produced**, because no certificate exists. Nothing in
this repository can be tested end-to-end against a real signature until the business buys one —
`check-signed.mjs` has been exercised against deliberately-unsigned and ad-hoc-signed bundles and
correctly refuses them, which is the half that can be proven without a purchase. Until then:
- Every build is unsigned, and §7's warning stands.
- The auto-updater refuses to run, by design, on every platform.
- `release.yml` fails at `preflight` and emits nothing.
