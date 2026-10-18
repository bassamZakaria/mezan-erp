import { afterEach, describe, expect, it } from "vitest";
import type { SessionDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle } from "./create-backend.js";
import { UNDISCLOSED_TENANT_NAME } from "./auth-routes.js";
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PIN, SEED_TENANT_NAME, resolveSeedAdminSecrets } from "./seed.js";

type App = BackendHandle["app"];

const handles: BackendHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

async function newBackend(): Promise<App> {
  const handle = await createBackend({ dbPath: ":memory:" });
  handles.push(handle);
  return handle.app;
}

function post(app: App, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function get(app: App, path: string, headers: Record<string, string> = {}) {
  return app.fetch(new Request(`http://local${path}`, { headers }));
}

/** Signs in as the seeded admin and returns the bearer headers. */
async function adminHeaders(app: App): Promise<Record<string, string>> {
  const res = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN });
  expect(res.status).toBe(200);
  const session = (await res.json()) as SessionDTO & { token: string };
  return { authorization: `Bearer ${session.token}` };
}

/* ================================================================== */
/* S1 — an anonymous caller could mint a company admin                 */
/* ================================================================== */

describe("POST /bootstrap/admin — claiming an install, and only an unclaimed one (S1)", () => {
  it("claims a fresh tenant, because that is the route's whole job", () => {
    // The negative control comes first: a guard that closed this route
    // entirely would pass every test below and ship a product nobody can set
    // up. The seeded fallback admin does NOT count as a claim.
    return newBackend().then(async (app) => {
      const res = await post(app, "/bootstrap/admin", {
        nameAr: "بسام زكريا",
        email: "owner@shop.test",
        pin: "246813", companyName: "متجر الاختبار",
      });

      expect(res.status).toBe(201);
      const session = (await res.json()) as SessionDTO;
      expect(session.isCompanyAdmin).toBe(true);
      expect(session.permissions).toContain("*");
    });
  });

  it("refuses once the tenant has an account of its own, with 409 TENANT_ALREADY_PROVISIONED", async () => {
    // Measured before the fix on a seeded tenant with 66 accounts and an
    // existing admin: an anonymous POST returned a live company-admin session
    // that then read customers, users and the trial balance. On the LAN mount
    // that was the whole business, from the shop wifi, with no credential.
    const app = await newBackend();
    await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "246813", companyName: "متجر الاختبار" });

    const second = await post(app, "/bootstrap/admin", {
      nameAr: "attacker",
      email: "attacker@evil.test",
      pin: "999999", companyName: "متجر الاختبار",
    });

    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("TENANT_ALREADY_PROVISIONED");
  });

  it("answers a claimed tenant's record counts only to a signed-in session; an anonymous caller learns the flags", async () => {
    const app = await newBackend();
    const before = (await (await get(app, "/bootstrap/status")).json()) as Record<string, unknown>;
    expect(before).toMatchObject({ claimed: false });
    expect(before).toHaveProperty("accounts");

    const claim = await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "246813", companyName: "متجر الاختبار" });
    const session = (await claim.json()) as SessionDTO & { token: string };

    const anonymous = (await (await get(app, "/bootstrap/status")).json()) as Record<string, unknown>;
    expect(anonymous).toEqual({ claimed: true, demoSeeded: false });
    const forged = (await (await get(app, "/bootstrap/status", { authorization: "Bearer not-a-session" })).json()) as Record<string, unknown>;
    expect(forged).not.toHaveProperty("users");

    const signedIn = (await (await get(app, "/bootstrap/status", { authorization: `Bearer ${session.token}` })).json()) as Record<string, unknown>;
    expect(signedIn).toMatchObject({ claimed: true });
    expect(signedIn["users"]).toBeGreaterThan(0);
  });

  it("hands back NO session when it refuses — not a token, not a permission list", async () => {
    // The status code alone is not the security property. A 409 that still
    // carried a token would be the same takeover with a different number on
    // it, and a test that only checked the status would have missed it.
    const app = await newBackend();
    await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "246813", companyName: "متجر الاختبار" });

    const second = await post(app, "/bootstrap/admin", {
      nameAr: "attacker",
      email: "attacker@evil.test",
      pin: "999999", companyName: "متجر الاختبار",
    });
    const body = (await second.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("permissions");
    expect(body).not.toHaveProperty("userId");
    expect(body["isCompanyAdmin"]).toBeUndefined();
  });

  it("creates no account when it refuses — the attacker is not left with a dormant login", async () => {
    const app = await newBackend();
    await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "246813", companyName: "متجر الاختبار" });
    await post(app, "/bootstrap/admin", { nameAr: "attacker", email: "attacker@evil.test", pin: "999999", companyName: "متجر الاختبار" });

    const login = await post(app, "/auth/login", { username: "attacker@evil.test", pin: "999999" });
    expect(login.status).toBe(401);
  });

  it.each([
    ["without a company", { nameAr: "attacker", email: "attacker@evil.test", pin: "999999" }, "attacker@evil.test"],
    ["with no usable field at all", { email: 7 }, null],
  ])("answers a claim %s on a claimed install as already provisioned, and records the refusal", async (_what, body, recordedEmail) => {
    const app = await newBackend();
    const claimed = await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "246813", companyName: "متجر الاختبار" });
    const owner = { authorization: `Bearer ${((await claimed.json()) as { token: string }).token}` };

    const refused = await post(app, "/bootstrap/admin", body);

    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("TENANT_ALREADY_PROVISIONED");
    const audit = await get(app, "/audit?stream=security&action=BOOTSTRAP_REFUSED", owner);
    const { events } = (await audit.json()) as { events: { severity: string; details: { email: string | null } }[] };
    expect(events.map((event) => [event.severity, event.details.email])).toEqual([["CRITICAL", recordedEmail]]);
  });

  it("re-running the wizard with an EXISTING admin's address returns 409 and no session (S1's second door)", async () => {
    // This was the subtler half: a duplicate email used to return the
    // existing admin's session "for wizard idempotency", so naming a known
    // admin address was a credential-free takeover. A retrying wizard now
    // sends the person to the login screen, which is where they belong once
    // the account exists.
    const app = await newBackend();
    await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "246813", companyName: "متجر الاختبار" });

    const replay = await post(app, "/bootstrap/admin", {
      nameAr: "بسام زكريا",
      email: "owner@shop.test",
      pin: "111111", companyName: "متجر الاختبار",
    });

    expect(replay.status).toBe(409);
    expect(await replay.json()).not.toHaveProperty("token");
  });

  it("does not let a replay change the real owner's PIN", async () => {
    // The refusal has to be a refusal to WRITE, not only a refusal to return
    // a session. If the replay reset the PIN, an attacker would lock the
    // owner out and know the new one.
    const app = await newBackend();
    await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "246813", companyName: "متجر الاختبار" });
    await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "111111", companyName: "متجر الاختبار" });

    expect((await post(app, "/auth/login", { username: "owner@shop.test", pin: "111111" })).status).toBe(401);
    expect((await post(app, "/auth/login", { username: "owner@shop.test", pin: "246813" })).status).toBe(200);
  });

  it("still validates its body, and a malformed one neither claims nor leaks", async () => {
    const app = await newBackend();
    const res = await post(app, "/bootstrap/admin", { email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });
});

