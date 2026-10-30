import { describe, expect, it } from "vitest";
import type { SecretHasher } from "@mezan/domain";
import { createPrecomputingHasher } from "./precomputed-secrets.js";

function countingHasher() {
  const calls = { hash: 0, verify: 0 };
  const inner: SecretHasher = {
    async hash(secret) {
      calls.hash += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return `hashed:${secret}:${calls.hash}`;
    },
    async verify(secret, hash) {
      calls.verify += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return hash.startsWith(`hashed:${secret}:`);
    },
  };
  return { inner, calls };
}

async function turnsTaken(work: () => Promise<unknown>): Promise<"microtask" | "yielded"> {
  let turned = false;
  const probe = setImmediate(() => {
    turned = true;
  });
  await work();
  clearImmediate(probe);
  return turned ? "yielded" : "microtask";
}

describe("createPrecomputingHasher", () => {
  it("answers a precomputed hash and verdict without giving the event loop away", async () => {
    const { inner, calls } = countingHasher();
    const secrets = createPrecomputingHasher(inner);
    await secrets.precompute({ hash: ["new-pass"], verify: [["old-pass", "hashed:old-pass:0"]] });

    let hash = "";
    let valid = false;
    const taken = await turnsTaken(async () => {
      valid = await secrets.hasher.verify("old-pass", "hashed:old-pass:0");
      hash = await secrets.hasher.hash("new-pass");
    });

    expect(taken).toBe("microtask");
    expect(hash).toBe("hashed:new-pass:1");
    expect(valid).toBe(true);
    expect(calls).toEqual({ hash: 1, verify: 1 });
  });

  it("hands each precomputed hash out once, then hashes for real again", async () => {
    const { inner, calls } = countingHasher();
    const secrets = createPrecomputingHasher(inner);
    await secrets.precompute({ hash: ["secret"] });

    const first = await secrets.hasher.hash("secret");
    const second = await secrets.hasher.hash("secret");

    expect(first).not.toBe(second);
    expect(calls.hash).toBe(2);
  });

  it("carries a wrong password's verdict as wrong", async () => {
    const { inner } = countingHasher();
    const secrets = createPrecomputingHasher(inner);
    await secrets.precompute({ verify: [["guess", "hashed:real:1"]] });

    expect(await secrets.hasher.verify("guess", "hashed:real:1")).toBe(false);
  });

  it("does not answer for a different secret or a different stored hash", async () => {
    const { inner, calls } = countingHasher();
    const secrets = createPrecomputingHasher(inner);
    await secrets.precompute({ hash: ["a"], verify: [["a", "hashed:a:9"]] });

    await secrets.hasher.hash("b");
    await secrets.hasher.verify("a", "hashed:a:10");

    expect(calls).toEqual({ hash: 2, verify: 2 });
  });

  it("drops what a request did not use, and only its own", async () => {
    const { inner, calls } = countingHasher();
    const secrets = createPrecomputingHasher(inner);
    const releaseFirst = await secrets.precompute({ hash: ["same"] });
    await secrets.precompute({ hash: ["same"] });

    releaseFirst();
    const stillWaiting = await turnsTaken(() => secrets.hasher.hash("same"));
    const afterBothGone = await turnsTaken(() => secrets.hasher.hash("same"));

    expect(stillWaiting).toBe("microtask");
    expect(afterBothGone).toBe("yielded");
    expect(calls.hash).toBe(3);
  });
});
