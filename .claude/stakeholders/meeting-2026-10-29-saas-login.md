# Stakeholder review — SaaS sign-in (2026-10-29)

**Subject:** `apps/web/src/login/LoginScreen.tsx` and the auth routes behind it, judged for the
multi-tenant cloud edition at mezan.cyag.net (live host answers `/platform/resolve` with `mode: code`).
**Panel:** security-engineer, client-accounting-office, client-new-user, client-it-admin, designer.
All reviews read code only; nobody drove the live sign-in.

## Verdict

Ship with fixes. Tenant isolation at sign-in is solid (tenant-bound session cookie, name-free
resolve, per-tenant throttle stores, no account enumeration). What is missing is everything around
the form: a way back in after a forgotten PIN, protection against a stranger locking the owner out,
and a card that reads as the SaaS product rather than a shop till.

## Consensus findings (2+ roles)

1. **No forgot-PIN path** (security, new-user, IT-admin, designer). `login.forgot` exists in the
   catalog and nothing renders it; the only email recovery is the lockout unlock, which restores the
   old PIN. Every forgotten PIN is a support ticket.
2. **Till furniture on the cloud card** (designer, new-user). «الفرع الرئيسي» (`login.branchHint`)
   and the `Mezan <version>` footer mean nothing pre-auth on the web; «رمز المنشأة» hint repeats its
   label and says neither what the code is nor where to find it.
3. **No route back to the site / no language toggle** (designer, new-user). `SignupLayout` has both;
   the sign-in card has neither. Signup link is 10px grey.
4. **PIN is the only factor; weak PINs allowed** (security, IT-admin). `isWeakPin` runs only on
   generated PINs (`provisioning-secrets.ts`), so a user can set `123456`. No MFA/SSO.
5. **Shared-computer memory** (security, accounting office). Face list and email→company map survive
   sign-out on a shared browser.

## Role-specific must-fixes

- **Security (High):** a remote stranger can hard-lock any owner in ~15 min; the lock never expires
  (`sign-in-guard.ts:109-113`, `ACCOUNT_LOCK_FAILURES=20`). Recovery needs SMTP or platform support.
- **Accounting office:** one company per browser — the tenant code is in localStorage, so a second
  tab on another client switches the first tab (the tenant-bound cookie refuses it rather than
  showing wrong books — verified the 403 path is described in the security report, not driven).
  Email→company memory holds one code per email, useless for a bureau using one email in 30 tenants.
  Ask: a recent-companies list on the sign-in card.
- **IT admin:** no invite-by-email, no admin "reset PIN" link, no sign-out-everywhere UI, no bulk
  import, fixed session timeouts.

## Conflicts to decide

- **Recent-companies chips vs no pre-auth names.** Showing past companies on the card helps the
  bureau; it must show only the codes this device typed (never names fetched pre-auth).
- **Step order.** Designer: reveal PIN only after email; must not add a click for the daily clerk.

## Positives

Name-free `/platform/resolve`; per-tenant face list; cache clear on company switch; scanner-safe
unlock link; lockout countdown; decoy scrypt against enumeration; HttpOnly/SameSite=Strict cookie
bound to tenant; CSRF HMAC + origin checks.

## Open decisions (owner)

- Is production SMTP live on Contabo? Forgot-PIN, unlock and any email OTP all depend on it.
- Scope of this lane: card UX only, or also forgot-PIN + lock expiry + weak-PIN denylist.
- Later lanes: email OTP on new device, Google/Microsoft sign-in, invites, bulk import,
  sign-out-everywhere, post-sign-in company switcher, subdomain per client.