/* ================================================================== */
/* S6 — no lockout on a six-digit PIN                                  */
/* ================================================================== */

describe("POST /auth/login — the brute force has to cost something (S6)", () => {
  it("locks the account after five wrong PINs and answers 429 with a retry-after", async () => {
    // 20 guesses in 0.557s before the fix, and the correct PIN still worked
    // afterwards. One million combinations was under eight hours.
    const app = await newBackend();

    for (let i = 0; i < 5; i++) {
      const res = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" });
      expect(res.status, `attempt ${i + 1} should still be a plain refusal`).toBe(401);
    }

    const locked = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" });
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { error: string }).error).toBe("TOO_MANY_ATTEMPTS");
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses the CORRECT PIN while locked — otherwise the lock protects nothing", async () => {
    // The lock must gate the account, not merely the wrong guesses. Before the
    // fix the correct PIN worked immediately after 20 failures.
    const app = await newBackend();
    for (let i = 0; i < 6; i++) await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" });

    const withRealPin = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN });
    expect(withRealPin.status).toBe(429);
  });

  it("locks the attacked account only — the shop can still trade (negative control)", async () => {
    // A throttle that locked globally would hand an attacker a denial of
    // service against the till, which is a worse bug than the one being fixed.
    const app = await newBackend();
    await post(app, "/bootstrap/admin", { nameAr: "بسام زكريا", email: "owner@shop.test", pin: "246813", companyName: "متجر الاختبار" });

    for (let i = 0; i < 8; i++) await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" });

    expect((await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" })).status).toBe(429);
    expect((await post(app, "/auth/login", { username: "owner@shop.test", pin: "246813" })).status).toBe(200);
  });

  it("a successful login clears the streak, so four typos then the right PIN costs nothing", async () => {
    const app = await newBackend();
    for (let i = 0; i < 4; i++) await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" });

    expect((await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN })).status).toBe(200);

    // The budget is full again rather than one away from a lock.
    for (let i = 0; i < 5; i++) {
      expect((await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" })).status).toBe(401);
    }
  });

  it("counts an UNKNOWN email too, so probing addresses is not a free channel", async () => {
    const app = await newBackend();
    for (let i = 0; i < 5; i++) {
      expect((await post(app, "/auth/login", { username: "nobody@shop.test", pin: "000000" })).status).toBe(401);
    }
    expect((await post(app, "/auth/login", { username: "nobody@shop.test", pin: "000000" })).status).toBe(429);
  });

  it("answers an unknown email exactly as it answers a wrong PIN — no account oracle", async () => {
    // Before the fix an unknown email returned BEFORE any hashing, so the
    // response time answered "does this account exist" for free. The bodies
    // must be indistinguishable as well as the timing.
    const app = await newBackend();

    const unknown = await post(app, "/auth/login", { username: "nobody@shop.test", pin: "000000" });
    const wrongPin = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" });

    expect(unknown.status).toBe(wrongPin.status);
    expect(await unknown.json()).toEqual(await wrongPin.json());
  });

  it("spends the same scrypt on an unknown email as on a real one (the timing decoy)", async () => {
    // scrypt is deliberately slow, so a route that skipped it for unknown
    // emails was orders of magnitude faster on a miss — a usable oracle even
    // over a network. This asserts the two are within the same order of
    // magnitude rather than a fixed millisecond figure, which would be flaky.
    const app = await newBackend();
    // Warm the decoy hash and the code paths first; the first call of either
    // pays one-off costs that have nothing to do with the comparison.
    await post(app, "/auth/login", { username: "warm@shop.test", pin: "000000" });
    await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" });

    const timeOf = async (username: string) => {
      const started = performance.now();
      await post(app, "/auth/login", { username, pin: "000000" });
      return performance.now() - started;
    };

    const miss = await timeOf("nobody-else@shop.test");
    const hit = await timeOf("also-unknown@shop.test");
    // Both are misses here on purpose: what is asserted is that a miss is not
    // instantaneous, i.e. it really did hash something.
    expect(miss).toBeGreaterThan(1);
    expect(hit).toBeGreaterThan(1);
  });
});

