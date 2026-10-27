import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LOCK_FAILURES,
  SignInVerdict,
  createAccountLocks,
  createMemoryAccountLockStore,
  createSignInGuard,
  type AccountLockStore,
  type SignInGuard,
} from "./sign-in-guard.js";
import { createLoginThrottle, createSourceThrottle, throttleSource } from "./login-throttle.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const OWNER = "owner@shop.test";

interface Rig {
  readonly guard: SignInGuard;
  readonly known: AccountLockStore;
  advance(ms: number): void;
  at(): number;
  guess(account: string, source: string | null, exists?: boolean): Promise<SignInVerdict>;
  readonly guessedAt: number[];
}

function rig(known: AccountLockStore = createMemoryAccountLockStore()): Rig {
  let now = 1_700_000_000_000;
  const clock = () => now;
  const locks = createAccountLocks({ known, unknown: createMemoryAccountLockStore(), now: clock });
  const guard = createSignInGuard({ throttle: createLoginThrottle(clock), sources: createSourceThrottle(clock), locks });
  const guessedAt: number[] = [];
  return {
    guard,
    known,
    advance: (ms) => {
      now += ms;
    },
    at: clock,
    guessedAt,
    async guess(account, source, exists = true) {
      const before = await guard.check(account, source, exists);
      if (before.verdict !== SignInVerdict.Proceed) return before.verdict;
      guessedAt.push(now);
      return (await guard.failed(account, source, exists)).verdict;
    },
  };
}

function mostGuessesInAnyDay(guessedAt: readonly number[]): number {
  let most = 0;
  let from = 0;
  for (let to = 0; to < guessedAt.length; to += 1) {
    while (guessedAt[to]! - guessedAt[from]! >= DAY) from += 1;
    most = Math.max(most, to - from + 1);
  }
  return most;
}

