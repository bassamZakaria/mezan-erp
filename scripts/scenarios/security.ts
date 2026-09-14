import type { Ctx } from "./harness.js";
import { createBackend } from "../../packages/backend/src/create-backend.js";
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PIN } from "../../packages/backend/src/seed.js";
import { createEntitlements, LAN_MULTI_TILL_FEATURE } from "../../packages/domain/src/index.js";

/**
 * Executable checks for the authorization boundary itself.
 *
 * Every assertion here is the FIXED behaviour of something that was measured
 * working against a seeded tenant: an anonymous caller minting a company
 * admin, a clerk with one user-admin permission promoting itself, a role
 * manager rewriting its own role to `"*"`, a six-digit PIN taking 36 guesses a
 * second. The suite is where those stay fixed — a permission gate has no
 * natural regression signal, because the screen looks identical whether the
 * gate holds or not.
 */

/** A caller the server cannot identify: a syntactically valid, unissued token. */
const ANONYMOUS = { authorization: "Bearer not-a-real-session-token" };

/** Acts as a real account, with only the permissions that account's role carries. */
function asUser(userId: string, permissions: string): Record<string, string> {
  return { "x-user-id": userId, "x-permissions": permissions, "x-role-codes": "SCN_SEC" };
}

export async function run(ctx: Ctx): Promise<void> {
  const { req, check } = ctx;

  await ctx.scenario("security — an unidentified caller is nobody", async () => {
    const anon = await req("GET", "/customers", undefined, ANONYMOUS);
    check("no session ⇒ 401, not an empty list", anon.status === 401, `got ${anon.status}`);

    // The header the old resolver believed. It must now be inert.
    const asserted = await req("GET", "/customers", undefined, { ...ANONYMOUS, "x-permissions": "*" });
    check("x-permissions: * grants nothing", asserted.status === 401, `got ${asserted.status}`);
  });

  await ctx.scenario("security — a provisioned tenant cannot be re-claimed", async () => {
    const claim = await req(
      "POST",
      "/bootstrap/admin",
      { nameAr: "مهاجم", nameEn: "Attacker", email: "attacker@cyag.example", pin: "999999" },
      ANONYMOUS,
    );
    check("POST /bootstrap/admin ⇒ 409", claim.status === 409, `got ${claim.status}`);
    check("and hands back no session", !claim.body?.token, JSON.stringify(claim.body).slice(0, 120));

    // The other door: naming an admin address that already exists used to
    // return THAT admin's session for wizard idempotency.
    const known = await req(
      "POST",
      "/bootstrap/admin",
      { nameAr: "م", nameEn: "A", email: SEED_ADMIN_EMAIL, pin: "999999" },
      ANONYMOUS,
    );
    check("a known admin address ⇒ no session either", known.status >= 400 && !known.body?.token, `got ${known.status}`);
  });

  await ctx.scenario("security — nobody grants authority they do not hold", async () => {
    const clerkRole = await req("POST", "/roles", {
      code: "SCN_SEC_CLERK",
      name: "موظف شؤون المستخدمين",
      permissions: ["admin.users.view", "admin.users.create", "admin.users.edit", "admin.roles.view", "admin.roles.manage"],
      isSystem: false,
      status: "active",
    });
    check("clerk role created", clerkRole.status === 201, `got ${clerkRole.status}`);
    const roleId = clerkRole.body?.id as string;

    const clerk = await req("POST", "/users", {
      nameAr: "موظف", nameEn: "Clerk", email: "scn-sec-clerk@cyag.example", phone: null,
      password: "scn-clerk-pass", pin: "222222", roleId, isCompanyAdmin: false,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active",
    });
    check("clerk account created", clerk.status === 201, JSON.stringify(clerk.body).slice(0, 140));
    const clerkId = clerk.body?.id as string;
    const clerkPerms = "admin.users.view,admin.users.create,admin.users.edit,admin.roles.view,admin.roles.manage";
    const asClerk = asUser(clerkId, clerkPerms);

    const promoted = await req("POST", "/users", {
      nameAr: "مرتقي", nameEn: "Escalated", email: "scn-sec-esc@cyag.example", phone: null,
      password: "scn-esc-password", pin: "333333", roleId: null, isCompanyAdmin: true,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active",
    }, asClerk);
    check("clerk cannot mint a company admin", promoted.status === 403, `got ${promoted.status}`);
    check("and is told why", promoted.body?.error === "PRIVILEGE_ESCALATION_DENIED", String(promoted.body?.error));

    const self = await req("PUT", `/users/${clerkId}`, {
      nameAr: "موظف", nameEn: "Clerk", email: "scn-sec-clerk@cyag.example", phone: null,
      roleId: null, isCompanyAdmin: true, employeeId: null,
      branchScope: "*", warehouseScope: "*", status: "active",
    }, asClerk);
    check("clerk cannot promote ITSELF", self.status === 403, `got ${self.status}`);

    const wildcard = await req("PUT", `/roles/${roleId}`, {
      code: "SCN_SEC_CLERK", name: "موظف شؤون المستخدمين",
      permissions: ["*"], isSystem: false, status: "active",
    }, asClerk);
    check("clerk cannot rewrite its own role to '*'", wildcard.status === 403, `got ${wildcard.status}`);

    const unheld = await req("POST", "/roles", {
      code: "SCN_SEC_SNEAK", name: "تسلل",
      permissions: ["accounting.journal.post"], isSystem: false, status: "active",
    }, asClerk);
    check("clerk cannot put an unheld permission in a new role", unheld.status === 403, `got ${unheld.status}`);

    const owner = await req("PUT", "/users/USER-ADMIN", {
      nameAr: "محمد الشهابي", nameEn: "Mohamed El Shehaby", email: SEED_ADMIN_EMAIL, phone: null,
      roleId: null, isCompanyAdmin: true, employeeId: null,
      branchScope: "*", warehouseScope: "*", status: "active", pin: "444444",
    }, asClerk);
    check("clerk cannot reset the owner's PIN", owner.status === 403, `got ${owner.status}`);

    const stillWorks = await req("POST", "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }, ANONYMOUS);
    check("so the owner's PIN is unchanged", stillWorks.status === 200, `got ${stillWorks.status}`);

    // The job the permission exists for must survive the guard.
    const peer = await req("POST", "/users", {
      nameAr: "زميل", nameEn: "Peer", email: "scn-sec-peer@cyag.example", phone: null,
      password: "scn-peer-password", pin: "555555", roleId, isCompanyAdmin: false,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active",
    }, asClerk);
    check("clerk CAN still create a peer account", peer.status === 201, JSON.stringify(peer.body).slice(0, 140));

    const ghost = await req("PUT", "/users/SCN-GHOST-1", {
      nameAr: "شبح", nameEn: "Ghost", email: "scn-sec-ghost@cyag.example", phone: null,
      password: "scn-ghost-password", roleId: null, isCompanyAdmin: true, employeeId: null,
      branchScope: "*", warehouseScope: "*", status: "active", pin: "111111",
    });
    check("PUT on an unknown user id is a 404, not a create", ghost.status === 404, `got ${ghost.status}`);
  });

  await ctx.scenario("security — a PIN cannot be guessed at machine speed", async () => {
    const target = "scn-sec-peer@cyag.example";
    const codes: number[] = [];
    for (let i = 1; i <= 7; i += 1) {
      const res = await req("POST", "/auth/login", { username: target, pin: `00000${i}` }, ANONYMOUS);
      codes.push(res.status);
    }
    check("the first attempts are ordinary refusals", codes.slice(0, 5).every((s) => s === 401), codes.join(","));
    check("then the account locks", codes.slice(5).every((s) => s === 429), codes.join(","));

    const correct = await req("POST", "/auth/login", { username: target, pin: "555555" }, ANONYMOUS);
    check("and the lock holds even for the RIGHT PIN", correct.status === 429, `got ${correct.status}`);
    check("with a wait the client can show", Number(correct.body?.retryAfterSeconds) > 0, String(correct.body?.retryAfterSeconds));

    const other = await req("POST", "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }, ANONYMOUS);
    check("one locked account does not lock the shop out", other.status === 200, `got ${other.status}`);
  });

  await ctx.scenario("security — the LAN mount answers only to a session", async () => {
    const entitlements = createEntitlements({
      plan: "SCN", activeModules: [], features: { [LAN_MULTI_TILL_FEATURE]: true }, seats: 3, expiresAt: null,
    });
    const lan = await createBackend({ dbPath: ":memory:", lan: { resolveEntitlements: () => entitlements } });
    try {
      const call = (path: string, init: RequestInit = {}) =>
        lan.app.fetch(new Request(`http://lan${path}`, init));

      for (const [label, path, init] of [
        ["GET /lan/status", "/lan/status", {}],
        ["GET /lan/sessions", "/lan/sessions", {}],
        ["DELETE /lan/sessions/:id", "/lan/sessions/x", { method: "DELETE" }],
      ] as const) {
        const res = await call(path, init);
        check(`${label} refuses an anonymous device`, res.status === 401, `got ${res.status}`);
      }

      const asserted = await call("/lan/sessions", { headers: { "x-permissions": "*" } });
      check("and does not believe x-permissions", asserted.status === 401, `got ${asserted.status}`);

      const login = await call("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }),
      });
      const { token } = (await login.json()) as { token: string };
      const admin = await call("/lan/sessions", { headers: { authorization: `Bearer ${token}` } });
      check("a signed-in admin still sees the till list", admin.status === 200, `got ${admin.status}`);
    } finally {
      lan.close();
    }
  });

  await ctx.scenario("security — a session only works from where it was issued", async () => {
    // THE RESIDUAL THE WHOLE REVIEW KEPT RETURNING TO. A grant named a user and
    // nothing else, so a token lifted from a till — read out of its storage, or
    // taken off a machine somebody carried home — worked from any device on the
    // shop wifi, as that user, for at least twelve hours. TLS on the LAN socket
    // ended sniffing; it does nothing about a token that already left.
    //
    // Driven here rather than only in unit tests because the binding is only
    // real if the ORIGIN reaches `sessions.issue` from the login route and
    // `sessions.find` from the resolver, which is wiring, not arithmetic.
    const bound = await createBackend({ dbPath: ":memory:" });
    try {
      /** What `@hono/node-server` hangs on `c.env`. Not a header — a client cannot write it. */
      const from = (address: string | null) =>
        address === null ? undefined : { incoming: { socket: { remoteAddress: address } } };
      const call = (path: string, address: string | null, init: RequestInit = {}) =>
        bound.app.fetch(new Request(`http://bound${path}`, init), from(address));
      const login = async (address: string | null) => {
        const res = await call("/auth/login", address, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }),
        });
        return ((await res.json()) as { token?: string }).token ?? "";
      };
      const read = (token: string, address: string | null) =>
        call("/customers", address, { headers: { authorization: `Bearer ${token}` } });

      const TILL = "192.168.7.21";
      const THIEF = "192.168.7.99";

      // 1. THE TILL BOOT PATH: login over the socket, then the bearer token
      //    back over the same socket. Same origin throughout, so it must pass.
      const tillToken = await login(TILL);
      check("a till gets a token from the LAN socket", tillToken !== "", "no token");
      check("and can use it from the till", (await read(tillToken, TILL)).status === 200);
      // The same machine through a dual-stack listener. A binding that could not
      // fold this would sign the till out on its next request.
      check(
        "including when the socket spells it ::ffff:",
        (await read(tillToken, `::ffff:${TILL}`)).status === 200,
      );

      // 2. THE LIFTED TOKEN.
      const stolen = await read(tillToken, THIEF);
      check("the same token from another device ⇒ 401", stolen.status === 401, `got ${stolen.status}`);
      check(
        "and it is REVOKED, not merely refused there",
        (await read(tillToken, TILL)).status === 401,
        "the token still worked from the till",
      );

      // 3. THE DESKTOP SHELL'S OWN SESSION. No origin at all — and "no origin"
      //    is ONE origin, the in-process mount, not a wildcard.
      const hostToken = await login(null);
      check("the host's own session works on the host", (await read(hostToken, null)).status === 200);
      check(
        "and does not work from the wifi",
        (await read(hostToken, TILL)).status === 401,
        "a host token was accepted over the network",
      );

      // 4. THE FORENSIC ROW. A token used from a second address is the single
      //    clearest signal that a credential has been copied; it wrote nothing.
      const auditor = await login(null);
      const events = await call("/audit?stream=security&limit=50", null, {
        headers: { authorization: `Bearer ${auditor}` },
      });
      const rows = ctx.rows(await events.json());
      const rejections = rows.filter((e: any) => e.action === "SESSION_ORIGIN_REJECTED");
      const lifted = rejections.find((e: any) => e.details?.presentedFrom === THIEF);
      check("the lifted till token is recorded", !!lifted, JSON.stringify(rows.map((e: any) => e.action)).slice(0, 240));
      check("as CRITICAL", lifted?.severity === "CRITICAL", String(lifted?.severity));
      check(
        "naming both addresses",
        lifted?.details?.issuedFrom === TILL && lifted?.details?.presentedFrom === THIEF,
        JSON.stringify(lifted?.details).slice(0, 160),
      );
      check("and attributed to the account whose token it was", lifted?.actor === lifted?.entityId && !!lifted?.actor);
      // The host token taken onto the wifi is the same event seen from the
      // other side, and it is recorded too — "issued on the host" is a fact.
      const hostLifted = rejections.find((e: any) => e.details?.issuedFrom === "host");
      check("a host token carried onto the wifi is recorded too", !!hostLifted, JSON.stringify(hostLifted?.details).slice(0, 160));
    } finally {
      bound.close();
    }
  });

  await ctx.scenario("security — scope is authority, and cannot be widened by self-edit", async () => {
    // THE HARNESS USED TO MINT EVERY IDENTITY WITH `ALL_SCOPE`, which is why
    // this suite could not have caught the defect: a caller who already holds
    // every branch cannot widen to every branch, so the guard was never asked.
    // `x-branch-grant` mints a genuinely narrow principal.
    const roleRes = await req("POST", "/roles", {
      code: "SCN_SEC_BRANCH_MGR",
      name: "مدير فرع",
      permissions: ["admin.users.view", "admin.users.create", "admin.users.edit"],
      isSystem: false,
      status: "active",
    });
    check("branch-manager role created", roleRes.status === 201, JSON.stringify(roleRes.body).slice(0, 140));
    const roleId = roleRes.body?.id as string;

    const mgr = await req("POST", "/users", {
      nameAr: "مدير الفرع", nameEn: "Branch Manager", email: "scn-sec-brmgr@cyag.example", phone: null,
      password: "scn-brmgr-password", pin: "662211", roleId, isCompanyAdmin: false,
      employeeId: null, branchScope: ["BR-MAIN"], warehouseScope: ["WH-MAIN"], status: "active",
    });
    check("branch manager account created", mgr.status === 201, JSON.stringify(mgr.body).slice(0, 160));
    const mgrId = mgr.body?.id as string;

    const asManager = {
      "x-user-id": mgrId,
      "x-permissions": "admin.users.view,admin.users.create,admin.users.edit",
      "x-role-codes": "SCN_SEC_BRANCH_MGR",
      "x-branch-grant": "BR-MAIN",
      "x-warehouse-grant": "WH-MAIN",
    };

    // The exact walk: PUT my own account, same role, wider reach. Both the
    // outrank check and the permission check pass — the authority is identical
    // on the only axis anyone was comparing.
    const widen = await req("PUT", `/users/${mgrId}`, {
      nameAr: "مدير الفرع", nameEn: "Branch Manager", email: "scn-sec-brmgr@cyag.example", phone: null,
      roleId, isCompanyAdmin: false, employeeId: null,
      branchScope: "*", warehouseScope: "*", status: "active",
    }, asManager);
    check("a scoped manager cannot widen ITS OWN branch scope", widen.status === 403, `got ${widen.status}`);
    check("and is told it was a scope refusal", Array.isArray(widen.body?.scopes), JSON.stringify(widen.body).slice(0, 160));

    // The other half: minting a NEW account with reach the creator lacks.
    const mintWide = await req("POST", "/users", {
      nameAr: "واسع", nameEn: "Wide", email: "scn-sec-wide@cyag.example", phone: null,
      password: "scn-wide-password", pin: "663311", roleId, isCompanyAdmin: false,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active",
    }, asManager);
    check("nor create an account with wider reach than its own", mintWide.status === 403, `got ${mintWide.status}`);

    const otherBranch = await req("POST", "/users", {
      nameAr: "فرع آخر", nameEn: "Other", email: "scn-sec-other@cyag.example", phone: null,
      password: "scn-other-password", pin: "663312", roleId, isCompanyAdmin: false,
      employeeId: null, branchScope: ["BR-OTHER"], warehouseScope: ["WH-MAIN"], status: "active",
    }, asManager);
    check("nor a branch it does not itself hold", otherBranch.status === 403, `got ${otherBranch.status}`);

    // The job the permission exists for must survive the guard.
    const peer = await req("POST", "/users", {
      nameAr: "زميل الفرع", nameEn: "Branch Peer", email: "scn-sec-brpeer@cyag.example", phone: null,
      password: "scn-brpeer-password", pin: "663313", roleId, isCompanyAdmin: false,
      employeeId: null, branchScope: ["BR-MAIN"], warehouseScope: ["WH-MAIN"], status: "active",
    }, asManager);
    check("but a same-scope peer is still creatable", peer.status === 201, JSON.stringify(peer.body).slice(0, 160));
  });

  await ctx.scenario("security — a claimed tenant stays claimed however the accounts are edited", async () => {
    // The old predicate was "some ACTIVE account whose EMAIL is not the seed
    // admin's", and both halves are master data an admin may edit. Deactivating
    // the last non-seed account — which one company admin may do to another,
    // because peers do not outrank each other — walked a fully provisioned
    // tenant back to "unclaimed" and re-opened anonymous admin creation.
    const users = await req("GET", "/users");
    const nonSeed = ctx.rows(users.body).filter((u: any) => u.id !== "USER-ADMIN" && u.status === "active");
    check("the seeded tenant has real accounts to deactivate", nonSeed.length > 0, String(nonSeed.length));

    const deactivated: string[] = [];
    for (const u of nonSeed) {
      const res = await req("POST", `/users/${u.id}/deactivate`);
      if (res.status === 200) deactivated.push(u.id as string);
    }
    check("every non-seed account is now inactive", deactivated.length === nonSeed.length, `${deactivated.length}/${nonSeed.length}`);

    const retake = await req("POST", "/bootstrap/admin", {
      nameAr: "مهاجم", nameEn: "Attacker", email: "scn-sec-retake@cyag.example", pin: "987654",
    }, ANONYMOUS);
    check("an emptied tenant is STILL claimed", retake.status === 409, `got ${retake.status}`);
    check("and hands back no session", !retake.body?.token, JSON.stringify(retake.body).slice(0, 120));

    // `/bootstrap/seed` is NOT closed by the claim, and must not be: the
    // first-run wizard's seed step runs after its admin step, so a claim-based
    // guard 409s the wizard on its own next click. The invariant that protects
    // a provisioned tenant is EMPTINESS, enforced inside `seedIfEmpty` — so on
    // a tenant with accounts this is a no-op that reports the counts.
    const usersBefore = ctx.rows((await req("GET", "/users")).body).length;
    const reseed = await req("POST", "/bootstrap/seed", {}, ANONYMOUS);
    check("/bootstrap/seed on a provisioned tenant is a no-op, not a refusal", reseed.status === 200, `got ${reseed.status}`);
    check("and it hands back no session", !reseed.body?.token, JSON.stringify(reseed.body).slice(0, 120));
    const usersAfter = ctx.rows((await req("GET", "/users")).body).length;
    check("and creates nothing", usersAfter === usersBefore, `${usersBefore} -> ${usersAfter}`);

    for (const id of deactivated) await req("POST", `/users/${id}/activate`);
    const restored = await req("GET", "/users");
    check(
      "the tenant is put back as it was found",
      ctx.rows(restored.body).filter((u: any) => u.status === "active").length >= nonSeed.length,
    );
  });

  await ctx.scenario("security — deactivation ends the session, it does not wait twelve hours", async () => {
    const role = await req("POST", "/roles", {
      code: "SCN_SEC_DOOMED", name: "دور مؤقت",
      permissions: ["sales.invoice.view"], isSystem: false, status: "active",
    });
    const doomed = await req("POST", "/users", {
      nameAr: "مفصول", nameEn: "Dismissed", email: "scn-sec-doomed@cyag.example", phone: null,
      password: "scn-doomed-password", pin: "774411", roleId: role.body?.id, isCompanyAdmin: false,
      employeeId: null, branchScope: "*", warehouseScope: "*", status: "active",
    });
    check("account created", doomed.status === 201, JSON.stringify(doomed.body).slice(0, 140));

    const login = await req("POST", "/auth/login", { username: "scn-sec-doomed@cyag.example", pin: "774411" }, ANONYMOUS);
    check("and can sign in", login.status === 200, `got ${login.status}`);
    const token = login.body?.token as string;
    const asThem = { authorization: `Bearer ${token}` };

    const before = await req("GET", "/sales-invoices", undefined, asThem);
    check("the token works while employed", before.status !== 401, `got ${before.status}`);

    await req("POST", `/users/${doomed.body.id}/deactivate`);
    const after = await req("GET", "/sales-invoices", undefined, asThem);
    check("and stops the moment they are deactivated", after.status === 401, `got ${after.status}`);
  });

  await ctx.scenario("security — a locked account has a way back in", async () => {
    const target = "scn-sec-brpeer@cyag.example";
    let codes: number[] = [];
    for (let i = 1; i <= 7; i += 1) {
      const res = await req("POST", "/auth/login", { username: target, pin: `10000${i}` }, ANONYMOUS);
      codes.push(res.status);
    }
    check("the account locks after five free attempts", codes.slice(5).every((s) => s === 429), codes.join(","));

    const locked = await req("POST", "/auth/login", { username: target, pin: "663313" }, ANONYMOUS);
    check("and the lock holds even for the right PIN", locked.status === 429, `got ${locked.status}`);
    check(
      "the wait is expressed in minutes past two, not 900 ثانية",
      Number(locked.body?.retryAfterSeconds) < 120 || String(locked.body?.message).includes("دقيق"),
      String(locked.body?.message),
    );

    const users = await req("GET", "/users");
    const peer = ctx.rows(users.body).find((u: any) => u.email === target);
    check("the locked account is findable", !!peer, target);

    const unlock = await req("POST", `/users/${peer.id}/unlock`);
    check("an admin can clear the lockout", unlock.status === 200, JSON.stringify(unlock.body).slice(0, 140));

    const back = await req("POST", "/auth/login", { username: target, pin: "663313" }, ANONYMOUS);
    check("and the person is back in immediately", back.status === 200, `got ${back.status}`);
    check("with lastLoginAt finally written", typeof back.body?.token === "string");

    const reread = await req("GET", `/users/${peer.id}`);
    check(
      "so the users list stops reading «أبداً» for a live account",
      typeof reread.body?.lastLoginAt === "string" && reread.body.lastLoginAt !== null,
      String(reread.body?.lastLoginAt),
    );
  });

  await ctx.scenario("security — the credential boundary leaves a trail", async () => {
    const audit = await req("GET", "/audit?stream=security&limit=200");
    const events = ctx.rows(audit.body).length ? ctx.rows(audit.body) : (audit.body?.events ?? []);
    const actions = new Set(events.map((e: any) => e.action));
    for (const expected of [
      "LOGIN_SUCCEEDED",
      "LOGIN_FAILED",
      "ACCOUNT_LOCKED",
      "ACCOUNT_UNLOCKED",
      "PRIVILEGE_ESCALATION_DENIED",
      "BOOTSTRAP_REFUSED",
    ]) {
      check(`the security stream records ${expected}`, actions.has(expected), [...actions].join(","));
    }
    const lockout = events.find((e: any) => e.action === "ACCOUNT_LOCKED");
    check("a lockout is CRITICAL, per this codebase's own taxonomy", lockout?.severity === "CRITICAL", String(lockout?.severity));

    const refusal = events.find((e: any) => e.action === "PRIVILEGE_ESCALATION_DENIED");
    check("a refusal names the actor who attempted it", typeof refusal?.actor === "string" && refusal.actor !== "", String(refusal?.actor));
    check("and says what was reached for", !!refusal?.details?.reason, JSON.stringify(refusal?.details).slice(0, 140));
  });

  await ctx.scenario("security — an admin PIN reset is not a phone-number edit", async () => {
    const users = await req("GET", "/users");
    const peer = ctx.rows(users.body).find((u: any) => u.email === "scn-sec-brpeer@cyag.example");
    const reset = await req("PUT", `/users/${peer.id}`, {
      nameAr: "زميل الفرع", nameEn: "Branch Peer", email: "scn-sec-brpeer@cyag.example", phone: null,
      roleId: peer.roleId, isCompanyAdmin: false, employeeId: null,
      branchScope: ["BR-MAIN"], warehouseScope: ["WH-MAIN"], status: "active", pin: "998877",
    });
    check("an admin may still reset a subordinate's PIN", reset.status === 200, `got ${reset.status}`);

    const audit = await req("GET", "/audit?stream=security&action=CREDENTIAL_RESET_BY_ADMIN&limit=20");
    const events = ctx.rows(audit.body).length ? ctx.rows(audit.body) : (audit.body?.events ?? []);
    check("and it is recorded as its own security event", events.length > 0, JSON.stringify(audit.body).slice(0, 160));
    check("at CRITICAL", events[0]?.severity === "CRITICAL", String(events[0]?.severity));
    check("naming which credential moved", events[0]?.details?.pinChanged === true, JSON.stringify(events[0]?.details));
    // The PIN itself must never be in the log — a forensic record that carries
    // the secret it protects is a second copy of the credential store.
    check(
      "and never the PIN itself",
      !JSON.stringify(events[0]?.details ?? {}).includes("998877"),
      JSON.stringify(events[0]?.details),
    );
  });

  await ctx.scenario("security — deleting a role is a privilege change, and is guarded", async () => {
    const missing = await req("DELETE", "/roles/SCN-NO-SUCH-ROLE");
    check("deleting a role that never existed is a 404, not a silent 204", missing.status === 404, `got ${missing.status}`);

    const privileged = await req("POST", "/roles", {
      code: "SCN_SEC_GL", name: "قيود",
      permissions: ["accounting.journal.post"], isSystem: false, status: "active",
    });
    check("a privileged role exists to aim at", privileged.status === 201, JSON.stringify(privileged.body).slice(0, 140));

    const asClerk = asUser("scn-sec-clerk-2", "admin.roles.view,admin.roles.manage");
    const del = await req("DELETE", `/roles/${privileged.body.id}`, undefined, asClerk);
    check(
      "a role manager cannot delete a role carrying authority it lacks",
      del.status === 403,
      `got ${del.status}`,
    );
    check("and is told why", del.body?.error === "PRIVILEGE_ESCALATION_DENIED", String(del.body?.error));
  });

  await ctx.scenario("security — an approval chain names real roles, and cannot be quietly rewritten", async () => {
    const approver = await req("POST", "/roles", {
      code: "SCN_SEC_APPROVER", name: "معتمد الصرف",
      permissions: ["workflow.approve", "workflow.view"], isSystem: false, status: "active",
    });
    check("approver role created", approver.status === 201, JSON.stringify(approver.body).slice(0, 140));

    const ghostStep = await req("POST", "/workflow/configs", {
      actionType: "TREASURY_VOUCHER_CONFIRM",
      steps: [{ role: "SCN_ROLE_THAT_DOES_NOT_EXIST", order: 1 }],
    });
    check(
      "a step naming a role that does not exist is refused",
      ghostStep.status === 400,
      `got ${ghostStep.status} ${JSON.stringify(ghostStep.body).slice(0, 120)}`,
    );

    const config = await req("POST", "/workflow/configs", {
      actionType: "TREASURY_VOUCHER_CONFIRM",
      steps: [{ role: "SCN_SEC_APPROVER", order: 1 }],
    });
    check("a step naming a real role is accepted", config.status === 201, JSON.stringify(config.body).slice(0, 160));

    // Step 1 of the create-and-approve chain: free the approver code so it can
    // be re-created with an empty permission list and self-assigned.
    const delApprover = await req("DELETE", `/roles/${approver.body.id}`);
    check(
      "a role an approval chain depends on cannot be deleted",
      delApprover.status === 409,
      `got ${delApprover.status}`,
    );
    check("and the chain that depends on it is named", Array.isArray(delApprover.body?.actionTypes), JSON.stringify(delApprover.body).slice(0, 160));

    const rename = await req("PUT", `/roles/${approver.body.id}`, {
      code: "SCN_SEC_APPROVER_RENAMED", name: "معتمد الصرف",
      permissions: ["workflow.approve", "workflow.view"], isSystem: false, status: "active",
    });
    check("nor can its code be renamed out from under the chain", rename.status === 409, `got ${rename.status}`);

    if (config.status === 201) {
      const removed = await req("DELETE", `/workflow/configs/${config.body.id}`);
      check("the config itself is deletable by someone entitled to", removed.status === 204, `got ${removed.status}`);
      const audit = await req("GET", "/audit?entityType=WORKFLOW_CONFIG&limit=20");
      const events = ctx.rows(audit.body).length ? ctx.rows(audit.body) : (audit.body?.events ?? []);
      const del = events.find((e: any) => e.action === "DELETE");
      check("but deleting it is recorded", !!del, JSON.stringify(audit.body).slice(0, 160));
      check(
        "with the steps that stopped being required",
        Array.isArray(del?.details?.previousSteps) && del.details.previousSteps.length > 0,
        JSON.stringify(del?.details).slice(0, 160),
      );
      check("at CRITICAL — it is the only segregation-of-duties control there is", del?.severity === "CRITICAL", String(del?.severity));
    }
  });

  await ctx.scenario("security — the header resolver refuses to run on a real build", async () => {
    const { insecureHeaderAuthContextResolver } = await import("../../packages/api/src/permission-gate.js");
    const previous = process.env["MEZAN_PACKAGED"];
    process.env["MEZAN_PACKAGED"] = "1";
    let threw = false;
    try {
      insecureHeaderAuthContextResolver({ req: { header: () => "*" } } as never);
    } catch {
      threw = true;
    } finally {
      if (previous === undefined) delete process.env["MEZAN_PACKAGED"];
      else process.env["MEZAN_PACKAGED"] = previous;
    }
    check("a packaged build cannot resolve a caller from headers", threw);
  });

  await ctx.scenario("security — a refused request is a recorded request", async () => {
    // The gate answered 403 and wrote nothing, so a clerk probing fifty
    // screens they cannot reach left zero rows — and the refusal is a free
    // oracle over the org's authority map, which is exactly what makes the
    // probing worth seeing.
    const clerk = asUser("scn-sec-prober", "sales.invoice.view");
    const refused = await req("GET", "/financial-reports/trial-balance", undefined, clerk);
    check("a clerk is refused the trial balance", refused.status === 403, `got ${refused.status}`);

    const audit = await req("GET", "/audit?stream=security&action=PERMISSION_DENIED&limit=20");
    const events = ctx.rows(audit.body).length ? ctx.rows(audit.body) : (audit.body?.events ?? []);
    check("and the refusal is recorded", events.length > 0, JSON.stringify(audit.body).slice(0, 160));
    check("naming the permission that was missing", !!events[0]?.details?.permission, JSON.stringify(events[0]?.details));
    check("and the route that was reached for", !!events[0]?.details?.path, JSON.stringify(events[0]?.details));
  });

  await ctx.scenario("security — the exception reports answer what the raw log cannot", async () => {
    const exceptions = await req("GET", "/security-reports/exceptions");
    check("the security exception report answers", exceptions.status === 200, `got ${exceptions.status}`);
    check("with a watchlist of the named controls", Array.isArray(exceptions.body?.watchlist), JSON.stringify(exceptions.body).slice(0, 200));
    // A ZERO ROW IS THE POINT. An absent row is indistinguishable from a
    // control that was never wired; a zero says the control reported and
    // found nothing.
    const watchlist = exceptions.body?.watchlist ?? [];
    for (const action of ["PRIVILEGE_ESCALATION_DENIED", "CREDENTIAL_RESET_BY_ADMIN", "ACCOUNT_LOCKED"]) {
      check(`${action} is always on the watchlist`, watchlist.some((w: any) => w.action === action), watchlist.map((w: any) => w.action).join(","));
    }
    check(
      "and the escalations this run actually attempted are counted",
      Number(watchlist.find((w: any) => w.action === "PRIVILEGE_ESCALATION_DENIED")?.count) > 0,
      JSON.stringify(watchlist.find((w: any) => w.action === "PRIVILEGE_ESCALATION_DENIED")),
    );
    // The honest half: what the ledger cannot answer must be stated, not
    // papered over with a plausible figure.
    check("the report names its own gaps", Array.isArray(exceptions.body?.gaps) && exceptions.body.gaps.length > 0, JSON.stringify(exceptions.body?.gaps).slice(0, 200));
    check("and says whether its totals are a floor", typeof exceptions.body?.coverage?.truncated === "boolean", JSON.stringify(exceptions.body?.coverage));

    const afterHours = await req("GET", "/security-reports/after-hours");
    check("the after-hours report answers", afterHours.status === 200, `got ${afterHours.status}`);
    check(
      "and admits when its working-day start is an assumption",
      afterHours.body?.workingHours?.startHourSource === "default" || afterHours.body?.workingHours?.startHourSource === "settings",
      JSON.stringify(afterHours.body?.workingHours),
    );

    const postPosting = await req("GET", "/security-reports/post-posting-changes");
    check("the post-posting report answers", postPosting.status === 200, `got ${postPosting.status}`);

    const ghosts = await req("GET", "/security-reports/new-accounts?days=90");
    check("the new-accounts report answers", ghosts.status === 200, `got ${ghosts.status}`);
    check("grouping accounts under who created them", Array.isArray(ghosts.body?.groups), JSON.stringify(ghosts.body).slice(0, 200));
    // The ghost-employee join: this suite has created accounts through an
    // admin session, so at least one group must name a creator.
    check("and this run's own accounts appear", Number(ghosts.body?.grandTotals?.count ?? 0) > 0, JSON.stringify(ghosts.body?.grandTotals));

    // Never trust a caller-supplied limit.
    const clamped = await req("GET", "/security-reports/new-accounts?days=99999");
    check("an absurd window is clamped server-side", clamped.status === 200 && Number(clamped.body?.params?.days) <= 365, JSON.stringify(clamped.body?.params));

    const clerk = asUser("scn-sec-nosy", "sales.invoice.view");
    const denied = await req("GET", "/security-reports/exceptions", undefined, clerk);
    check("and the reports are gated", denied.status === 403, `got ${denied.status}`);
  });

  await ctx.scenario("security — claiming a tenant retires the seeded fallback admin", async () => {
    // A FRESH tenant, not the shared demo one: this is about what the very
    // first `POST /bootstrap/admin` does, and the demo tenant is already
    // claimed by construction.
    const fresh = await createBackend({ dbPath: ":memory:" });
    try {
      const call = (path: string, init: RequestInit = {}) =>
        fresh.app.fetch(new Request(`http://fresh${path}`, init));
      const post = (path: string, body: unknown) =>
        call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

      const before = await post("/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN });
      check("the seeded fallback admin can sign in on an unclaimed tenant", before.status === 200, `got ${before.status}`);

      const claim = await post("/bootstrap/admin", {
        nameAr: "المالك", nameEn: "Owner", email: "owner@fresh.example", pin: "246813",
      });
      check("the owner claims the install", claim.status === 201, `got ${claim.status}`);

      // The classic "generic admin account" finding, closed at the moment it
      // stops being needed. It was left ACTIVE with `["*"]` on every install —
      // unattributable, claimable by anyone who could set its PIN, and a
      // permanent key for whoever installed the software.
      const after = await post("/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN });
      check("and the seeded admin can no longer sign in", after.status === 401, `got ${after.status}`);

      const owner = await post("/auth/login", { username: "owner@fresh.example", pin: "246813" });
      check("while the real owner can", owner.status === 200, `got ${owner.status}`);

      const retaken = await post("/bootstrap/admin", {
        nameAr: "دخيل", nameEn: "Second", email: "second@fresh.example", pin: "135791",
      });
      check("and the install cannot be claimed twice", retaken.status === 409, `got ${retaken.status}`);
    } finally {
      fresh.close();
    }
  });

  await ctx.scenario("security — an administrative act records where it came from", async () => {
    // The session grant carried a user id and no origin; the audit row carried
    // an actor and no origin. So "which till posted this adjustment" was not
    // answerable at any layer — and the desktop edition now serves the same app
    // over a LAN socket as well as in-process.
    const role = await req("POST", "/roles", {
      code: "SCN_SEC_ORIGIN", name: "دور المصدر",
      permissions: ["sales.invoice.view"], isSystem: false, status: "active",
    });
    check("a role write to hang the assertion on", role.status === 201, JSON.stringify(role.body).slice(0, 140));

    const audit = await req("GET", "/audit?entityType=ROLE&limit=10");
    const events = ctx.rows(audit.body).length ? ctx.rows(audit.body) : (audit.body?.events ?? []);
    const created = events.find((e: any) => e.action === "CREATE");
    check("the write is recorded", !!created, JSON.stringify(audit.body).slice(0, 160));
    // "host" is a FACT — the request came from inside the process — not a
    // missing value dressed up as one.
    check("and carries an origin", typeof created?.details?.origin === "string", JSON.stringify(created?.details).slice(0, 160));
    check("which is the in-process mount here", created?.details?.origin === "host", String(created?.details?.origin));
  });

  await ctx.scenario("security — the operational permissions are held by an operational role", async () => {
    // A PERMISSION GRANTED TO NOBODY IS A ROUTE NOBODY CAN CALL. Both
    // `admin.devices.manage` and `admin.users.unlock` were written to end the
    // same outage — the till is stuck or locked at 6pm and only the owner's own
    // `isCompanyAdmin` account can do anything about it — and `admin.devices.*`
    // shipped in exactly that state: gated on `admin.settings.edit`, which no
    // seeded role holds. Asserting the ROUTE exists would not have caught it;
    // asserting a real role can reach it does.
    const roles = await req("GET", "/roles");
    const rows = ctx.rows(roles.body);
    check("the seeded roles are readable", rows.length > 0, String(rows.length));

    for (const [code, permission] of [
      ["BRANCH_MANAGER", "admin.devices.manage"],
      ["BRANCH_MANAGER", "admin.users.unlock"],
      ["SUPERVISOR", "admin.devices.manage"],
      ["SUPERVISOR", "admin.users.unlock"],
      ["TREASURY_CASHIER", "admin.devices.view"],
    ] as const) {
      const role = rows.find((r: any) => r.code === code);
      check(
        `${code} can ${permission}`,
        !!role && (role.permissions as string[]).includes(permission),
        role ? (role.permissions as string[]).filter((p: string) => p.startsWith("admin.")).join(",") : "role missing",
      );
    }

    // And the one that must NOT be handed out with them: unlocking a colleague
    // is a supervisory act, resetting their PIN is not the same thing.
    const cashier = rows.find((r: any) => r.code === "TREASURY_CASHIER");
    check(
      "a cashier who can see the tills still cannot edit accounts",
      !!cashier && !(cashier.permissions as string[]).includes("admin.users.edit"),
      cashier ? (cashier.permissions as string[]).filter((p: string) => p.startsWith("admin.")).join(",") : "role missing",
    );
  });

  await ctx.scenario("security — the first-run wizard walks its own four steps", async () => {
    // WALK THE SEQUENCE THE SCREEN ACTUALLY PERFORMS, not the routes in
    // isolation. `FirstRunWizard`'s steps are activate → admin → seed →
    // import, so its SEED step runs after `/bootstrap/admin` has claimed the
    // tenant. Guarding `/bootstrap/seed` on "is this tenant claimed" therefore
    // 409s the wizard on its own next click, on a brand-new install — which is
    // the one flow the route exists for. That guard was written, shipped past
    // a green suite, and caught only by replaying these four steps in order.
    const fresh = await createBackend({ dbPath: ":memory:" });
    try {
      const post = (path: string, body: unknown) =>
        fresh.app.fetch(
          new Request(`http://wizard${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        );

      const status = await fresh.app.fetch(new Request("http://wizard/bootstrap/status"));
      const before = (await status.json()) as { claimed?: boolean };
      check("an untouched install reports itself unclaimed", before.claimed === false, JSON.stringify(before));

      const admin = await post("/bootstrap/admin", {
        nameAr: "المالك", nameEn: "Owner", email: "wizard-owner@fresh.example", pin: "357913",
      });
      check("step 2 creates the owner's admin", admin.status === 201, `got ${admin.status}`);

      const seed = await post("/bootstrap/seed", {});
      check("step 3 SEEDS, rather than 409-ing on the tenant it just claimed", seed.status === 200, `got ${seed.status}`);
      const counts = (await seed.json()) as { accounts: number; users: number };
      check("and reports what the tenant holds", counts.accounts > 0 && counts.users > 0, JSON.stringify(counts));

      const again = await post("/bootstrap/admin", {
        nameAr: "دخيل", nameEn: "Intruder", email: "intruder@fresh.example", pin: "111111",
      });
      check("while claiming it a second time is still refused", again.status === 409, `got ${again.status}`);
    } finally {
      fresh.close();
    }
  });
}