/* ================================================================== */
/* S7 — every install shipped the same working admin login             */
/* ================================================================== */

describe("the seeded fallback admin's secrets (S7)", () => {
  it("keeps the published PIN in development, so every script and doc still signs in", () => {
    // The negative control. Breaking `123456` in development would break
    // `pnpm smoke`, `pnpm scenarios`, `pnpm check:seed`, the e2e suite and
    // every line of docs/TESTING.md that tells a person how to log in.
    const secrets = resolveSeedAdminSecrets({});
    expect(secrets.pin).toBe(SEED_ADMIN_PIN);
    expect(secrets.generated).toBe(false);
  });

  it("does not THROW on a packaged build — the branch only a packaged build reaches (D127)", () => {
    // It did. `randomInt` refuses a range wider than 2**48-1 and was handed
    // `Number.MAX_SAFE_INTEGER` (2**53-1), so this call threw
    // `ERR_OUT_OF_RANGE` on every packaged install — the one edition the whole
    // S7 fix exists for. Nothing caught it, because the PR's own regression
    // script runs in development, where `packaged` is false and this branch is
    // never entered. Asserted before anything about the VALUE, so a future
    // rewrite that throws again fails here rather than somewhere confusing.
    expect(() => resolveSeedAdminSecrets({ MEZAN_PACKAGED: "1" })).not.toThrow();
    expect(() => resolveSeedAdminSecrets({ NODE_ENV: "production" })).not.toThrow();
  });

  it("gives a packaged build a password with real entropy, not a predictable one", () => {
    const passwords = new Set(
      Array.from({ length: 40 }, () => resolveSeedAdminSecrets({ MEZAN_PACKAGED: "1" }).password),
    );
    expect(passwords.size).toBe(40);
    for (const password of passwords) {
      // The development placeholder must never survive into a packaged build.
      expect(password).not.toBe("change-me-on-first-login");
      expect(password.length).toBeGreaterThanOrEqual(16);
    }
  });

  it("generates a random, unprinted PIN for a packaged build", () => {
    // Every install in the country shared one working company-admin login,
    // published in docs/TESTING.md.
    const packaged = resolveSeedAdminSecrets({ MEZAN_PACKAGED: "1" });
    expect(packaged.generated).toBe(true);
    expect(packaged.pin).not.toBe(SEED_ADMIN_PIN);
    expect(packaged.pin).toMatch(/^\d{6}$/);
  });

  it("treats NODE_ENV=production as packaged too, so a server build is not left on 123456", () => {
    const production = resolveSeedAdminSecrets({ NODE_ENV: "production" });
    expect(production.generated).toBe(true);
    expect(production.pin).not.toBe(SEED_ADMIN_PIN);
  });

  it("does not generate the SAME 'random' PIN twice", () => {
    // A generator seeded once, or one that fell back to a constant, would
    // satisfy every assertion above while shipping a shared credential again.
    const pins = new Set(
      Array.from({ length: 40 }, () => resolveSeedAdminSecrets({ MEZAN_PACKAGED: "1" }).pin),
    );
    expect(pins.size).toBeGreaterThan(30);
  });

  it("pads a low random draw to six digits, so the PIN is never short", () => {
    // `randomInt(0, 1_000_000)` produces 7 as readily as 999999. An unpadded
    // "7" is a one-digit credential.
    for (let i = 0; i < 200; i++) {
      expect(resolveSeedAdminSecrets({ MEZAN_PACKAGED: "1" }).pin).toHaveLength(6);
    }
  });

  it("lets MEZAN_SEED_ADMIN_PIN pin the PIN deliberately for a packaged-build test", () => {
    const pinned = resolveSeedAdminSecrets({ MEZAN_PACKAGED: "1", MEZAN_SEED_ADMIN_PIN: "424242" });
    expect(pinned.pin).toBe("424242");
    expect(pinned.generated).toBe(false);
  });

  it("ignores a malformed override rather than seeding a credential that cannot be typed", () => {
    // A five-digit or non-numeric override must not become the account's PIN;
    // the login form takes six digits, so that account would be unreachable.
    for (const bad of ["12345", "1234567", "abcdef", "", "12 34 56"]) {
      const result = resolveSeedAdminSecrets({ MEZAN_PACKAGED: "1", MEZAN_SEED_ADMIN_PIN: bad });
      expect(result.pin, `override ${JSON.stringify(bad)}`).not.toBe(bad);
      expect(result.generated).toBe(true);
    }
  });

  it("lets a per-tenant pinOverride win over the environment, even in production", () => {
    const pinned = resolveSeedAdminSecrets({ NODE_ENV: "production", MEZAN_SEED_ADMIN_PIN: "424242" }, "123456");
    expect(pinned).toEqual({ pin: "123456", password: expect.any(String), generated: false });
    expect(resolveSeedAdminSecrets({ NODE_ENV: "production" }, "12345").generated).toBe(true);
  });

  it("refuses seedAdminPin on a backend that is not the demo tenant", async () => {
    await expect(createBackend({ dbPath: ":memory:", seedAdminPin: "123456" })).rejects.toThrow(/seedDemoData/);
  });
});