describe("how many PINs an attacker gets to try against one account", () => {
  it("stops a patient attacker on one address at twenty, and never lets the next day buy more", async () => {
    const r = rig();
    for (let tick = 0; tick < (3 * DAY) / (10 * SECOND); tick += 1) {
      await r.guess(OWNER, "41.33.10.10");
      r.advance(10 * SECOND);
    }
    expect(r.guessedAt.length).toBe(ACCOUNT_LOCK_FAILURES);
    expect((await r.guard.check(OWNER, "41.33.10.10", true)).verdict).toBe(SignInVerdict.Locked);
    expect((await r.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Locked);
  });

  it("holds an attacker who paces himself under the lock to fewer than twenty guesses in any twenty-four hours", async () => {
    const r = rig();
    const mine: number[] = [];
    for (let tick = 0; tick < (10 * DAY) / MINUTE; tick += 1) {
      const recent = mine.filter((at) => r.at() - at < DAY).length;
      if (recent < ACCOUNT_LOCK_FAILURES - 1 && (await r.guard.check(OWNER, "41.33.10.10", true)).verdict === SignInVerdict.Proceed) {
        await r.guess(OWNER, "41.33.10.10");
        mine.push(r.at());
      }
      r.advance(MINUTE);
    }
    expect(mostGuessesInAnyDay(r.guessedAt)).toBeLessThanOrEqual(ACCOUNT_LOCK_FAILURES);
    expect(r.guessedAt.length).toBeLessThanOrEqual(10 * ACCOUNT_LOCK_FAILURES);
  });

  it("stops fifty rotating addresses at twenty guesses between them", async () => {
    const r = rig();
    for (let round = 0; round < 40; round += 1) {
      for (let host = 1; host <= 50; host += 1) await r.guess(OWNER, `10.20.30.${host}`);
      r.advance(HOUR);
    }
    expect(r.guessedAt.length).toBe(ACCOUNT_LOCK_FAILURES);
    expect(mostGuessesInAnyDay(r.guessedAt)).toBeLessThanOrEqual(ACCOUNT_LOCK_FAILURES);
  });

  it("counts every address inside one IPv6 /64 as the one subscriber it is", async () => {
    const r = rig();
    const verdicts: SignInVerdict[] = [];
    for (let i = 0; i < 12; i += 1) verdicts.push((await r.guess(OWNER, `2001:db8:aa:bb:${(i + 1).toString(16)}::${(i * 7 + 1).toString(16)}`)));

    expect(verdicts.slice(0, 5)).toEqual(Array<SignInVerdict>(5).fill(SignInVerdict.Failed));
    expect(verdicts[5]).toBe(SignInVerdict.Wait);
    expect(r.guessedAt.length).toBe(6);
    expect(throttleSource("2001:db8:aa:bb:1::1")).toBe(throttleSource("2001:0DB8:00aa:00bb:ffff:ffff:ffff:ffff"));
    expect(throttleSource("2001:db8:aa:bc::1")).not.toBe(throttleSource("2001:db8:aa:bb::1"));
    expect(throttleSource("::ffff:41.33.10.10")).toBe("41.33.10.10");
    expect(throttleSource(null)).toBeNull();
  });

  it("stops an IPv6 /64 rotation at twenty guesses a day however long it runs", async () => {
    const r = rig();
    for (let tick = 0; tick < (2 * DAY) / MINUTE; tick += 1) {
      await r.guess(OWNER, `2001:db8:1:2:${(tick % 0xffff).toString(16)}:${((tick * 31) % 0xffff).toString(16)}::9`);
      r.advance(MINUTE);
    }
    expect(r.guessedAt.length).toBe(ACCOUNT_LOCK_FAILURES);
  });

  it("keeps the count on a real account through a flood of 10,001 other names from 10,001 addresses", async () => {
    const r = rig();
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES - 1; i += 1) {
      await r.guess(OWNER, `10.1.${i}.1`);
      r.advance(MINUTE);
    }
    for (let i = 0; i < 10_001; i += 1) {
      await r.guard.failed(`ghost${i}@nowhere.test`, `172.${16 + (i % 16)}.${(i >> 8) % 256}.${i % 256}`, false);
    }
    expect(await r.guess(OWNER, "10.9.9.9")).toBe(SignInVerdict.Locked);
    expect(r.guessedAt.length).toBe(ACCOUNT_LOCK_FAILURES);
    expect(await r.guess(OWNER, "10.9.9.10")).toBe(SignInVerdict.Locked);
    expect(r.guessedAt.length).toBe(ACCOUNT_LOCK_FAILURES);
  });

  it("locks a name nobody holds after the same twenty, so the lock does not say which accounts exist", async () => {
    const r = rig();
    const verdicts: SignInVerdict[] = [];
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES + 1; i += 1) verdicts.push((await r.guess("nobody@shop.test", `10.4.${i}.1`, false)));
    expect(verdicts[ACCOUNT_LOCK_FAILURES - 1]).toBe(SignInVerdict.Locked);
    expect(verdicts[ACCOUNT_LOCK_FAILURES]).toBe(SignInVerdict.Locked);
  });
});

describe("who a lock does not stop", () => {
  it("never locks a cashier who mistypes twice before every sign-in, four times a shift, for sixty days", async () => {
    const r = rig();
    for (let day = 0; day < 60; day += 1) {
      for (let signIn = 0; signIn < 4; signIn += 1) {
        expect(await r.guess("cashier@shop.test", "196.221.5.5"), `day ${day}`).toBe(SignInVerdict.Failed);
        r.advance(20 * SECOND);
        expect(await r.guess("cashier@shop.test", "196.221.5.5"), `day ${day}`).toBe(SignInVerdict.Failed);
        r.advance(20 * SECOND);
        expect((await r.guard.check("cashier@shop.test", "196.221.5.5", true)).verdict, `day ${day}`).toBe(SignInVerdict.Proceed);
        await r.guard.succeeded("cashier@shop.test", "196.221.5.5");
        r.advance(3 * HOUR);
      }
      r.advance(12 * HOUR - 4 * 40 * SECOND);
    }
  });

  it("leaves the machine's own console open while the account is locked for everyone else", async () => {
    const r = rig();
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i += 1) await r.guess(OWNER, `10.1.${i}.1`);
    expect((await r.guard.check(OWNER, "10.1.99.1", true)).verdict).toBe(SignInVerdict.Locked);
    expect((await r.guard.check(OWNER, null, true)).verdict).toBe(SignInVerdict.Proceed);
  });

  it("does not count the console's own typos toward the lock", async () => {
    const r = rig();
    for (let i = 0; i < 30; i += 1) {
      await r.guess(OWNER, null);
      r.advance(HOUR);
    }
    expect((await r.guard.check(OWNER, "10.1.99.1", true)).verdict).toBe(SignInVerdict.Proceed);
  });

  it("locks the attacked account and no other", async () => {
    const r = rig();
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i += 1) await r.guess(OWNER, `10.1.${i}.1`);
    expect((await r.guard.check("clerk@shop.test", "10.1.3.1", true)).verdict).toBe(SignInVerdict.Proceed);
  });
});

