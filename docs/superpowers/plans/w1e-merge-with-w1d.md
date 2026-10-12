# Merging `test/w1e-saas-live-walk` (W1E) with `fix/w1d-audit-atomicity-billing` (W1D)

Measured with `git merge-tree --write-tree test/w1e-saas-live-walk fix/w1d-audit-atomicity-billing`
against W1D at `36168e5e`. Nothing was merged to write this. 35 files conflict; every other
file merges cleanly. Re-run the command before starting: a new commit on either side changes
the list.

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
| tenant status | `TenantStatusCode` (88) | `TenantLifecycle` (5) | `TenantStatusCode` |
| subscription status | `SubscriptionStatusKind` (52) | `SubscriptionState` (6) | `SubscriptionStatusKind` |
| user status | `UserStatusCode` (29) | `UserState` (12) | `UserStatusCode` |

W1E's names win on count alone: 169 use sites against 23. Rename W1D's 23 sites. W1D's
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
`auditOrRefuse` helper is deleted; its one caller (the owner PIN reset's `recordAudit`) is
rewritten as a `RecordedActivation`-style callback so the dependency still calls it inside the
platform transaction that takes the fence. W1E's owner mutations (assign, confirm, decline,
send again) already write their row inside `compareAndSetOwner`'s transaction in
`apps/server/src/owner-contact.ts`; that file does not conflict and needs only
`platform.audit.atomic` honoured if W1D's sink requires it: wrap the `compareAndSetOwner`
call in `platform.inTheTurn(...)` where W1D serialises platform writes.

### Session reuse per device (W1D) and `onSignedIn` / `credentialIsOwn` (W1E)

They are two facts about the same sign-in and both are kept.

- W1D binds a session to a device secret (`deviceBindingOf`, `sessions.issueDeviceBound`) and
  reuses it for that device. W1E announces every successful sign-in to the platform
  (`deps.onSignedIn`) with whether the credential used was set by the account itself
  (`credentialIsOwn`, read from the credential-reset marks).
- In `packages/backend/src/auth-routes.ts` take W1D's sign-in body (the `signedIn` re-read,
  the seat check, `toSession(..., deviceBindingOf(c))`) and re-insert W1E's `onSignedIn` call
  directly after `LOGIN_SUCCEEDED` is recorded, on `signedIn`.
- SECURITY: `onSignedIn` must fire on a real credential check only. A request that is
  answered from a reused device session without the PIN being verified again must NOT call
  it: `credentialIsOwn` would then be asserted for a sign-in that proved nothing, and the
  platform would mark an unverified owner address verified. Add a test: reuse a device
  session after a console PIN reset and assert the tenant's `ownerContactVerified` does not
  change.
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
| `src/platform-store.ts` | Both. Imports: union. `addMissingColumns`: ours' tenant/claim/subscription columns AND theirs' `payment.idempotency_key`. Start-up order: `addMissingColumns` → `guardOneDbFilePerTenant` → `ensurePaymentIndexes` → `backfillBillingAnchors` → `repairUtcBillingAnchors` → `repairSpilledPeriodEnds`. The three repairs stay in that order. |
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
| `src/create-backend.ts` | Both: ours' `ownerAccount`, `companyAdmins`, `recordOwnerAssigned`, `resetOwnerPin`, version route; theirs' `audit` on the handle and `credentialsResetByAdministrator`. |
| `src/index.ts` | Union of exports. |

### `apps/server`

| File | Take |
|---|---|
| `src/client-source.ts` (add/add) | Theirs whole. W1D owns this file; ours is an earlier copy of the same module and differs only by lacking `trustedAddressHeader`. |
| `src/client-source.test.ts` (add/add) | Theirs whole, same reason. |
| `src/cloud-harness.ts` (add/add) | Theirs for the three doc-comment hunks; the code is identical. Then delete the doc comments theirs added that guard nothing, per the comment rule. |
| `src/env.ts` | Both: theirs' `MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER` parsing, ours' `publicOriginOf` and `MEZAN_PUBLIC_URL`. |
| `src/tenant-router.ts` | See "Open backends are keyed by tenant id". Ours: id-keyed cache, db-file settling and its 503s, owner contact wiring, `tenantSlugOfHost`. Theirs: sign-in source throttle, device cookie, `callerDoor`, `requireCloudSource`. `openBackend`'s signature takes ours' fourth `hooks` argument. |
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

- `git grep -nw -e TenantLifecycle -e SubscriptionState -e UserState` answers nothing.
- `git grep -n "cache.get(code)" apps/server/src` answers nothing.
- One declaration of `PlatformAuditUnavailableError`.
- The device-session test named above exists and is green.
- `apps/server/src/client-source.ts` and its test are byte-identical to W1D's.