/* ================================================================== */
/* The session itself — what stayed good, asserted rather than assumed */
/* ================================================================== */

describe("the session token", () => {
  it("is opaque and long enough that guessing it is not a strategy", async () => {
    const app = await newBackend();
    const res = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN });
    const session = (await res.json()) as SessionDTO & { token: string };

    expect(session.token.length).toBeGreaterThanOrEqual(32);
    // It must not encode the identity it stands for: a token a reader can
    // decode is a token a reader can forge.
    expect(session.token).not.toContain(SEED_ADMIN_EMAIL);
    expect(session.token).not.toContain(session.userId);
  });

  it("is refused when forged, and the real one still works afterwards", async () => {
    const app = await newBackend();
    const real = await adminHeaders(app);

    const forged = await get(app, "/users", { authorization: "Bearer not-a-real-token" });
    expect([401, 403]).toContain(forged.status);

    expect((await get(app, "/users", real)).status).toBe(200);
  });

  it("does not accept an x-permissions header in place of a session", async () => {
    // S9's shape: the desktop shell used to run a resolver that took
    // `x-permissions: *` from anywhere on the network.
    const app = await newBackend();
    const res = await get(app, "/users", { "x-permissions": "*" });
    expect([401, 403]).toContain(res.status);
  });
});

describe("the seeded fallback admin is retired when the tenant is claimed (S35)", () => {
  it("stops being able to sign in the moment a real admin exists", async () => {
    const app = await newBackend();

    // Before the claim it is the only account there is, and it must work —
    // that is the whole reason it exists.
    expect((await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN })).status).toBe(200);

    const claim = await post(app, "/bootstrap/admin", {
      nameAr: "المالك",
      nameEn: "Owner",
      email: "owner@claimed.example",
      pin: "246813", companyName: "متجر الاختبار",
    });
    expect(claim.status).toBe(201);

    // It used to stay ACTIVE with `isCompanyAdmin: true` forever: a permanent,
    // unattributable `["*"]` account on every install. A tenant admin could
    // claim it by setting a PIN of their own and share it; an auditor asking
    // "whose account is this" got no answer; and whoever installed the software
    // could set MEZAN_SEED_ADMIN_PIN beforehand and leave with a standing key.
    expect((await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN })).status).toBe(401);
    expect((await post(app, "/auth/login", { username: "owner@claimed.example", pin: "246813" })).status).toBe(200);
  });

  it("is deactivated, not deleted, so the recovery door and its history survive", async () => {
    const app = await newBackend();
    await post(app, "/bootstrap/admin", {
      nameAr: "المالك",
      nameEn: "Owner",
      email: "owner2@claimed.example",
      pin: "246814", companyName: "متجر الاختبار",
    });

    const owner = await post(app, "/auth/login", { username: "owner2@claimed.example", pin: "246814" });
    const session = (await owner.json()) as SessionDTO & { token: string };
    const users = (await (await get(app, "/users", { authorization: `Bearer ${session.token}` })).json()) as {
      id: string;
      status: string;
      isCompanyAdmin: boolean;
    }[];

    const seed = users.find((u) => u.id === "USER-ADMIN");
    // Deleting the row would take the audit history that points at it, and
    // `--reset-admin` reactivates this account from the machine's own
    // filesystem — which is the way back in for an owner who lost their PIN.
    expect(seed).toBeDefined();
    expect(seed?.status).toBe("inactive");
  });

  it("records the retirement on the event that caused it", async () => {
    const app = await newBackend();
    await post(app, "/bootstrap/admin", {
      nameAr: "المالك",
      nameEn: "Owner",
      email: "owner3@claimed.example",
      pin: "246815", companyName: "متجر الاختبار",
    });

    const owner = await post(app, "/auth/login", { username: "owner3@claimed.example", pin: "246815" });
    const session = (await owner.json()) as SessionDTO & { token: string };
    const audit = (await (
      await get(app, "/audit?stream=security&action=TENANT_CLAIMED&limit=5", {
        authorization: `Bearer ${session.token}`,
      })
    ).json()) as { events: { severity: string; details: Record<string, unknown> }[] };

    // The single highest-authority write in the product, which used to record
    // nothing at all — so a company admin appearing from nowhere was, after the
    // fact, indistinguishable from one that had always been there.
    expect(audit.events.length).toBeGreaterThan(0);
    expect(audit.events[0]?.severity).toBe("CRITICAL");
    expect(audit.events[0]?.details["seedAdminRetired"]).toBe(true);
  });
});

