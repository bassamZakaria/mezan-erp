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

**On a packaged build, that account's password is random and printed nowhere** —
`resolveSeedAdminSecrets()` in `seed.ts` generates it with the same CSPRNG the session
tokens use, and does not hand it to you. "Packaged" here means `MEZAN_PACKAGED=1` (set by
`apps/desktop/src/main/index.ts` from Electron's own `app.isPackaged`) **or**
`NODE_ENV=production` — the desktop build and a headless server deployment both get the
random path. That second condition was narrowed away once, on the reasoning that only the
desktop edition has a first-run wizard to recover through, and put back deliberately: the
alternative is a container or `apps/server` box silently seeding an admin nobody can ever log
in as, which is worse than a server build sharing the published `Cyag@2026`. `apps/server/src/
index.ts` prints a freshly generated temporary password once, to the console, on the run that seeded it —
the desktop shell's `recovery-password.txt` and `--reset-admin` (§1.4) are both desktop-only and do
not exist on this surface, so watch the console on that first run or set
`MEZAN_SEED_ADMIN_PASSWORD` (§1.3) before it. This is
deliberate, and it is the fix for a real
defect (S7): before it, every Mezan install in the country shipped with the same seeded password
(`Cyag@2026`, the one every dev script and this doc's own test-plan section signs in with —
see `TESTING.md` §2.2), so an anonymous caller who knew that password held the company admin of
*any* Mezan install reachable on its shop wifi. **Do not try `Cyag@2026` on a packaged build —
it will not work, and it will not tell you why**: the login route answers a wrong password and an
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
has five steps on the desktop host, four on the browser build (`apps/web/src/login/FirstRunWizard.tsx`):

1. **Activate the licence** — a real **file import**, not a code box. «استيراد ملف الترخيص»
   opens a file picker, hands `license.mezan` to the same verifier the write gate uses, and
   reports **that verdict**: on acceptance, the plan, the seat count and the expiry the signed
   payload actually carries; on refusal, the reason. It used to accept any `XXXX-XXXX` string,
   call nothing, and show a green «مُفعّل» pill over an install where every save was about to
   be refused. Skipping this step is fine — the licence can be imported later from
   `الإعدادات ← الأجهزة المتصلة` — but a green pill now means the file verified.
2. **Administrator account** — `POST /bootstrap/admin` with the owner's real name (Arabic
   and, optionally, English), a real email, and a password **they** choose (at least 8 characters, entered twice). This call also
   idempotently seeds the empty database (chart of accounts, VAT, the main branch and
   warehouse, fiscal periods) if nothing has run `POST /bootstrap/seed` yet.
3. **«حماية النسخ الاحتياطية»** (desktop host only, required) — the owner sets a recovery
   passphrase, or saves the key card to a USB stick and confirms it is off the PC. «التالي» stays
   disabled until one is set. Without it no backup opens on replacement hardware. §4.1.1.
4. **Core data** — confirms/re-runs the same idempotent seed and shows what exists. This step
   runs `POST /bootstrap/seed` **after** step 2 has already claimed the tenant, so that route
   is deliberately **not** gated on claimed-ness. The invariant it actually enforces is
   emptiness, inside `seedIfEmpty` — a claimed-tenant guard here was tried and reverted,
   because it 409'd the wizard on its own next click on a brand-new install.
5. **Import** — hands off into the data migration wizard, §3 below.

After step 2, the seeded fallback account (`USER-ADMIN`) still exists in the database, password
unknown to anyone. It is not deleted and does not need to be — it plays no further role once
a real admin exists, and the product does not distinguish it from any other inactive-in-
practice account. Do not go looking for a way to "finish setting it up"; there isn't one, and
there does not need to be.

### 1.3 Scripted or unattended rollout: `MEZAN_SEED_ADMIN_PASSWORD`

For a rollout where the wizard's random password is inconvenient — a scripted deployment across
several machines, or a QA pass against a packaged build where you need a known credential —
set `MEZAN_SEED_ADMIN_PASSWORD` to a string of at least 8 characters **before the process that first seeds the
database starts**. `resolveSeedAdminSecrets()` reads it and pins the fallback admin's password to
that value instead of generating one; it does not affect anything after the wizard has
already claimed the tenant. `MEZAN_SEED_ADMIN_PASSWORD` set to anything shorter than 8 characters is ignored, silently, and a random password is generated as usual — check it took by
confirming you can sign in as `admin@cyag.example` with it before you walk away from the
machine.

This is not a substitute for §1.2. It exists so *you*, the person running the rollout, have
a known door in while you drive the wizard — not so the client's till ships with a shared password
across sites again. Do not leave `MEZAN_SEED_ADMIN_PASSWORD` set in an image or script that
multiple client machines are provisioned from unless every one of those machines is meant to
share that password until someone runs the wizard on it — which is exactly S7, reintroduced by
policy instead of by bug.

### 1.4 The recovery file, and what happens if nobody knows a password for this machine

Both pieces the security review called for now exist and are wired into the desktop shell
(`apps/desktop/src/main/recovery.ts`, called from `main/index.ts`):

- **`recovery-password.txt`, written beside the database, owner-only (`0600`) permissions.** On the
  launch that actually generates a random admin password — i.e. the first launch that seeds an
  empty tenant on a packaged build (`takeSeededAdminSecrets()` returns a one-shot,
  `generated: true` result exactly once) — the shell writes this file next to `mezan.db`, with
  the temporary password in both Arabic and English, and also prints it to stdout as a fallback for the
  one failure this can't protect against: a first launch that cannot write to its own data
  directory at all. **Read this file, or the console, once, then finish the wizard.**
- **The file deletes itself.** On every subsequent launch, if nothing was freshly generated
  that run, the shell calls `clearRecoveryPasswordIfClaimed()`, which checks the same
  `settings.tenantClaimedAt` fact §2 relies on and removes the file the moment it is true —
  i.e. the moment the wizard has actually run and a real admin exists. Do not rely on the file
  surviving past that point; if you need the generated password for a record, copy it out before
  finishing the wizard.
- **`--reset-admin`** mints a fresh random temporary password directly against the seeded admin account
  (`SEED_ADMIN_USER_ID`) and writes it into a NEW `recovery-password.txt` (reason `"reset"`), then
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
password reset protects nothing they could not already take, and would only cost the install. Do
not read this as a general precedent — it is specific to a machine's own local disk, not a
statement that permission checks elsewhere are optional.

**With both of these landed, §1.3's `MEZAN_SEED_ADMIN_PASSWORD` is now a convenience for a known
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
confirm they know their own password — you set it together, on step 2, in front of them), and if
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

- **Before a schema migration, and only then** (`backupThenMigrate`). The decision is taken
  from the file's own `PRAGMA user_version` stamp before the database is opened
  (`isMigrationPending`): equal to this build's schema version means nothing about the file's
  shape changes on this launch, and no backup is taken. It used to run unconditionally, on
  every cold start, before any window existed — measured at ~1.1 s per 88 MB, so minutes on a
  2 GB shop database against a dock icon that did nothing, which is a force-quit and a support
  call. When a migration **is** pending, the window opens **first** and shows the copy's
  progress. The archive is labelled `pre-update-<version>` so it can be found by name.
- **Once daily** while the app is running (`scheduleBackups`, a 24-hour interval from launch).
- **On app close** — on `before-quit`, and **awaited** with a 120-second bound. It used to be
  fired on `will-quit` and not awaited, so the process exited mid-write and the close backup
  effectively never completed. If the bound is hit the app quits anyway and logs it; the daily
  archive still stands.

