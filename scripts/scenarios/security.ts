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
      permissions: ["accounting.gl.post"], isSystem: false, status: "active",
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
}