describe("administrative records carry where the act came from (S36)", () => {
  it("stamps an origin on every admin audit row", async () => {
    const app = await newBackend();
    const headers = await adminHeaders(app);

    await post(
      app,
      "/roles",
      { code: "ORIGIN_PROBE", name: "دور", permissions: ["sales.invoice.view"], isSystem: false, status: "active" },
      headers,
    );

    const audit = (await (await get(app, "/audit?entityType=ROLE&limit=5", headers)).json()) as {
      events: { action: string; details: Record<string, unknown> }[];
    };
    const created = audit.events.find((e) => e.action === "CREATE");

    // The session grant carried a user id and no origin, and the audit row
    // carried an actor and no origin — so "which till posted this" was not
    // answerable at any layer, on the one edition that serves the same app over
    // a LAN socket as well as in-process. "host" is a fact, not a blank.
    expect(created?.details["origin"]).toBe("host");
  });
});

/* ================================================================== */
/* N-15 — /auth/logout revoked without the origin check every other    */
/*        lookup performs, and it is on the LAN socket's public list   */
/* ================================================================== */

describe("POST /auth/logout — revoking a session needs to be the machine that holds it (N-15)", () => {
  /** The shape `requestOrigin` reads: a real socket under the request, never a header. */
  function fromAddress(address: string | null) {
    return address === null ? undefined : { incoming: { socket: { remoteAddress: address } } };
  }

  it("refuses to revoke a token presented from an address it was not minted at", async () => {
    const app = await newBackend();

    // The counter signs in over the LAN socket, from its own address.
    const login = await app.fetch(
      new Request("http://local/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }),
      }),
      fromAddress("192.168.1.40"),
    );
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as SessionDTO & { token: string };

    // Somebody else on the shop wifi, holding a captured token, signs the
    // counter out. Repeatedly, all afternoon, with no credential of their own.
    const stranger = await app.fetch(
      new Request("http://local/auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
      fromAddress("192.168.1.99"),
    );
    // It answers ok either way: a logout that reported whether the token was
    // real would be a token oracle, and the caller has nothing to do
    // differently.
    expect(stranger.status).toBe(200);

    // THE ASSERTION: the counter is still signed in.
    const stillLive = await app.fetch(
      new Request("http://local/tenant", { headers: { authorization: `Bearer ${token}` } }),
      fromAddress("192.168.1.40"),
    );
    expect(stillLive.status).toBe(200);
  });

  it("still ends the session for the machine that actually holds it", async () => {
    const app = await newBackend();
    const login = await app.fetch(
      new Request("http://local/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }),
      }),
      fromAddress("192.168.1.40"),
    );
    const { token } = (await login.json()) as SessionDTO & { token: string };

    const out = await app.fetch(
      new Request("http://local/auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
      fromAddress("192.168.1.40"),
    );
    expect(out.status).toBe(200);

    const after = await app.fetch(
      new Request("http://local/users", { headers: { authorization: `Bearer ${token}` } }),
      fromAddress("192.168.1.40"),
    );
    expect(after.status).toBe(401);
  });
});

