import { describe, expect, it } from "vitest";
import { createQueryClient } from "./queryClient";

describe("createQueryClient", () => {
  it("disables retry for queries and mutations", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });

  it("disables refetch on window focus and sets a 30s stale time", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.staleTime).toBe(30_000);
  });

  it("returns a fresh, independent client on every call", () => {
    const a = createQueryClient();
    const b = createQueryClient();
    expect(a).not.toBe(b);
    a.setQueryData(["k"], 1);
    expect(b.getQueryData(["k"])).toBeUndefined();
  });
});
