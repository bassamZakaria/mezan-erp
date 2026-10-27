import { describe, expect, it } from "vitest";
import { createSqliteRateWindowStore } from "./rate-window-store.js";

describe("rate window sweep", () => {
  it("drops expired windows and keeps only the newest windows over the cap", async () => {
    const store = createSqliteRateWindowStore(":memory:", "signup");
    await store.hit("expired", 0, 10);
    await store.hit("oldest", 100, 1_000);
    await store.hit("middle", 100, 2_000);
    await store.hit("newest", 100, 3_000);

    await store.sweep(50, 2);

    expect(await store.read("expired", 50)).toBeNull();
    expect(await store.read("oldest", 50)).toBeNull();
    expect(await store.read("middle", 50)).toMatchObject({ hits: 1 });
    expect(await store.read("newest", 50)).toMatchObject({ hits: 1 });
  });
});