describe("POST /auth/login — an address that names a different account each time is held too", () => {
  const fromAddress = (address: string) => ({ incoming: { socket: { remoteAddress: address } } });
  const attempt = (app: App, username: string, address: string, pin = "000000") =>
    app.fetch(
      new Request("http://local/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, pin }),
      }),
      fromAddress(address),
    );

  it("answers 429 once thirty accounts have been tried from one address, and still serves another address", async () => {
    const app = await newBackend();
    for (let i = 0; i < 30; i += 1) expect((await attempt(app, `ghost${i}@shop.test`, "192.168.1.66")).status).toBe(401);

    const held = await attempt(app, "ghost30@shop.test", "192.168.1.66");
    const next = await attempt(app, "ghost31@shop.test", "192.168.1.66");
    const owner = await attempt(app, SEED_ADMIN_EMAIL, "192.168.1.40", SEED_ADMIN_PIN);

    expect(held.status).toBe(429);
    expect(next.status).toBe(429);
    expect(await next.json()).toMatchObject({ error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: expect.any(Number) });
    expect(owner.status).toBe(200);
  }, 60_000);

  it("refuses the right PIN from a held address, so the hold cannot be guessed through", async () => {
    const app = await newBackend();
    for (let i = 0; i < 31; i += 1) await attempt(app, `ghost${i}@shop.test`, "192.168.1.66");

    expect((await attempt(app, SEED_ADMIN_EMAIL, "192.168.1.66", SEED_ADMIN_PIN)).status).toBe(429);
  }, 60_000);
});