describe("what ends a lock", () => {
  async function locked(): Promise<Rig> {
    const r = rig();
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i += 1) await r.guess(OWNER, `10.1.${i}.1`);
    return r;
  }

  it("is not time: thirty days later the account is still locked", async () => {
    const r = (await locked());
    r.advance(30 * DAY);
    expect((await r.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Locked);
  });

  it("is not a correct PIN from somewhere else: a success clears only that address's own backoff", async () => {
    const r = rig();
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES - 1; i += 1) await r.guess(OWNER, `10.1.${i}.1`);
    await r.guard.succeeded(OWNER, "196.221.5.5");
    expect(await r.guess(OWNER, "10.1.200.1")).toBe(SignInVerdict.Locked);
  });

  it("is an administrator's unlock, which gives the account a fresh twenty", async () => {
    const r = (await locked());
    await r.guard.unlock(OWNER);
    expect((await r.guard.check(OWNER, "10.1.3.1", true)).verdict).toBe(SignInVerdict.Proceed);
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES - 1; i += 1) expect(await r.guess(OWNER, `10.2.${i}.1`)).toBe(SignInVerdict.Failed);
    expect(await r.guess(OWNER, "10.2.99.1")).toBe(SignInVerdict.Locked);
  });

  it("is the one-time code mailed when it locked, once, and only while it is fresh", async () => {
    const r = (await locked());
    const code = r.guard.issueUnlockCode(OWNER);
    expect(code).toMatch(/^[A-Z2-7]{16}$/);

    expect(await r.guard.redeemUnlockCode(OWNER, "AAAAAAAAAAAAAAAA")).toBe(false);
    expect((await r.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Locked);
    expect(await r.guard.redeemUnlockCode(OWNER, code!.toLowerCase())).toBe(true);
    expect((await r.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Proceed);
    expect(await r.guard.redeemUnlockCode(OWNER, code!)).toBe(false);
  });

  it("refuses the code after an hour", async () => {
    const late = (await locked());
    const stale = late.guard.issueUnlockCode(OWNER)!;
    late.advance(HOUR + 1);
    expect(await late.guard.redeemUnlockCode(OWNER, stale)).toBe(false);
  });

  it("is never spent by wrong codes: after fifty of them the mailed code still opens the account", async () => {
    const guessed = (await locked());
    const real = guessed.guard.issueUnlockCode(OWNER)!;
    for (let i = 0; i < 50; i += 1) expect(await guessed.guard.redeemUnlockCode(OWNER, "BBBBBBBBBBBBBBBB")).toBe(false);
    expect((await guessed.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Locked);
    expect(await guessed.guard.redeemUnlockCode(OWNER, real)).toBe(true);
    expect((await guessed.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Proceed);
  });

  it("is due a fresh code and link only once the last ones have expired, so a locked account is mailed at most once an hour", async () => {
    const r = (await locked());
    expect(r.guard.unlockReissueDue(OWNER)).toBe(true);
    const firstCode = r.guard.issueUnlockCode(OWNER)!;
    const firstLink = r.guard.issueUnlockLink(OWNER)!;
    expect(r.guard.unlockReissueDue(OWNER)).toBe(false);
    r.advance(HOUR - 1);
    expect(r.guard.unlockReissueDue(OWNER)).toBe(false);
    r.advance(2);
    expect(r.guard.unlockReissueDue(OWNER)).toBe(true);

    const secondCode = r.guard.issueUnlockCode(OWNER)!;
    const secondLink = r.guard.issueUnlockLink(OWNER)!;
    expect(r.guard.unlockReissueDue(OWNER)).toBe(false);
    expect(await r.guard.redeemUnlockCode(OWNER, firstCode)).toBe(false);
    expect(await r.guard.redeemUnlockLink(firstLink)).toBeNull();
    expect(await r.guard.redeemUnlockLink(secondLink)).toBe(OWNER);
    expect(secondCode).not.toBe(firstCode);
  });

  it("is never due anything for an account that is not locked, or for a name nobody holds", async () => {
    const r = rig();
    expect(r.guard.unlockReissueDue(OWNER)).toBe(false);
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i += 1) await r.guess("nobody@shop.test", `10.4.${i}.1`, false);
    expect(r.guard.unlockReissueDue("nobody@shop.test")).toBe(false);
  });

  it("is the single-use link mailed when it locked: it names no account, opens the one it was issued for, and dies with the code", async () => {
    const r = (await locked());
    const code = r.guard.issueUnlockCode(OWNER)!;
    const link = r.guard.issueUnlockLink(OWNER)!;
    expect(link).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(r.known.get(OWNER))).not.toContain(link);

    expect(await r.guard.redeemUnlockLink(`${link.slice(0, -1)}${link.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect((await r.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Locked);
    expect(await r.guard.redeemUnlockLink(link)).toBe(OWNER);
    expect((await r.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Proceed);
    expect(await r.guard.redeemUnlockLink(link)).toBeNull();
    expect(await r.guard.redeemUnlockCode(OWNER, code)).toBe(false);
  });

  it("refuses the link after an hour, after the code was used, and after an administrator unlocked the account", async () => {
    const late = (await locked());
    const stale = late.guard.issueUnlockLink(OWNER)!;
    late.advance(HOUR + 1);
    expect(await late.guard.redeemUnlockLink(stale)).toBeNull();
    expect((await late.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Locked);

    const byCode = (await locked());
    const code = byCode.guard.issueUnlockCode(OWNER)!;
    const afterCode = byCode.guard.issueUnlockLink(OWNER)!;
    expect(await byCode.guard.redeemUnlockCode(OWNER, code)).toBe(true);
    expect(await byCode.guard.redeemUnlockLink(afterCode)).toBeNull();

    const byAdmin = (await locked());
    const afterAdmin = byAdmin.guard.issueUnlockLink(OWNER)!;
    await byAdmin.guard.unlock(OWNER);
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i += 1) await byAdmin.guess(OWNER, `10.3.${i}.1`);
    expect(await byAdmin.guard.redeemUnlockLink(afterAdmin)).toBeNull();
    expect((await byAdmin.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Locked);
  });

  it("issues no link for an account that is not locked or does not exist", async () => {
    const r = rig();
    expect(r.guard.issueUnlockLink(OWNER)).toBeNull();
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i += 1) await r.guess("nobody@shop.test", `10.4.${i}.1`, false);
    expect(r.guard.issueUnlockLink("nobody@shop.test")).toBeNull();
  });

  it("issues no code for an account that is not locked or does not exist", async () => {
    const r = rig();
    expect(r.guard.issueUnlockCode(OWNER)).toBeNull();
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i += 1) await r.guess("nobody@shop.test", `10.4.${i}.1`, false);
    expect(r.guard.issueUnlockCode("nobody@shop.test")).toBeNull();
  });

  it("survives a restart: a new guard over the same store still refuses", async () => {
    const store = createMemoryAccountLockStore();
    const first = rig(store);
    for (let i = 0; i < ACCOUNT_LOCK_FAILURES; i += 1) await first.guess(OWNER, `10.1.${i}.1`);
    const second = rig(store);
    expect((await second.guard.check(OWNER, "196.221.5.5", true)).verdict).toBe(SignInVerdict.Locked);
  });
});
