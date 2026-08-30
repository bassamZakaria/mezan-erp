import type { Ctx } from "./harness.js";
import { createBackend } from "../../packages/backend/src/create-backend.js";
import { createFetchWebhookTransport } from "../../packages/backend/src/webhook-transport.js";
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

  await ctx.scenario("security — a webhook cannot be aimed at the shop's own network", async () => {
    const transport = createFetchWebhookTransport();
    for (const url of [
      "http://127.0.0.1/",
      "http://localhost/",
      "http://192.168.1.1/",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "file:///etc/passwd",
    ]) {
      const res = await transport.send({ url, headers: {}, body: "{}", timeoutMs: 2000 });
      check(`refuses ${url}`, res.statusCode === null && !!res.errorMessage, String(res.errorMessage));
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

    const reseed = await req("POST", "/bootstrap/seed", {}, ANONYMOUS);
    check("and /bootstrap/seed is closed too", reseed.status === 409, `got ${reseed.status}`);

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
}