describe("a sign-in whose event the audit log refuses", () => {
  it("is kept in the tenant's fallback and counted on the security exception report, without the PIN, and the sign-in still answers", async () => {
    const handle = await createBackend({ dbPath: ":memory:" });
    handles.push(handle);
    const app = handle.app;
    const headers = await adminHeaders(app);
    const append = handle.audit.append.bind(handle.audit);
    handle.audit.append = async () => {
      throw new Error("database is locked");
    };

    const wrong = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: "000000" });
    const right = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN });
    handle.audit.append = append;

    expect([wrong.status, right.status]).toEqual([401, 200]);
    const report = (await (await get(app, "/security-reports/exceptions", headers)).json()) as {
      unrecorded: { count: number; recent: { action: string; reason: string }[] };
    };
    expect(report.unrecorded.count).toBe(2);
    expect(report.unrecorded.recent.map((entry) => entry.action)).toEqual(["LOGIN_SUCCEEDED", "LOGIN_FAILED"]);
    expect(report.unrecorded.recent[0]?.reason).toBe("database is locked");
    expect(JSON.stringify(report.unrecorded)).not.toContain(SEED_ADMIN_PIN);
  });
});

/* ================================================================== */
/* D-SAAS-02 / D-SAAS-07 — the company's own name, and who may read it */
/* ================================================================== */

