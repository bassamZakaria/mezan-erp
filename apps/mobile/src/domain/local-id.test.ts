import { describe, expect, it } from "vitest";
import { makeDocumentId, makeLocalId } from "./local-id";

describe("makeLocalId", () => {
  it("carries the given prefix", () => {
    expect(makeLocalId("line").startsWith("line-")).toBe(true);
  });

  it("never repeats within the same run", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeLocalId("line")));
    expect(ids.size).toBe(50);
  });
});

describe("makeDocumentId", () => {
  it("never repeats, on this device or across two that mint in the same millisecond", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => makeDocumentId()));
    expect(ids.size).toBe(2000);
    const afterTheClockAndCounter = (id: string) => id.split("-").slice(3).join("-");
    expect(new Set([...ids].map(afterTheClockAndCounter)).size).toBe(2000);
  });

  it("is safe to send as an entity id and in a URL", () => {
    expect(makeDocumentId()).toMatch(/^m-[0-9a-z]+-[0-9a-z]+-[0-9a-z]{16}$/);
  });
});
