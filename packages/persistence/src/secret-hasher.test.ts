import { describe, it, expect } from "vitest";
import { createScryptHasher } from "./secret-hasher.js";

describe("createScryptHasher", () => {
  it("verifies a correctly hashed secret", async () => {
    const hasher = createScryptHasher();
    const hash = await hasher.hash("TempPass123");
    expect(await hasher.verify("TempPass123", hash)).toBe(true);
  });

  it("rejects the wrong secret", async () => {
    const hasher = createScryptHasher();
    const hash = await hasher.hash("TempPass123");
    expect(await hasher.verify("WrongPass", hash)).toBe(false);
  });

  it("salts each hash differently, even for the same secret", async () => {
    const hasher = createScryptHasher();
    const a = await hasher.hash("1234");
    const b = await hasher.hash("1234");
    expect(a).not.toBe(b);
    expect(await hasher.verify("1234", a)).toBe(true);
    expect(await hasher.verify("1234", b)).toBe(true);
  });

  it("rejects a malformed hash instead of throwing", async () => {
    const hasher = createScryptHasher();
    expect(await hasher.verify("1234", "not-a-real-hash")).toBe(false);
  });
});