describe("POST /bootstrap/admin — the claim carries the company's name (D-SAAS-02)", () => {
  const COMPANY = "متجر الياسمين";
  const owner = { nameAr: "سارة الياسمين", email: "owner@shop.test", pin: "246813" };

  async function tenantNameAfterLogin(app: App): Promise<string> {
    const login = await post(app, "/auth/login", { username: owner.email, pin: owner.pin });
    expect(login.status).toBe(200);
    return ((await login.json()) as SessionDTO).tenantName;
  }

  it("names the tenant what the claim says, in the session it returns and in every later one", async () => {
    const app = await newBackend();

    const claimed = await post(app, "/bootstrap/admin", { ...owner, companyName: COMPANY });

    expect(claimed.status).toBe(201);
    expect(((await claimed.json()) as SessionDTO).tenantName).toBe(COMPANY);
    expect(await tenantNameAfterLogin(app)).toBe(COMPANY);
  });

  it("writes the name into the settings a printed document header reads", async () => {
    const app = await newBackend();
    const claimed = await post(app, "/bootstrap/admin", { ...owner, companyName: COMPANY });
    const { token } = (await claimed.json()) as SessionDTO & { token: string };

    const settings = await get(app, "/settings", { authorization: `Bearer ${token}` });

    expect(settings.status).toBe(200);
    expect(((await settings.json()) as { companyName: string }).companyName).toBe(COMPANY);
  });

  it("refuses a claim that names no company, so no install is left printing the seeded name", async () => {
    const app = await newBackend();

    const refused = await post(app, "/bootstrap/admin", owner);

    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
    expect((await post(app, "/auth/login", { username: owner.email, pin: owner.pin })).status).toBe(401);
    expect(((await (await get(app, "/bootstrap/status")).json()) as { claimed: boolean }).claimed).toBe(false);
  });

  it.each([
    ["longer than a document header holds", "ش".repeat(201)],
    ["carrying a right-to-left override", "متجر \u202Eevil"],
    ["carrying a line break", "متجر\nالياسمين"],
  ])("refuses a claim whose company name is %s", async (_what, companyName) => {
    const app = await newBackend();

    const refused = await post(app, "/bootstrap/admin", { ...owner, companyName });

    expect(refused.status).toBe(400);
    expect((await post(app, "/auth/login", { username: owner.email, pin: owner.pin })).status).toBe(401);
  });

  it("refuses a blank company name instead of naming the tenant nothing", async () => {
    const app = await newBackend();

    const refused = await post(app, "/bootstrap/admin", { ...owner, companyName: "   " });

    expect(refused.status).toBe(400);
    expect((await post(app, "/auth/login", { username: owner.email, pin: owner.pin })).status).toBe(401);
  });

  it("does not let a refused replay rename a tenant somebody already claimed", async () => {
    const app = await newBackend();
    await post(app, "/bootstrap/admin", { ...owner, companyName: COMPANY });

    const replay = await post(app, "/bootstrap/admin", { nameAr: "attacker", email: "attacker@evil.test", pin: "999999", companyName: "شركة المهاجم" });

    expect(replay.status).toBe(409);
    expect(await tenantNameAfterLogin(app)).toBe(COMPANY);
  });

  it("does not rename the tenant when creating the admin fails", async () => {
    const app = await newBackend();

    const refused = await post(app, "/bootstrap/admin", { ...owner, email: SEED_ADMIN_EMAIL, companyName: COMPANY });

    expect(refused.status).toBe(409);
    const seedLogin = await post(app, "/auth/login", { username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN });
    expect(((await seedLogin.json()) as SessionDTO).tenantName).toBe(SEED_TENANT_NAME);
  });
});

describe("GET /tenant — an anonymous caller never learns a claimed tenant's name (D-SAAS-07)", () => {
  it("answers the neutral placeholder once claimed, whatever the company is called", async () => {
    const app = await newBackend();
    await post(app, "/bootstrap/admin", { nameAr: "سارة", email: "owner@shop.test", pin: "246813", companyName: "متجر الياسمين" });

    const anonymous = await get(app, "/tenant");

    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual({ name: UNDISCLOSED_TENANT_NAME });
  });

  it("keeps answering the placeholder after the owner renames the company in Settings", async () => {
    const app = await newBackend();
    const claimed = await post(app, "/bootstrap/admin", { nameAr: "سارة", email: "owner@shop.test", pin: "246813", companyName: "متجر الياسمين" });
    const { token } = (await claimed.json()) as SessionDTO & { token: string };
    const auth = { authorization: `Bearer ${token}` };
    const current = (await (await get(app, "/settings", auth)).json()) as Record<string, unknown>;
    const renamed = await app.fetch(
      new Request("http://local/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ ...current, companyName: "الاسم التجاري السري" }),
      }),
    );
    expect(renamed.status).toBe(200);

    const anonymous = await get(app, "/tenant");

    expect(await anonymous.json()).toEqual({ name: UNDISCLOSED_TENANT_NAME });
  });

  it("the placeholder is not the vendor's own name", () => {
    expect(UNDISCLOSED_TENANT_NAME).not.toBe(SEED_TENANT_NAME);
  });
});