Retention is GFS (Grandfather-Father-Son): **7 daily, 4 weekly, 12 monthly** backups are
kept, pruned automatically after each new one — see `apps/desktop/src/backup/retention.ts` if
you need the exact bucketing rule. Each backup is a `.mezanbak` archive: a transactionally
consistent SQLite snapshot (via SQLite's own online-backup API, safe to take mid-write)
plus a manifest carrying a checksum and row counts.

**Tell the client explicitly**: the backup folder lives on the SAME machine, on the SAME
disk, as the database it backs up. A GFS retention schedule protects against a bad write or
a "we deleted the wrong thing last Tuesday"; it does not protect against the laptop itself
being stolen, flooded or dying. Getting a copy of "Mezan Backups" off-machine is the
client's job — but the app now does the copying once a folder is chosen: **«مجلد ثانٍ للنسخ»**
in `الإعدادات ← النسخ الاحتياطي والاستعادة` takes a USB drive or a network share, and every
backup (daily, on-close, manual) is copied there as soon as it is sealed and verified, with
the same 7/4/12 GFS retention (`apps/desktop/src/backup/secondary-target.ts`). A missing stick
never fails the backup; the screen shows «فشل آخر نسخ إلى المجلد الثاني» until a copy lands
again. **Once a recovery secret is set (§4.1.1), those copies are portable**: each one is written
as a `.mezanbak.enc` sealed under the owner's recovery passphrase and opens on any machine with
it. Until one is set they are the machine-keyed `.mezanbak` and die with this PC — the screen
says which kind the newest copy is («آخر نسخة في المجلد الثاني …»). The local backups in "Mezan
Backups" are unchanged either way: still machine-keyed, still 7/4/12.

**Restore drills.** A backup that has never been restored is a hope, not a backup. Once a week
(after the daily backup, or ten minutes after launch on a shop that closes every evening), and
whenever the owner presses «شغّل اختبار الاستعادة الآن», the app restores the newest archive
into a throwaway sandbox under `Mezan Backups/.tmp`, opens it with this machine's key, and
checks the manifest, the checksum, `PRAGMA integrity_check`, the schema version and every
table's row count against the manifest; it then boots a backend over the sandbox copy and ties
the trial balance and the inventory, payables and receivables control accounts to their
sub-ledgers. Nothing touches the live database. Each run is appended to
`Mezan Backups/drills.jsonl` (pass / warn / fail, milliseconds, the failing check), and the
backup screen shows the history, the date of the last good drill, and a warning once it is more
than eight days old. "Warn" means the archive restores but its books do not tie — a books
question for the accountant, not a broken backup
(`apps/desktop/src/backup/drill-service.ts`, `drill-worker.ts`). The equivalent of QuickBooks
Desktop's Verify Data, run against the backup instead of the live file.

**For a one-off copy that has to open somewhere else, use «تصدير نسخة قابلة للنقل»** in
`الإعدادات ← النسخ الاحتياطي والاستعادة`. A scheduled archive is keyed to this machine and
dies with it (the key-card box below); the portable export re-encrypts one under a
**passphrase the owner picks**, so it opens on replacement hardware without carrying the key
card. It is an explicit action, never a schedule, and the passphrase is not recoverable —
`.mezanbak.enc`, scrypt + AES-256-GCM, minimum ten characters
(`apps/desktop/src/backup/portable-export.ts`). **It is restored with «استعادة نسخة قابلة
للنقل»**, on the same screen or on the first-run screen of a fresh install (§4.2): the file
is picked in an OS dialog, decrypted with the passphrase, verified, and then goes through the
same verified restore as any archive. Until 2026-09-19 nothing called the decrypt step at all
(D289), so the export could be written and never read back.

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
> **You no longer have to leave the app to deal with it.** `الإعدادات ← الأجهزة المتصلة`
> carries a warning banner — «ملفات حسّاسة ما زالت على هذا الجهاز» — that appears **only while
> a risky file still exists**, names its full path (LTR and selectable), and offers two
> actions per file: «افتح مجلد الملف» to reveal it in Finder/Explorer, and «تم — احذف الملف»,
> which asks for a confirmation before it unlinks. The banner covers **both** files: the key
> card and the pre-conversion plaintext archive below. When neither exists, it renders nothing.
>
> **The protection step (§4.1.1) is the in-app way to deal with it**: choosing «ملف مفتاح
> التشفير» there saves the card to a USB stick and makes its key the recovery secret, so the
> second-folder copies open on a new computer with that key typed as the passphrase. Choosing a
> passphrase instead does not make the card harmless — it still opens the local archives — so the
> steps below still apply.
>
> **On install day, in front of the owner:**
> 1. Open the banner's «افتح مجلد الملف», or open `database-key.txt` directly.
> 2. Copy the key into the client's safe, their password manager, or a notebook that lives
>    somewhere other than this building.
> 3. **Press «تم — احذف الملف» and confirm** (or delete the file by hand).
> 4. Tell them, in these words: *anyone holding this key and one backup archive can read your
>    entire books — customers, prices, salaries.* It is a bearer secret. It does not go over
>    WhatsApp and it does not go in an email.
>
> If the owner lost it, `<mezan-binary> --export-database-key` writes it again and exits.
> If the owner never kept it and the machine is already dead, there is nothing to run it on.

**The pre-conversion safety archive is PLAINTEXT.** When an existing unencrypted install is
converted (see below), the safety backup taken beforehand was made from a plaintext database
and is therefore itself plaintext. The startup log names its path and says
`UNENCRYPTED — delete it once you trust this build`, and the warning banner in
`الإعدادات ← الأجهزة المتصلة` names it too, with the same reveal-and-delete pair as the key
card. Nothing deletes it automatically, on purpose: silently destroying the only
pre-conversion copy of a shop's books to tidy up is the worse failure. Delete it once the
converted install has been used for real work.

### 4.1.1 «حماية النسخ الاحتياطية» — the recovery secret (required on a new install)

The first-run wizard now runs **licence → administrator → «حماية النسخ الاحتياطية» → base data →
import**, and the protection step cannot be skipped on the desktop host. The owner picks one of:

- **A recovery passphrase** — at least 10 characters, typed twice, with a strength hint, and a
  tick-box acknowledging that it cannot be recovered and is the only way to open the backups on
  another computer. *Neither we nor support can recover it.*
- **The key card** — «احفظ ملف المفتاح على فلاشة» writes `database-key.txt`'s content to a
  place the owner picks in a save dialog (a USB stick, not this disk), then a tick-box confirms it
  has been moved off the PC. The key printed on that card is then the recovery secret: on a new
  computer it is typed into the passphrase box. Only offered on an encrypted install.

**What is stored, and what is not.** The secret itself is never written anywhere. At set time a
random 16-byte salt is drawn and the secret is run through **scrypt (N=2^15, r=8, p=1) → 32-byte
key** — exactly the KDF and parameters of the MEZANPBK1 portable format. That derived key is sealed
with the OS keychain (`safeStorage`, the same store that seals the database key) and kept with the
salt in `Mezan Backups/.recovery-key.json` (0600). Every scheduled, on-close and manual backup
then writes its second-folder copy as: snapshot decrypted off-thread in the backup worker into a
private scratch directory under `Mezan Backups/.tmp/second-copy-*` → verified → sealed with
**AES-256-GCM**, the stored salt and a fresh 12-byte IV in the MEZANPBK1 header → written to the
second folder → scratch deleted (and swept on the next launch if the app died mid-copy). Because
the salt is in every file's header, `decryptFile(passphrase)` re-derives the key from the
passphrase alone on any machine; a wrong passphrase fails the GCM tag and is refused. If the
portable copy cannot be prepared (disk full, keychain refused), the machine-keyed archive is
copied instead and the screen says the last copy is not portable.

**Installs that never set one.** An install upgraded from an earlier build has no recovery secret.
Until it is set, the backup screen carries a red banner — «النسخ الاحتياطية لا تُفتح إلا على هذا
الجهاز» — with a button straight to the form, the dashboard shows «احمِ نسخك الاحتياطية» to anyone
holding `admin.backup.restore` with a one-click inline form, and the health console's backup item
(ENH-E3-10) turns **warn** with «لم تُحدَّد كلمة سر لاسترداد النسخ». None of these appear on a LAN
till: a till owns no backups, its backup channels answer «النسخ الاحتياطي يُدار من الجهاز
الرئيسي», and every surface renders nothing on that answer. On a machine with no OS keyring the
form says protection cannot be turned on there (and the first-run step lets the owner continue).

**Changing it.** «تغيير كلمة السر أو الطريقة» on the backup screen asks for the new secret and the
signed-in user's **current password**, which the main process proves through the backend's own
`POST /auth/step-up` — so a wrong password counts on the same lock-out ladder as a wrong sign-in. Only
**future** second-folder copies use the new secret. **Copies already written keep the old
passphrase and are never rewritten** — tell the owner to keep the old one for as long as those
copies matter. Setting and changing are written to the security audit trail
(`backup.recovery.set` / `backup.recovery.changed` / `backup.recovery.keyCardSaved`, WARNING).

### 4.2 Restoring onto replacement hardware

**Read the key-card box in §4.1 first. On replacement hardware it is the whole ballgame:** an
encrypted archive restored onto a machine that does not hold its key fails at the integrity
check with `BackupKeyMismatchError` and cannot be opened by anyone, ever. Bring the key with
you to the new machine, or do not bother bringing the archive.

Two cases behave differently, and it is worth knowing which one you are in:

- **A local archive (`.mezanbak`) taken from an ENCRYPTED install** carries no key inside it and
  restores only onto the same machine and OS user account it came from. There is no screen that
  takes a foreign database key for a `.mezanbak`; on replacement hardware use one of the two
  `.mezanbak.enc` routes below instead.
- **A legacy archive taken before encryption existed** is plaintext, and still restores
  normally onto an encrypted install. The restored file lands as plaintext and **the next
  launch converts it** to encrypted storage under this machine's own key. Nothing special to
  do; just expect the conversion message on the following start.

- **A second-folder copy (`mezan-backup-…mezanbak.enc`, written once a recovery secret is set)**
  opens anywhere with the recovery passphrase — or, if the owner chose the key card, with the key
  printed on it — through «استعادة نسخة قابلة للنقل». This is the normal route after a dead PC.
- **A portable export (`mezan-portable-…mezanbak.enc`)** carries no machine key at all: it opens
  anywhere with the passphrase chosen at export, through the same «استعادة نسخة قابلة للنقل».

**Restore on a brand-new PC, step by step:**

1. Install Mezan on the new machine and start it. It opens «الإعداد الأولي».
2. On the first step, import the licence issued for the new machine (the licence is not in the
   backup).
3. On the same step, under «استعادة نسخة قابلة للنقل», press «اختر الملف» and pick the newest
   `.mezanbak.enc` from the USB stick / network share that was the «مجلد ثانٍ للنسخ» (or a portable
   export).
4. Type the recovery passphrase (or the key-card key) and press restore. The file is decrypted,
   its checksum and `integrity_check` are verified, and a copy made by a newer build is refused —
   all before anything on disk changes. A wrong passphrase leaves the install untouched.
5. The database is re-keyed to the new machine's own key and the app relaunches onto the login
   screen. Sign in with a password from the old machine (or `--reset-admin`, §1.4).
6. The recovery secret does **not** travel with the books (its sealed key belongs to the old
   machine's keychain), so the backup screen shows the protection banner again: set the passphrase
   once more and pick the second folder again.

The same «استعادة نسخة قابلة للنقل» is on the backup screen of a running install.

The restore machinery is wired end to end and driven from the settings screen and the
first-run screen (see below).

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
- **Authorization is the live session, not the renderer's word for anything.** Every
  channel (`mezan:backup:*`, exposed as `window.mezan.backup.*` via the preload bridge) takes
  the caller's session token and checks it against the SAME session registry every HTTP route
  checks against. `admin.backup.view` lets someone list the archives, read the drill history
  and run a restore drill (it verifies, it never changes the books); `admin.backup.restore`
  is needed to take a backup, restore, revert, export or import a portable copy, and choose
  the second folder. The archive to restore is named by a bare filename validated against
  path traversal, and a portable file is picked in an OS dialog in the main process — the
  renderer never supplies a path.

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
path underneath. **On replacement hardware, the first-run screen is the way in.** A fresh
install opens «الإعداد الأولي», and its first step carries «استعادة نسخة قابلة للنقل»: pick the
`.mezanbak.enc`, type the passphrase, and the books come back before any account is created —
no key card needed, because the portable export is encrypted under the passphrase, not the dead
machine's key. It works without a sign-in only while this install's tenant is unclaimed, the
same rule the licence import uses. The imported database is re-keyed to this machine's key
before the relaunch, then the login screen asks for a password from the old machine (or use
`--reset-admin`, below). An archive written by a NEWER build is refused before anything is
touched ("حدّث البرنامج على هذا الجهاز أولاً"). The licence is a separate file and is not in
the backup: install the licence issued for this machine at the same step. Only if the app
installs but will not start at all is a manual file operation the last resort: with the app
fully closed, extract the chosen `.mezanbak` and copy its database over `<userData>/mezan.db`
by hand — you lose the safety-backup-first behaviour and the checksum/integrity re-check the
screen gives you for free, so prefer the screen whenever the app runs at all.

**What a restored database means for credentials — this is the part that catches people out.**
A backup taken from a working install is, by definition, from a tenant that has already been
claimed (`settings.tenantClaimedAt` is set). Restoring it does not reopen §2's bootstrap door —
the wizard will not offer to create a new admin on a restored database, because the fact that
this tenant was claimed travels with the backup. **The way in is a password somebody already knows
from the machine the backup came from, OR `--reset-admin` run against the restored database**
(§1.4) — the seeded fallback admin account is still in that database even on a long-claimed
tenant, the flag mints it a fresh temporary password and reactivates it if it had been deactivated, and both
are authorised purely by filesystem access to the restored machine, exactly as they would be
on the original one. This closed what used to be a genuine dead end: before `--reset-admin`
existed, a replacement-hardware setup where nobody had a working login for the tenant — the
owner unreachable, the password never written down, the dead machine the only one anyone was ever
logged into — had no way back in short of hand-editing a scrypt hash into the SQLite file.
Still worth doing anyway: capture a working admin credential (or set `MEZAN_SEED_ADMIN_PASSWORD` at
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
| `--reset-admin` | Mints a fresh random temporary password for the seeded admin, prints it, and exits (§1.4) | Nobody has a working login on this install |

All three are authorised by filesystem access to the database directory and nothing else.
None is reachable over the LAN socket, over IPC, or from the renderer.

---

## 5. Login lockout on training day

`packages/api/src/login-throttle.ts` — five consecutive wrong passwords against one account start
a lockout: 60 seconds, then doubling with each further failure (120s, 240s, …) to a ceiling of
**15 minutes**. A quiet hour (no failures for 60 minutes) forgets the streak entirely.

**A served lock steps the ladder down ONE RUNG — it does not reset the streak to zero.** That
reset-to-zero behaviour was this file's first fix and did not survive contact with its own
suite: giving a served lock a full five free attempts again means 7,200 guesses a day are
available for free, which lets a patient guesser try far more passwords than the doubling ceiling is supposed to allow. Stepping down one rung instead keeps
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
  why one till fumbling its trainee's password five times does not lock a different till signed in
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
   own password rather than the lockout it actually was.
2. **`POST /users/:id/unlock`**, gated on `admin.users.unlock` (a role granted separately from
   `admin.users.edit`, so a branch manager standing at the counter can clear a lockout without
   also holding every colleague's password). Clears the lock **and resets the streak** on every key
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
Entitlements come from the **verified `license.mezan`** — the Ed25519 signature, the machine
binding and the expiry are all checked before a single seat exists (§7). `MEZAN_ENTITLEMENTS_JSON`
is a dev-only convenience on an **unpackaged** build and is refused outright by a packaged one;
earlier revisions of this document described it as the source of entitlements, which it has not
been since the licence verifier was wired. Absent or invalid entitlements resolve to fully
unlicensed (zero seats, no features), never to a permissive default — an unlicensed install
opens no LAN socket at all.

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

**When it is NOT running, the screen names which of four faults it is.**
«خدمة الشبكة المحلية غير مشغّلة» used to cover all four, with the distinguishing reason on a
console the shop never opens — one sentence, four different fixes, none of them named:

| Reason | What happened | The fix |
|---|---|---|
| `NOT_LICENSED` | the licence does not carry `lan.multi_till` | a new licence file (§7A.3) |
| `PORT_IN_USE` | another program, or a second copy of Mezan, holds 4173 | close it and restart |
| `TLS_UNAVAILABLE` | the identity beside the database could not be read, and **no plain-HTTP socket was opened in its place** | restore the PEM pair; deleting them re-pairs every till (§6.3) |
| `NO_INTERFACE` | this machine is attached to no network, so there is no address to hand out | connect the cable or wifi and restart |

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

**Do this once per till, at the counter, before you type a password into it. If you skip it, the
TLS in §6.1 protects the shop against a passive listener and against nobody else.**

The host's certificate is self-signed. No public certificate authority will ever certify
`192.168.1.7`, and most of these installs have no internet at all, so there is no chain for a
till to validate. What the till trusts instead is **this** certificate's fingerprint, which it
remembers from the first connection — and the only thing that makes that first connection
trustworthy is a person comparing two strings.

**The procedure is in the app now.** It used to be a command-line flag on each machine
(`--pair-host` / `--pair-fingerprint`), which meant a shop could never add its own fourth till.
Those flags still work and are still the right tool for scripting twelve machines in an
afternoon (§7A.3); everything below is what an operator does without one.

1. On the **host** machine, open `الإعدادات ← الأجهزة المتصلة` (Settings → Connected Devices).
   Read the two values in §6.1: the `https://<address>:<port>` URL and the `sha256=AB:CD:…`
   fingerprint. Leave that screen open.
2. On the **till** — a fresh install, nobody has set it up yet — press
   **«الاتصال بجهاز رئيسي»** on the login screen. The link appears only on a machine that
   holds no books; it is absent on a live host, because pairing one would orphan the ledger.
3. The till lists the hosts it can see. Discovery is `_mezan._tcp` over mDNS and it is a
   **convenience only** — anything on the wifi can advertise, and plenty of shop networks
   block multicast outright, so an empty list is normal and **«اكتب عنوان الجهاز الرئيسي»**
   is always available. Pick the host, or type the URL from step 1.
4. The till completes a TLS handshake, reads the certificate that machine **presented**, and
   shows it — grouped in fours, LTR, next to nothing else. **Nothing has been sent to that
   address at this point, and nothing will be until step 6.**
5. **Compare the two strings, character by character, standing in the shop with both screens
   in front of you.** Not "it starts with AB and ends with 9F". The whole string. The
   advertised fingerprint from step 3 is *not* what you compare — only the one the handshake
   presented, which is the value the till will pin.
6. **Match → press «الشهادتان متطابقتان — اقترن».** The till re-reads the certificate at that
   instant (so a host swapped mid-comparison is refused), writes `client.json`, moves its own
   empty database aside, and restarts as a till. From then on it trusts only this certificate.
7. **Mismatch → STOP.** Do not pin, do not type a password, do not "try again". A different
   certificate on that address means something other than the host answered you. Disconnect
   the till from the network and find out what, before any credential goes near it.

**A paired till that later meets a different certificate** shows a dedicated screen rather
than a console line and a 502: it names the address, states that **nothing was sent**, shows
the expected and the presented fingerprints side by side, warns you to stop, and offers
**«إعادة الاقتران»** — which re-runs steps 3–6, comparison included. There is no "trust it
anyway" button, and there must never be one.

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

**Three claims this section used to make are gone, and none should be repeated to a client.**
It said *licence verification is a stub* and that entitlements came from
`MEZAN_ENTITLEMENTS_JSON`: both were stale — the Ed25519 verifier drives the write gate and the
module gates, and a packaged build refuses every environment override of the key, the salt, the
check-in address and the licence path. It also documented `MEZAN_AUTO_UPDATE_INSTALL=1` as the
flag that gates an install; no such variable exists or ever did (below). What is genuinely
still open is the list that follows, and the certificates in §8.1.

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
  `apps/desktop/src/main/encrypted-database.ts`. **Every scheduled archive is encrypted, by
  default and with no way to turn it off.** `scheduleBackups` no longer takes a `portable`
  option at all: it used to be passed unconditionally by the call site, which rekeyed each
  daily archive to plaintext and left `~/Mezan Backups` holding the shop's complete books —
  customers, prices, salaries — readable by anyone who picked up the USB stick. Nobody chose
  that; it was inherited from the caller. An existing plaintext install is converted on first
  launch, and takes a full verified backup **before** a byte of the plaintext file is touched.
  What you must still tell the client:
  - **The key is bound to this machine and this OS account, and so every backup is.** That is
    the point — a stolen disk is useless — and it is also why losing the machine loses the
    backups unless the key was written down. On first encryption the app writes
    `database-key.txt` beside the database (owner-only) containing the key in Arabic and
    English, and warns on **every** launch while that file is still there. The warning is on
    screen too, in `الإعدادات ← الأجهزة المتصلة`, with «افتح مجلد الملف» and a confirmed
    «تم — احذف الملف» beside the path. **Copy it into the client's safe or password manager
    and delete the file, in front of them, on install day.** `--export-database-key` writes it
    again for an owner who lost it.
  - **An off-machine copy is an explicit act, not a default.** «تصدير نسخة قابلة للنقل» in
    `الإعدادات ← النسخ الاحتياطي والاستعادة` asks for a passphrase (ten characters minimum),
    derives a key with scrypt and writes a `.mezanbak.enc` under AES-256-GCM
    (`backup/portable-export.ts`). That archive opens on other hardware — which is exactly why
    it must never be produced casually and why the passphrase is not recoverable. A wrong
    passphrase fails the GCM tag check and is refused, never half-decrypted.
  - **A schema-changing update takes its own archive, and it is one button to go back.**
    When a launch brings a migration the app opens the window first, copies the database to a
    `pre-update-<version>` archive, and only then migrates. «الرجوع إلى ما قبل التحديث» on the
    backup screen restores that specific archive — named rather than left for an owner to guess
    which timestamp came before the version that broke their books. On a launch with no pending
    migration, no archive is taken and nothing is copied: that check is `PRAGMA user_version`,
    read before the database is opened.
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
- **The auto-updater refuses rather than trusts, and nothing about it is set from the
  environment any more.** The launch-time check runs only with `MEZAN_AUTO_UPDATE=1`; the
  operator's own check, download and install are always available from the update banner and
  from «الإعدادات ← الصيانة والتحديثات». There is **no `MEZAN_AUTO_UPDATE_INSTALL`** — it was
  documented here and read by nothing. Consent is now a dialog that names the tills currently
  connected, defaults to "install after the app closes", and refuses an immediate install
  during shop hours unless the operator ticks a box saying they mean it.

  Three gates stand between a feed and a running installer, and all three must pass:
  1. **The vendor Ed25519 signature over `version || channel || arch || sha512`.** The public
     key is **compiled into the build** (`scripts/build.mjs`'s `define`, fed from
     `MEZAN_UPDATE_PUBLIC_KEY` in the release workflow) and a packaged app ignores the
     environment for it — a trust anchor the launching environment can set is not a trust
     anchor. Signing the tuple rather than the hash alone is what stops an old, genuinely
     signed installer republished under a higher version: a downgrade from a compromised feed.
     The signature is fetched from `<feed>/<version>-<platform>-<arch>.sig`.
  2. **The downloaded bytes are re-hashed and the signature re-checked** before the installer is
     handed to the OS.
  3. **The running app's own signature.** An unsigned app has no publisher, so electron-updater
     has nothing to verify a download against, and this product also binds a LAN socket — anyone
     on the shop wifi could answer for the update feed. The old escape hatch,
     `MEZAN_AUTO_UPDATE_ALLOW_UNSIGNED=1`, **no longer exists in a shipped build**: it is a
     build-time flag (`MEZAN_ALLOW_UNSIGNED_UPDATES=1` when running `build:main`) that is false
     in everything the release workflow produces.

  A build with **no vendor key and no feed** — which is every build today — is not an error
  state. Pressing «ابحث عن تحديثات» answers «لا تتوفر تحديثات تلقائية في هذه النسخة — التحديث
  يتم بتثبيت نسخة جديدة» once, and the notice can be dismissed.
- **License verification is real, and it is the ONE source of both entitlements and write
  permission.** The install reads `license.mezan` from its userData directory, verifies the
  Ed25519 signature against the vendor public key **baked into the build** (esbuild `define`,
  `apps/desktop/scripts/build.mjs`), then checks the monotonic-clock guard, `notBefore`, the
  machine binding and expiry/grace — `packages/domain/src/licensing/license.ts` driven by
  `main/license.ts` + `main/license-runtime.ts`. `MEZAN_ENTITLEMENTS_JSON` survives only as a
  developer convenience on an **unpackaged** build; a packaged one refuses every environment
  override of the key, the salt, the check-in address and the licence path, because a licence
  check anybody can switch off from a shortcut's Properties dialog is not a licence check.
  What you must still tell the client:
  - **A build made without `MEZAN_LICENSE_PUBLIC_KEY` cannot verify anything, and says so** —
    «هذه النسخة من ميزان بُنيت بدون مفتاح المورّد» with the code `LIC-NOKEY`, deliberately
    different from «لا يوجد ترخيص». If you meet that sentence, the installer is wrong, not the
    customer's licence. Get a correctly built one; do not go looking for the licence file.
  - **A lapse never withholds data.** Past `expiresAt` there is a writable grace window, then
    READ_ONLY: every record stays readable, printable and exportable and only new postings are
    refused, server-side, at one choke point (`packages/api/src/license-gate.ts`). **The app
    never refuses to start on a licence verdict** — not on expiry, not on a revocation, not
    30 days past a missed check-in. It opens, and it explains.
  - **The verdict is re-read on every request.** Pressing «تحقّق الآن» lifts read-only there
    and then, and a licence that expires mid-session is noticed without a restart.
  - **Modules are gated now.** A licence's `activeModules` decides which route groups the API
    serves, in Arabic when it refuses (`packages/api/src/module-gate.ts`). A Core licence gets
    403 on manufacturing, HR and fixed assets rather than serving them. Platform surface —
    settings, users, roles, documents, reports, backup, `/auth`, `/license` — is never gated;
    a licence that locked the owner out of the screen explaining the problem would be worse
    than no licence at all.
  - **The online check-in is enforced, and it is the one thing here that needs connectivity.**
    ≤7 days: normal. >7 days: READ_ONLY, with the Arabic sentence saying *connect to the
    internet*, never *renew*. >30 days: still READ_ONLY, with a blocking notice. Only a
    **signed** answer from the licensing service moves that clock or revokes anything; an
    outage, a DNS hiccup or an offline shop is never read as a revocation.
  - **The anti-rollback record is sealed.** `license-guard.json` in userData holds the clock
    high-water mark, the last verified time and the install stamp under an HMAC. On an
    encrypted install the HMAC key is derived from the database key; on an install started
    with `--allow-unencrypted-database` it is a secret the install mints for itself
    (`license-guard.key`, beside the record, readable by the owner only). What each change
    really does:
    - **Editing** the record, stripping its HMAC, or deleting `license-guard.key` while the
      record stays: TAMPERED, read-only (`GUARD_TAMPERED`).
    - **Deleting** the record: the install
      reads as never having checked in, so the clock starts at the licence's own signed
      `notBefore` — not at today. Past seven days from that date it is read-only with
      `CHECKIN_OVERDUE` until one signed check-in succeeds. It does not resolve to TAMPERED,
      and it does not buy a fresh week.
    - **A record an earlier build wrote with no HMAC** (unencrypted installs only) is sealed on
      the first launch of this build. What it claimed about the last check-in and the install
      date is dropped, so that install is read-only until its next signed check-in if the
      licence started more than seven days ago.
    The unencrypted case raises the bar from editing a date to forging an HMAC; it cannot
    stop someone who reads the secret from the same folder. Encryption at rest is what does.
  - **The machine fingerprint is obtainable, by the owner, without a terminal.** It is on the
    licence banner, on `الإعدادات ← الأجهزة المتصلة`, and on the «معلومات الدعم» card in
    `الإعدادات ← عام` beside the version, the `LIC-*` code, the host URL and the paths — LTR,
    copyable, with one button that copies the lot. `Mezan --print-machine-fingerprint` prints
    it and exits for anyone who
    would rather read it down the phone. It is a salted hash, never the machine's raw identity,
    so it is safe to send by any channel. Before this, a replacement PC met «مرتبط بجهاز آخر …
    تواصل مع الدعم» and **neither the owner nor support could obtain the one value the new
    licence needed.**
  - **Moving to a new machine is three steps the screen states.** `MACHINE_NOT_BOUND` no longer
    ends at "contact support": the banner names the fault, then lists (1) send this machine's
    fingerprint and support code to support, (2) support issues a new `license.mezan` bound to
    it, (3) press «استيراد ملف الترخيص», pick the file, read the verdict immediately. Issue the
    replacement with `--bind` passed **twice** during a handover — the old fingerprint and the
    new one — so the shop is never between two working machines (§7A.3).
- **The audit trail is now tamper-EVIDENT, which is not the same as tamper-proof.** A SQLite
  trigger refuses `UPDATE`/`DELETE` against audit rows from anything the application itself
  does — which is what closed several audit gaps this rollout depends on (a login lockout, a
  password reset, an approval-config change all now leave a row that cannot be quietly edited back
  out by the app). On top of it, each row carries the hash of the row before it, and the latest
  row's hash is held under an **HMAC whose key is not in the database**: on desktop it is
  derived from the sealed database key in the OS keychain. «تحقق من سلامة السجل» on the audit
  screen (`GET /audit/verify`) walks the chain and says whether it holds, which row broke it,
  and whether the head itself was altered. A restore writes a `CRITICAL` `backup.restored` row
  after the swap, so a restore is in the trail rather than being a way out of it. What to tell
  the client, plainly:
  - **Someone with the file can still destroy history — they cannot forge it.** The hashing
    algorithm is public, so a person with direct filesystem access to `mezan.db` (in practice,
    the company admin) can drop the trigger, delete rows and re-chain what remains. What they
    cannot produce is a head MAC that agrees, because that key is not in the file they hold.
    The result is a verification that fails, not a trail that lies.
  - **Detectable is only useful if someone looks.** Nothing checks the chain on a schedule;
    the verify button is a person's act. Restoring an older backup that never held the
    damaging entry is still invisible from inside.
  - Rows written before the chain existed carry no hash. They are reported as `unchained`, not
    as failures — the table is append-only, so they can never be back-filled.

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

**The vendor configuration must be in the environment OF THE BUILD, not of the app.** Three
values are substituted into the main bundle by esbuild `define` at the `build:main` step
(`apps/desktop/scripts/build.mjs`, `vendorDefine`), which `pnpm desktop:package` runs for you:

| Build-time variable | Without it |
|---|---|
| `MEZAN_LICENSE_PUBLIC_KEY` | No licence file can be verified. The app says «هذه النسخة من ميزان بُنيت بدون مفتاح المورّد» (`LIC-NOKEY`) — deliberately not «لا يوجد ترخيص», because the installer is wrong, not the customer |
| `MEZAN_LICENSE_CHECKIN_URL` | Nothing can confirm the licence online, so every install walks the same 7/30-day path to read-only. It is not an escape hatch |
| `MEZAN_UPDATE_PUBLIC_KEY` | No update can ever be verified, so none is ever installed |

`MEZAN_LICENSE_FINGERPRINT_SALT` is substituted alongside them and falls back to a published
default; changing it invalidates every licence already issued. The build **warns** on each one
it had to leave empty and carries on — that is what makes a local test build possible — so read
the `[build]` lines. The release workflow's `preflight` is what refuses to publish with any of
them empty (§8.2).

**A packaged app reads none of these from its own environment**, by design: a trust anchor the
launching environment can set is not a trust anchor. Getting them wrong here cannot be fixed
after packaging; it needs another build.

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

**1. On the host: put the licence where the app can read it.**

Ask support (or, if you are the vendor, run the two commands below) for a `license.mezan`
issued against **this machine's fingerprint**. Read the fingerprint off the host, either from
`الإعدادات ← الأجهزة المتصلة` or from a terminal:

```
Mezan --print-machine-fingerprint
```

It prints one salted hash and exits. It is safe to send by any channel — it is a hash, never
the machine's raw identity.

The vendor mints the file offline, with the signing key that never leaves their machine:

```
pnpm licence:keygen --out vendor-signing.key      # ONCE, ever. Keep it in the safe.
pnpm licence:issue \
  --key vendor-signing.key \
  --licensee "النور للتجارة والتوزيع" \
  --plan CORE \
  --modules sales,purchases,inventory,accounting,treasury \
  --seats 3 \
  --expires 2027-01-01 \
  --bind <the fingerprint from the step above> \
  --out license.mezan
```

Copy `license.mezan` into the host's userData directory — `%APPDATA%\Mezan` on Windows,
`~/Library/Application Support/Mezan` on macOS, `~/.config/Mezan` on Linux (logs:
`~/Library/Logs/Mezan` on macOS, `<userData>/logs` elsewhere) — or import it from
`الإعدادات ← الأجهزة المتصلة`, which puts it in the same place and shows the real verdict.
There is no `licence.json` and no `main/licence-file.ts`; earlier revisions of this document
described both, and a consultant who followed them produced an unlicensed install.

**Installs made before the folder was named.** Earlier builds kept everything in a folder
named after the package — `…/Application Support/desktop`, `%APPDATA%\desktop`,
`~/.config/desktop` (logs in `~/Library/Logs/desktop`). On its first start this build renames
that folder to `Mezan`, whole, in one step, and only when `Mezan` does not exist yet. It never
copies and never merges:

| What it finds | What it does |
|---|---|
| only `desktop`, holding books | renames it to `Mezan` and uses it |
| `Mezan` exists but holds no books, `desktop` does | keeps using `desktop` where it is |
| both hold books | uses the one whose `mezan.db` changed last, and shows a notice naming both paths |
| the rename fails or does not verify (another volume, a file in use) | keeps using `desktop` where it is |

The log's first lines say which (`[data-folder] …`). A launch given `--user-data-dir` is left
alone. The application's own name is unchanged on purpose: the operating system's key store
files the database key under it, so the Keychain entry is still `desktop Safe Storage`.

`--bind` is what makes the file worth something: an unbound licence runs on every PC it is
copied to. Pass `--bind` twice during a hardware handover so the shop is never between two
working machines.

**Modules are enforced.** `--modules` decides which parts of the API the install serves; a
licence that omits `manufacturing` answers 403 in Arabic on those routes. `lan.multi_till`
is a FEATURE, not a module — pass it as `--features lan.multi_till` if the client has bought
the second till.

**The check-in address, and what happens without one.** A build carries the licensing
service's URL baked in (`MEZAN_LICENSE_CHECKIN_URL`). An install that cannot confirm its
licence online goes read-only after 7 days and shows a blocking notice after 30 — it never
refuses to start, and its data stays readable, printable and exportable throughout. The
service itself is `apps/licence-server` (`POST /checkin`, `GET /health`), which answers from
a JSON revocation list and signs every answer with the same vendor key:

```
MEZAN_LICENSE_PRIVATE_KEY=<hex> MEZAN_REVOCATIONS=/var/lib/mezan/revocations.json pnpm licence:server
```

Run it behind a TLS terminator. If the client's site genuinely has no internet, say so before
the sale: this is the one part of Mezan that requires connectivity, and the honest answer is
a longer-dated licence, not a promise the software will not keep.

**2. Start the host and let the OS firewall let it in.** The socket binds, and the operating
system's own firewall silently drops the incoming connections until the app is allowed. This
is the single most likely reason a correctly configured client says "no answer from the host".

- **Windows**: the NSIS installer now adds the inbound rule itself — TCP 4173, **private and
  domain profiles only**, never the public profile, so a laptop tethered to a phone or sitting
  on hotel wifi does not publish the books (`apps/desktop/build/installer.nsh`). It needs
  elevation; an install that ran without it completes anyway and simply has no rule, which is
  what step 2a below is for.
- **macOS**: still manual — add the app under System Settings → Network → Firewall → Options.

**2a. Press «اختبر الوصول» on the host's «الأجهزة المتصلة» screen.** It opens a TCP connection
from the host to the host's *own* advertised address and reports what happened, which is the
one probe that separates the two faults a consultant otherwise cannot tell apart:

| What it says | What it means | What to do |
|---|---|---|
| الاتصال … ناجح | the socket is bound and reachable on this machine | the problem, if any, is between the till and here — read the till's own message |
| جدار الحماية يحجب المنفذ | packets do not arrive even locally | allow Mezan inbound on private networks (step 2) |
| الخدمة لا تستقبل اتصالات | nothing is listening | the LAN socket did not start — read the reason under «خدمة الشبكة المحلية غير مشغّلة» on the same screen |
| لا يوجد عنوان شبكة محلية | this machine is on no network | plug in the cable or join the wifi and restart |

From the **client's** side the same distinction is drawn in the failure message: a refused
connection says Mezan is not running on the host, and silence says a firewall is dropping the
packets or the machine is asleep. They used to be the same sentence.

**3. Open the host's «الأجهزة المتصلة» screen and leave it open.** It shows the address to
point a till at and the certificate fingerprint to compare against, both LTR and copyable.
The host also advertises itself on the subnet as `_mezan._tcp` with that fingerprint in TXT,
so a till can find it without anybody typing an IP — a convenience only; the comparison in
step 4 is what makes the pairing safe. Both values are still printed at startup:

```
[lan] multi-till host listening on https://192.168.1.7:4173 (seats=3, sha256=49:0E:…, routes=…)
```

**4. Pair each client.** Two ways, and they produce the same `client.json` (mode `0600`):

- **From the till itself** — press «الاتصال بجهاز رئيسي» on its login screen and follow §6.3.
  This is what a shop uses to add its own fourth till six months after you leave, and it is
  the only route that puts the fingerprint comparison in front of a person.
- **From a shortcut or a terminal**, for a rollout across a dozen machines:

  ```
  Mezan --pair-host=https://192.168.1.7:4173 --pair-fingerprint=49:0E:E0:… --device-label="مكتب المحاسب"
  ```

  It writes the file and exits, and refuses to run on a machine that already has a `mezan.db`
  — a client holds no books of its own and pairing would orphan them. **You still compare the
  fingerprint** (§6.3): the flag pins whatever you typed, so a typo pins nothing and a copied
  wrong value pins the wrong machine, silently and permanently.

Re-pairing an existing client keeps its `deviceId`, so repointing a till at a rebuilt host
does not burn a second seat.

**5. Start the client and sign in.** It claims a licensed seat automatically as part of
signing in, and re-announces itself every 15 seconds — the host reaps a device it has not
seen for 45 seconds, so without that heartbeat the app loads on login and goes empty a minute
later. If the licence has no free seat, the **login itself** is refused with an Arabic
message; there is deliberately no "signed in but seatless" state, because it renders as a
complete application in which every single screen is empty. One account holds **one** seat by
default (`maxSeatsPerUser`), so a cashier signing in on the counter and on the back office
does not consume both seats of a two-seat licence — give the second machine its own account.

**When the router reboots and the host's address changes**, the till does not need a visit.
Its message names the fault, and it searches the subnet for the certificate it pinned; finding
the same certificate at a new address is proof it is the same machine, so
«انتقل الجهاز الرئيسي إلى … — إعادة الاتصال؟» is one press. The address is also editable
directly on the till's own «الأجهزة المتصلة» panel. The **pinned certificate never changes**
either way, so neither path can walk a till onto a different machine.

### 7A.4 What a client cannot do, and says so

Backups and restore are the host's, and the licence panel on a client reports which host it is
paired with and which certificate it pinned rather than restating a licence it does not own.
The client also does **not** run the auto-updater: a client and its host must be the same
version, so the host is updated first, deliberately, by a person.

**Every one of those refusals is now an Arabic sentence, and the buttons that cannot work are
disabled.** A client startup registers no handler for the maintenance channels, and an
unregistered `ipcMain.handle` does not degrade to "no data" — it **rejects**. So «تحقّق من
الترخيص» and «ابحث عن تحديث» on a till answered with nothing happening at all, twice, and
neither caller had a `catch`. `apps/desktop/src/main/client-refusals.ts` now answers each one
with a refusal that names the reason and the host it belongs to:

| On a client | What it answers |
|---|---|
| licence check-in, licence file import | «الترخيص يُدار من الجهاز الرئيسي (`<host>`)…» / «ملف الترخيص يُثبَّت على الجهاز الرئيسي…» |
| update check / install | phase `unavailable`, reason `CLIENT_MACHINE` — **not** an error. A till genuinely cannot update itself, and reporting a fact about the machine as a failure puts «تعذّر إكمال التحديث» in front of a shop where nothing went wrong |
| backup now, revert to pre-update, portable export | «النسخ الاحتياطي يُدار من الجهاز الرئيسي (`<host>`). هذا الجهاز محطة متصلة ولا يحتفظ بقاعدة بيانات خاصة به.» |
| support diagnostic, reveal file, delete file | «هذا الجهاز محطة متصلة ولا يحتفظ بقاعدة بيانات. نفّذ هذا من الجهاز الرئيسي (`<host>`).» |

`الإعدادات ← الصيانة والتحديثات` states the same thing before anyone presses anything: on a
client it shows which host it is paired with, and «أخذ نسخة الآن» and «تحقّق من الترخيص الآن»
render **disabled**. «ابحث عن تحديثات» stays pressable — it answers calmly, with the
`CLIENT_MACHINE` notice rather than a red failure — and the panel's closing line states the
order: the host is updated first. A refusal a person reads before they press is worth more
than one they read after.

---

## 8. Release runbook — signing a build so a client can trust it

> **The workflow this section describes was removed on 2026-09-18**, with the rest of
> GitHub Actions, to stay inside the free plan: signing runs on macOS and Windows runners,
> which the free plan bills at 10× and 2×. Nothing below is wrong about how signing
> works — it is a record of how to restore it.
>
> **To bring it back, restore the newest version**, which is the one carrying the licence
> work (90 lines longer than the one `main` deleted):
> `git show 8b17879f:.github/workflows/release.yml > .github/workflows/release.yml`.
> Until then, desktop builds are made locally with `pnpm desktop:package` and are
> **unsigned** — which means SmartScreen and Gatekeeper will warn on install.

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
fails the whole run, naming all the missing ones at once, before anything is built. Two of them
are **not certificates and cannot be bought** — the Ed25519 update pair below is generated once
by the business and never rotated casually: changing it makes every install already in the field
refuse every future update, because the old public key is compiled into those builds.

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
| `MEZAN_UPDATE_SIGNING_KEY` | The vendor Ed25519 **private** seed that signs each release artifact | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, once, ever. Keep the only other copy offline. Anyone holding it can publish an update every install in the field will accept |
| `MEZAN_UPDATE_PUBLIC_KEY` | Its public half, **compiled into the app** | Derive it from the seed with `@noble/ed25519`'s `getPublicKeyAsync`, as 64 hex characters. `sign-release.mjs` refuses to sign if it is not the public half of the seed above — a mismatch would produce a flawless release nobody can install |
| `MEZAN_LICENSE_PUBLIC_KEY` | The vendor key licence files are verified against, likewise compiled in | See §7A; 64 hex characters |
| `MEZAN_LICENSE_FINGERPRINT_SALT` | Salts the machine fingerprint a licence is bound to | 32 random bytes as hex. Changing it invalidates every licence already issued |

**Variables** (the *Variables* tab — not a secret, and it should be readable in logs):

| Variable | What it is |
|---|---|
| `MEZAN_LICENSE_CHECKIN_URL` | The HTTPS endpoint an install confirms itself against. `preflight` rejects anything that is not `https://`, because a plain-HTTP check-in lets anyone on the path answer for the licensing service. Compiled into the build, not read from the environment |
| `MEZAN_UPDATE_FEED_URL` | The HTTPS base URL electron-updater will poll, e.g. the base URL of the release assets or an S3/self-hosted directory. `preflight` rejects anything that is not `https://`. It is passed to electron-builder as `--config.publish.url`, so the placeholder feed in `electron-builder.yml` is **overridden per release** rather than edited — a developer build can never inherit the production feed |

Nothing above is ever committed. `electron-builder.yml` holds no credential, no team ID and no
certificate path; every signing option in it activates from one of these variables and is inert
without it.

### 8.3 Cutting a release

1. Push a `v*` tag (or run the workflow manually — the draft-release step is tag-only).
2. `preflight` verifies every secret above exists and that the feed URL is HTTPS. **If anything
   is missing the run stops here and produces no artifact.** That is the intended behaviour, not
   a bug to work around.
3. Both jobs bundle the main process with the vendor keys **baked in** (`build:main` reads
   `MEZAN_UPDATE_PUBLIC_KEY`, `MEZAN_LICENSE_PUBLIC_KEY`, `MEZAN_LICENSE_CHECKIN_URL` and
   `MEZAN_LICENSE_FINGERPRINT_SALT` as esbuild `define`s). A packaged app reads none of them
   from the environment, which is why they must be right at THIS step and cannot be fixed later.
4. The `macos` job packages, signs with the Developer ID certificate, and notarizes.
5. The `windows` job packages and signs with Authenticode plus an RFC-3161 timestamp.
6. **Each job then runs `apps/desktop/scripts/check-signed.mjs` against its own artifacts, on
   its own OS.** This is the gate — see §8.4.
7. **Each job then runs `apps/desktop/scripts/sign-release.mjs`**, which reads the `latest*.yml`
   electron-builder just wrote, picks the ONE artifact per architecture the updater actually
   downloads (the `.zip` on macOS, the `.exe` on Windows — never the DMG), and writes
   `<version>-<platform>-<arch>.sig`: a detached Ed25519 signature over
   `version || channel || arch || sha512`. It verifies each signature with the public key before
   writing it, and refuses outright if the public key is not the signing key's own half. The
   `.sig` files are uploaded with the installers and must be published **to the same feed
   directory** as `latest.yml` / `latest-mac.yml`, or every install will refuse every update.
8. Only if all of that passes does `draft-release` collect the artifacts, print a SHA-256
   manifest, and open a **draft** GitHub release. A human reads the manifest and presses
   publish.

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

When the release workflow was in place, the gate ran there. Do this anyway for the first release from a new certificate, on a
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

---

## 9. Vendor operations

The half of licensing that is not on the customer's machine. It is four scripts and a JSON
file, deliberately: a service that could mint licences would be a service worth attacking.
§7A.3 walks the customer-facing sequence; this is the reference.

**The signing key. Once, ever.**

```
pnpm licence:keygen --out vendor-signing.key    # writes the private seed, mode 0600
pnpm licence:keygen                             # or print both halves to stdout
```

It prints `MEZAN_LICENSE_PUBLIC_KEY=<64 hex>` either way. The **public** half is what goes in
the release build environment (§7A.1, §8.2); the private seed signs every licence and every
check-in answer the product will ever accept. Losing it means no shop can be licensed or
renewed again; leaking it means anyone can mint licences. It belongs in the password manager or
an HSM — never in this repository, never in CI logs, never on a build machine.

**Issuing a licence.** `pnpm licence:issue` reads the key from `--key <file>` or
`MEZAN_LICENSE_PRIVATE_KEY` and writes a signed `license.mezan` (mode `0600`):

| Flag | Meaning |
|---|---|
| `--licensee` | The shop's registered name, in Arabic. Required |
| `--plan` | `CORE`, `STANDARD`, `ENTERPRISE` — a label. Required |
| `--modules` | Comma-separated, and **enforced**: routes outside this list answer 403 in Arabic. Required — a licence that activates nothing sells nothing |
| `--features` | Feature flags, e.g. `lan.multi_till`. A feature is not a module |
| `--seats` | Concurrent LAN seats. Default 1 |
| `--expires` | `YYYY-MM-DD` (taken as end of that day) or an ISO timestamp. Required |
| `--grace-days` | Writable window past expiry. Default 14 |
| `--not-before` | Start date; defaults to now. It is signed, and it is the check-in clock's origin — which is why deleting the local guard file cannot buy a fresh week |
| `--bind` | A machine fingerprint, **repeatable**. Empty means the file runs on every PC it is copied to. Pass it twice during a hardware handover |
| `--license-id`, `--edition`, `--out` | Override the generated id, the edition label, the output path |

It echoes the id, the plan, the seat count, the validity window, the bound machines and the
public key the file verifies against — check that last line matches the build the customer has.

**The check-in service.** `apps/licence-server` is two routes on `node:http` and no framework:

```
MEZAN_LICENSE_PRIVATE_KEY=<hex> \
MEZAN_REVOCATIONS=/var/lib/mezan/revocations.json \
PORT=8787 HOST=127.0.0.1 \
pnpm licence:server
```

`POST /checkin` takes `{licenseId, fingerprint}` and returns a **signed** answer; `GET /health`
reports whether it holds a key. It refuses to start without a 64-hex private seed — an unsigned
answer is worse than no answer, because an unsigned `{"revoked":true}` lets anyone on the path
switch a paying shop off. It listens on plain HTTP on purpose: **run it behind a TLS
terminator**, so the certificate is the operator's to manage and never this process's. A
malformed request is 400 and never a revocation; the install must be able to tell "I could not
be checked" (degrades over a month) from "you are revoked" (immediate).

**The revocation list is a JSON file a person edits**, at `MEZAN_REVOCATIONS`:

```json
{
  "revoked": ["lic-…"],
  "seen": { "lic-…": ["fingerprint-a", "fingerprint-b"] }
}
```

`revoked` is the decision. `seen` is the **evidence** for one, appended by the service as it
answers: one licence checking in from four fingerprints is the copied-file case the whole
scheme exists to catch. A missing or unparseable file revokes **nothing** — the failure mode of
a mistyped path must not be every customer switched off at once — so confirm the path took.

**Signing a release.** `apps/desktop/scripts/sign-release.mjs` runs in CI (§8.3 step 7) and can
be run by hand against a release directory:

```
MEZAN_UPDATE_SIGNING_KEY=<hex seed> MEZAN_UPDATE_PUBLIC_KEY=<hex public> \
node apps/desktop/scripts/sign-release.mjs --release-dir apps/desktop/release --channel latest
```

It reads the `latest*.yml` electron-builder wrote, picks the one artifact per architecture the
updater actually downloads (the `.zip` on macOS, the `.exe` on Windows — never the DMG), and
writes `<version>-<platform>-<arch>.sig`: a detached Ed25519 signature over
`version || channel || arch || sha512`. **The tuple, not the hash alone** — a signature bound to
bytes and nothing else lets an old installer we genuinely signed be republished under a higher
version on a feed somebody else controls, which is a downgrade to a build whose bugs are public.
It verifies each signature with the public key before writing it and exits non-zero on a missing
key, an unparseable feed, a public key that is not the seed's own half, or an artifact whose
architecture it cannot identify. The update-signing key is a **different** key from the licence
key, and `main/update-verify.ts` is the other half of this contract: change the separator, the
field order or the artifact-selection rule in one and every update stops verifying in the field.
