# Merging `test/w1e-saas-live-walk` (W1E) with `fix/w1d-audit-atomicity-billing` (W1D)

Measured with `git merge-tree --write-tree test/w1e-saas-live-walk fix/w1d-audit-atomicity-billing`
against W1D at `36168e5e`. Nothing was merged to write this. 36 files conflict; every other
file merges cleanly. Re-run the command before starting: a new commit on either side changes
the list.

One file that merges cleanly is still wrong afterwards: `packages/domain/src/users/index.ts`
takes W1D's export list, which names `UserState`. Rename it to `UserStatusCode` in the same
commit as the other 12 sites (see the enum table), or the package does not typecheck.

"Ours" is W1E, "theirs" is W1D.

## Order of work

1. Settle the three enum names (below) on a throwaway commit on each side first, so the merge
   itself carries no rename noise.
2. Merge, resolving in this order: `packages/domain` → `packages/contracts` →
   `packages/persistence` → `packages/api` → `packages/backend` → `apps/server` → `apps/web` → docs.
   Each layer typechecks before the next is touched.
3. Gates: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm smoke`,
   `pnpm check:seed`, `pnpm scenarios`, `pnpm test:saas` three times.

## Decisions that are not per-file

### Enum names — take W1E's three, keep W1D's constants

Neither name exists on `main`; each branch introduced its own.

| Value set | W1E (uses) | W1D (uses) | Take |
|---|---|---|---|
| tenant status | `TenantStatusCode` (105) | `TenantLifecycle` (6) | `TenantStatusCode` |
| subscription status | `SubscriptionStatusKind` (75) | `SubscriptionState` (6) | `SubscriptionStatusKind` |
| user status | `UserStatusCode` (33) | `UserState` (12) | `UserStatusCode` |

Counted with `git grep -ow <name> <branch> -- '*.ts' '*.tsx' | wc -l`, W1E at this commit and
W1D at `36168e5e`. W1E's names win on count alone: 213 use sites against 24. Rename W1D's 24
sites, `packages/domain/src/users/index.ts` among them.

W1E also names the card mode (`PaymobMode` in `apps/server/src/env.ts`); W1D still compares
`env.paymob.mode` to string literals in `billing-routes.ts`, `cloud-app.ts` and `cloud.ts`.
Take the enum at every site. W1D's
`RENEWABLE_SUBSCRIPTION_STATES` constant is kept as it is named and rewritten over
`SubscriptionStatusKind`; W1E's private `RENEWABLE` in `card-checkout.ts` and the inline list
in `applyRenewal` are replaced by it. On the wire, W1E's `SubscriptionStatusCode` and
`TenantWireStatus` in `packages/contracts/src/platform.ts` stay (they carry the `Unknown`
member a read answers for a value this build does not recognise); W1D's
`subscriptionStatusSchema = z.enum([...])` literal list is dropped in their favour.

### One audit-or-503 mechanism — W1D's, with W1E's owner writes moved onto it

Both sides define `PlatformAuditUnavailableError` in `packages/backend/src/platform-routes.ts`
with the same code (`AUDIT_UNAVAILABLE`), the same Arabic and English text and the same 503.
Take W1D's declaration and its `recordedWith` / `activationRecordedAs` helpers. W1E's
`auditOrRefuse` helper is deleted; its one caller (the owner PIN reset's `recordIntent`, which
writes `TENANT_OWNER_PIN_RESET_REQUESTED`) is rewritten as a `RecordedActivation`-style
callback so the dependency still calls it inside the platform transaction that takes the
fence. The outcome rows (`TENANT_OWNER_PIN_RESET` with `outcome: reset`, or
`TENANT_OWNER_PIN_RESET_REFUSED` with the tenant's outcome) stay route-level rows written
after the dependency returns, and an outcome row that cannot be written is logged, not turned
into a 503: the PIN has already moved.

### What W1D's audit sink asks of every W1E writer of `platform.audit`

Read from W1D at `36168e5e` (`packages/persistence/src/audit-sink.ts`,
`untransacted-audits.ts`, `sqlite-connection.ts`, `packages/api/src/audit-boundary.ts`,
`packages/api/src/test/turn-yield-guard.ts`):

- `SqliteAuditSink.append` writes the row synchronously, as a savepoint of the caller's
  transaction, when the caller's own async chain is inside `withSqliteTransaction` on that
  connection. Otherwise it opens a transaction of its own.
- `reportUntransactedAudit(label)` is called from `append` only when all three hold: the
  append is NOT inside the caller's transaction, the event is on the change-log stream
  (`AuditStreamName.Sensitive`), and the chain holds the connection's turn
  (`holdsSqliteTurn`). It logs the event, keeps the last 200 labels, and the row is still
  written. It never throws.
- `drainUntransactedAudits()` returns and clears those labels. Nothing in a server calls it.
  `turn-yield-guard.ts` drains it after every test, with `drainTurnYields()` and
  `drainForeignWrites()`, and fails the test when any of the three is non-empty.
- A mutating request under `connectionTurn(audit)` (every `/api/platform` route, the signup
  and billing routes, every tenant route) holds its connection's turn from its first
  statement to its last. Work that is not that connection's database, awaited while the turn
  is held, is reported as a turn yield and fails the guard; it must run inside
  `outsideTheTurn(...)`, which hands the turn back and takes it again before continuing.

Every W1E writer of `platform.audit` in `apps/server` calls `recordSecurityEvent`, which is
the SECURITY stream, so none of them can be reported by `reportUntransactedAudit`. Each
already appends inside the transaction that makes its change, which is also what keeps the
row and the change one write. What each must do after the merge is about the turn, not the
sink:

| Writer | The append | What changes after the merge |
|---|---|---|
| `owner-contact.ts` `write()` (link, e-mail change, verified/unverified, hand-over, pending, declined, link resent/unsent, owner needed, assigned, tenant record written) | Inside `tenants.compareAndSetOwner`, a `withSqliteTransaction(…, "BEGIN IMMEDIATE")` on the platform connection. Nested, synchronous, never reported. Leave as it is. | Its callers hold a turn while they wait on something else. From the console (`assign`, `confirmPending`, `resendPending`, `reconcile` under `/api/platform`'s `connectionTurn`): wrap `backend.companyAdmins()`, `backend.recordOwnerAssigned(...)`, `backend.ownerAccount(...)` and `mailPendingHandOver(...)` in `platform.outsideTheTurn(...)`. From a tenant request (`onUserEmailChanged`, `onUserSignedIn`, `companyOwner.handOver`, `companyOwner.currentOwnerUserId`): the tenant backend calls each hook through ITS `outsideTheTurn(...)` in `create-backend.ts`, because the platform database is not the tenant's connection. Each platform write then queues for the platform turn through `withSqliteTransaction` on its own. |
| `owner-pin-reset.ts` (`TENANT_OWNER_PIN_RESET_REQUESTED`, through `recordIntent`) | Inside `withSqliteTransaction(platform.stores.sqlite, …, "BEGIN IMMEDIATE")` with the fence. Nested, never reported. Leave as it is. | `router.backendOf(...)`, `router.reconcileOwnerOf(...)`, `backend.ownerAccount(...)` and `backend.resetOwnerPin(...)` (the tenant's database, and a scrypt hash) each run in `platform.outsideTheTurn(...)`. Nothing is awaited between the fence transaction's BEGIN and COMMIT except the append. |
| `release-tenant.ts` (`TENANT_RELEASED`) | Inside the one `withSqliteTransaction` that archives the tenant, cancels the subscription and drops the claim. Nested, never reported. Leave as it is. | `router.evict(...)` (closes the tenant backend) runs in `platform.outsideTheTurn(...)`, after the commit as now. |
| Reconcile on open (`tenant-router.ts` `cache.open` → `ownerContact.reconcile`) | Through `owner-contact.ts` `write()`, as above. | The open itself is outside work for whoever asked: `cache.get(...)` reached from a console route or from `provisionTenant` runs in `platform.outsideTheTurn(...)` (W1D's `provision-tenant.ts` already does this for `prepareTenantDatabase`). Inside it, `settleTenantDbFile`'s `setDbFile` and the reconcile's write each take the platform turn through their own transaction. |

Two more places wait on the outside world and go `outsideTheTurn`:

- `mailPendingHandOver` in `apps/server/src/cloud-app.ts`: `platform.outsideTheTurn(() => mailer.send(...))`,
  the same shape W1D gives the signup mail.
- `apps/server/src/tenant-db-file.ts`: the two `sha256Of(...)` calls, the `copy(...)` and
  `holdSqliteFile(...)`'s wait are file work. `settleTenantDbFile` takes
  `outsideTheTurn` in its `io` argument (the router passes `platform.outsideTheTurn`) and
  runs them through it; `repoint` stays a platform write under the turn.

### Session reuse per device (W1D) and `onSignedIn` / `credentialIsOwn` (W1E)

They are two facts about the same sign-in and both are kept.

- W1D binds a session to a device secret (`deviceBindingOf`, `sessions.issueDeviceBound`) and
  reuses it for that device. W1E announces every successful sign-in to the platform
  (`deps.onSignedIn`) with whether the credential used was set by the account itself
  (`credentialIsOwn`, read from the credential-reset marks).
- In `packages/backend/src/auth-routes.ts` take W1D's sign-in body (the `signedIn` re-read,
  the seat check, `toSession(..., deviceBindingOf(c))`) and re-insert W1E's `onSignedIn` call
  directly after `LOGIN_SUCCEEDED` is recorded, on `signedIn`.
- SECURITY: the sign-in announcement must not fire from a reused device session. `onSignedIn`
  fires on a real credential check only. A request that is answered from a reused device
  session without the PIN being verified again must NOT call it: `credentialIsOwn` would
  then be asserted for a sign-in that proved nothing, and the platform would mark an
  unverified owner address verified.
- The test to write, in `apps/server/src/owner-contact.test.ts` beside "does not take a
  sign-in with a PIN the console issued as proof of ownership": the owner signs in on a
  device with their own PIN (a device-bound session is issued); the recorded address is
  made unverified (the owner's e-mail is changed while the platform write is refused, then
  reconciled); the console resets the owner's PIN; the same device asks for its session
  again with the device secret and no PIN. Assert the session is answered, that
  `onUserSignedIn` was not called for that request, and that the platform row still says
  `ownerContactVerified: false` with the recorded address unchanged. Then sign in with the
  reset PIN and assert it is still not taken as proof (`credentialIsOwn: false`).
- W1D's `credentialsResetByAdministrator(account)` (unlocks the account's throttle) and W1E's
  credential-reset marks (`onUserCredentialSetByOther`, `credentialResets.mark/clear/has`) are
  different stores with different jobs. Keep both; in `users-routes.ts` the PUT calls both.

### Open backends are keyed by tenant id (W1E), not by code (W1D)

W1D's `tenant-router.ts` still calls `cache.get(code)`. W1E keys the cache by tenant id
because a released code is handed to the next company. Take W1E's cache, `openCodes` map,
`backendOf` / `reconcileOwnerOf` and `settleTenantDbFile` call; re-express W1D's `openFor`,
`doorTo` and `callerDoor` on top of `cache.get(tenant.id)`.

## Per file

### `packages/domain`

| File | Take |
|---|---|
| `src/platform/tenant.ts` | Ours whole (enum name, owner fields, pending owner, `ownerRecordDue`, `OwnerConfirmation`). Theirs adds nothing but the enum rename. |
| `src/platform/subscription.ts` | Ours for the enum, `settledPeriodEnd`, anchor functions and `applyRenewal`'s body. Theirs for `RENEWABLE_SUBSCRIPTION_STATES` (rewritten over `SubscriptionStatusKind`); `applyRenewal` asserts from that constant. |
| `src/platform/card-checkout.ts` | Theirs (`CardPaymentNotApplicableError`, the imported constant). Drop ours' private `RENEWABLE`. |
| `src/platform/index.ts` | Union of both export lists, with our enum names. |
| `src/users/user.ts` | Ours (enum name). |
| `src/audit/index.ts`, `src/index.ts` | Union: ours' `AuditSeverityCode` plus theirs' security-fallback exports. |
| `src/eta/receipt-service.test.ts` | Theirs whole (ours added nothing in the hunk). |

### `packages/contracts`

| File | Take |
|---|---|
| `src/platform.ts` | Both: ours' `ownerPinResetResultSchema`, `SubscriptionStatusCode`, `TenantWireStatus`, pending-owner fields (`expiresAt`, `linkMailed`); theirs' `PlatformPaymentRefusal`. Drop theirs' literal `subscriptionStatusSchema` list for ours. |

### `packages/persistence`

| File | Take |
|---|---|
| `src/platform-store.ts` | Both. Imports: union. `addMissingColumns`: ours' tenant/claim/subscription columns AND theirs' `payment.idempotency_key`. Start-up order: `addMissingColumns` → `guardOneDbFilePerTenant` → `ensurePaymentIndexes` → `backfillBillingAnchors` → `repairUtcBillingAnchors` → `repairPeriodEnds(PERIOD_END_REPAIR)` → `repairPeriodEnds(PERIOD_END_SHORT_REPAIR)`. The four repairs stay in that order and keep their four markers. |
| `src/sqlite-connection.ts` | Merges cleanly. Check that ours' `fileMustExist` option is still passed to the driver's constructor in theirs' `openSqliteConnection`. |
| `src/platform-store.test.ts` | Both describe blocks, one after the other. |
| `src/index.ts` | Union of exports (ours: owner-pin fence, credential-reset marks, `holdSqliteFile`; theirs: idempotent requests, account lock, untransacted audits). |

### `packages/api`

| File | Take |
|---|---|
| `src/users-routes.ts` | Both in each hunk: theirs' `loginThrottle.unlock(...)` calls, then ours' return carrying `ownerHandOver`. Ours' `loginThrottle.succeed(...)` on deactivate is replaced by theirs' `unlock`. |

### `packages/backend`

| File | Take |
|---|---|
| `src/platform-routes.ts` | Theirs for the audit plumbing (`recordedWith`, `noted`, `activationRecordedAs`, `provisionRetry`'s signature). Ours for every owner route and option (`resetOwnerPin`, `releaseTenant`, `ownerCandidates`, `assignOwner`, `confirmPendingOwner`, `declinePendingOwner`, `resendPendingOwner`, `reconcileOwner`, `reconcileOpenOwners`), `TenantOwnerAccountNotFoundError`, the reserved-code check and the owner conflict codes. Ours' `audit(...)` callers on those routes move to theirs' `recordedWith`. One `PlatformAuditUnavailableError` (theirs). `requirePlatform`'s refusal callback (ours, used by the PIN-reset refusal audit) must survive: see `platform-auth.ts`. |
| `src/platform-auth.ts` | Both: theirs' `sourceOf`, and ours' second `onRefused` parameter on `requirePlatform`. |
| `src/platform-routes.test.ts` | Theirs' rig (`activation(...)`), with ours' owner, release and PIN-reset tests re-pointed at it. |
| `src/auth-routes.ts` | See "Session reuse per device". Also both: ours' `UNDISCLOSED_TENANT_NAME` and bootstrap claim with the company name; theirs' unlock and step-up schemas, `AccountLockedEvent`, `alreadyClaimed`. In the bootstrap hunk keep ours' rule that a claimed tenant is refused BEFORE the body is validated (an anonymous caller must not learn the schema of a claimed tenant) and write the refusal through theirs' `alreadyClaimed`. |
| `src/auth-security.test.ts` | Both describe blocks. |
| `src/create-backend.ts` | Both: ours' `ownerAccount`, `companyAdmins`, `recordOwnerAssigned`, `resetOwnerPin`, `claimedElsewhere`, version route, and the re-export of `OwnerPinResetOutcome` from `owner-pin-reset-outcome.ts`; theirs' `audit` on the handle and `credentialsResetByAdministrator`. Ours' hooks (`onUserEmailChanged`, `onUserSignedIn`, `companyOwner`, `claimedElsewhere`) are called through theirs' `outsideTheTurn`. |
| `src/index.ts` | Union of exports. |

### `apps/server`

| File | Take |
|---|---|
| `src/client-source.ts` (add/add) | Theirs whole. W1D owns this file; ours is an earlier copy of the same module and differs only by lacking `trustedAddressHeader`. |
| `src/client-source.test.ts` (add/add) | Theirs whole, same reason. |
| `src/cloud-harness.ts` (add/add) | Theirs for the three doc-comment hunks; the code is identical. Then delete the doc comments theirs added that guard nothing, per the comment rule. |
| `src/env.ts` | Both: theirs' `MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER` parsing, ours' `publicOriginOf`, `MEZAN_PUBLIC_URL`, `parseTenantDomain` and the `PaymobMode` enum. |
| `src/billing-routes.ts` | Both: theirs' `connectionTurn(platform.audit)` and device header; ours' async `trustedReturnOrigin(request, env, servedTenantLookup(platform))`, `PaymobMode`, and the Arabic not-found text of the test checkout page. |
| `src/tenant-router.ts` | See "Open backends are keyed by tenant id". Ours: id-keyed cache, db-file settling and its 503s, owner contact wiring, `tenantSlugOfHost`, `claimedElsewhere` in the hooks. Theirs: sign-in source throttle, device cookie, `callerDoor`, `requireCloudSource`. `openBackend`'s signature takes ours' fourth `hooks` and fifth `connection` arguments; the fifth carries `fileMustExist` for every tenant that is not `provisioning` and must reach `createBackend`. |
| `src/tenant-router.test.ts` | Union of imports; the stub backend carries both sides' members. |
| `src/provision-tenant.ts` | Ours' body (claim fence, `stillOurs`, PIN reset outcome, resolve by tenant id), run inside theirs' `platform.inTheTurn("tenant registration", ...)` and with theirs' `activation` wrapped round the final `activateTenant` write so the activation and its audit row are one write. Keep both `fence`/`stillOurs` and `activation` in `ProvisionTenantDeps`. |
| `src/provision-tenant.test.ts` | Union of imports. |
| `src/signup-routes.ts` | Ours for the trusted mailed origin, the provisioning claim, heartbeat and wait constants, `PlatformMailer` / `MailOutcome`. Theirs for `connectionTurn(platform.audit)` and `platform.outsideTheTurn(...)` round the mail send: the call becomes `platform.outsideTheTurn(() => mailer.send(...))`. |
| `src/cloud-app.ts` | Both: theirs' `sourceOf: callerSource`, `sourceGate`, `RecordedActivation` threading; ours' `mailer`, `mailPendingHandOver`, owner route options, `SIGNUP_BASE_PATH`. |
| `src/card-checkout.ts` | Ours (enum name). |

### `apps/web`

| File | Take |
|---|---|
| `src/login/LoginScreen.tsx` | Union of imports: ours' lookup-host and bootstrap hooks, theirs' `AccountLockedError`, `useUnlockAccount`. |
| `src/platform/TenantDetailPage.tsx` | Both: ours' billing-anchor day and owner card; theirs' card-checkout sweep. Imports: union. |
| `src/platform/TenantDetailPage.test.tsx` | Both describe blocks; imports: union. |

### Docs

| File | Take |
|---|---|
| `docs/ENVIRONMENTS.md` | Theirs for the client-address prose and table rows, plus ours' `pnpm test:saas` hop row and `MEZAN_PUBLIC_URL` row. The sentence "today this address is read by … only" (ours) is false after the merge; drop it for theirs. |

## After the merge, before the gates

- `git grep -nw -e TenantLifecycle -e SubscriptionState -e UserState` answers nothing
  (`packages/domain/src/users/index.ts` included: it merges cleanly and is still wrong).
- Every `recordSecurityEvent(platform.audit` site in `apps/server` runs inside a turn: inside
  a `withSqliteTransaction` on the platform connection, or in a handler under
  `connectionTurn(platform.audit)`, or in work started with `platform.inTheTurn(...)`. Check
  each of `git grep -n "recordSecurityEvent(.*platform.audit" apps/server/src` by hand.
- The sign-in announcement must not fire from a reused device session: the test described
  under "Session reuse per device" exists and is green.
- `packages/api/src/test/turn-yield-guard.ts` is loaded by the server suites too, and
  `apps/server`'s owner, PIN-reset, release and db-file tests pass under it with no turn
  yield, no untransacted audit and no foreign write reported.
- A served tenant whose database file is missing still answers 503 and is never created:
  `apps/server/src/tenant-db-file.test.ts` "a served company whose database file was removed
  from the server" is green.
- `git grep -n "cache.get(code)" apps/server/src` answers nothing.
- One declaration of `PlatformAuditUnavailableError`.
- `apps/server/src/client-source.ts` and its test are byte-identical to W1D's.
