import { afterEach, describe, expect, it, vi } from "vitest";
import { publishLoaderApi } from "../data/api-bridge";
import type { LoaderFunctionArgs } from "react-router";
import { listLoader } from "./loader";
import type { ListQuery } from "../data/list-queries";

/**
 * `loaderApi()`/`isSignedIn()` read a module-level singleton that
 * `ApiProvider` publishes during render — outside a component, the seam for
 * tests is `publishLoaderApi` itself, so these drive it directly rather than
 * mounting a whole provider tree.
 */
function args(url = "http://localhost/customers?status=active"): LoaderFunctionArgs {
  return { request: new Request(url), params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

afterEach(() => {
  publishLoaderApi({ request: async () => { throw new Error("unset"); }, queryClient: {} as never, isAuthenticated: false });
});

describe("listLoader", () => {
  it("returns null and never touches the query client while signed out", async () => {
    const ensureQueryData = vi.fn();
    publishLoaderApi({
      request: async () => { throw new Error("must not be called"); },
      queryClient: { ensureQueryData } as never,
      isAuthenticated: false,
    });
    const build = vi.fn(() => [{ queryKey: ["x"], queryFn: async () => "y" }]);
    const loader = listLoader(build);
    const result = await loader(args());
    expect(result).toBeNull();
    expect(build).not.toHaveBeenCalled();
    expect(ensureQueryData).not.toHaveBeenCalled();
  });

  it("builds queries from the request URL and warms each one via ensureQueryData while signed in", async () => {
    const ensureQueryData = vi.fn(async (_query?: unknown) => undefined);
    const fakeRequest = vi.fn(async (_path: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => [], text: async () => "" }));
    publishLoaderApi({ request: fakeRequest as never, queryClient: { ensureQueryData } as never, isAuthenticated: true });

    let seenUrl: URL | undefined;
    const build = vi.fn((url: URL): ListQuery<unknown>[] => {
      seenUrl = url;
      return [{ queryKey: ["customers", { status: "active" }], queryFn: async (req) => req("/customers") }];
    });
    const loader = listLoader(build);
    const result = await loader(args("http://localhost/customers?status=active"));

    expect(result).toBeNull();
    expect(build).toHaveBeenCalledTimes(1);
    expect(seenUrl).toBeInstanceOf(URL);
    expect(String(seenUrl)).toBe("http://localhost/customers?status=active");
    expect(ensureQueryData).toHaveBeenCalledTimes(1);
    expect(ensureQueryData.mock.calls[0]![0]).toMatchObject({ queryKey: ["customers", { status: "active" }] });
  });

  it("warms every query build() returns, one ensureQueryData call each", async () => {
    const ensureQueryData = vi.fn(async (_query?: unknown) => undefined);
    publishLoaderApi({ request: async () => ({}) as never, queryClient: { ensureQueryData } as never, isAuthenticated: true });
    const build = () => [
      { queryKey: ["a"], queryFn: async () => "a" },
      { queryKey: ["b"], queryFn: async () => "b" },
    ];
    await listLoader(build)(args());
    expect(ensureQueryData).toHaveBeenCalledTimes(2);
  });

  it("resolves without waiting for the data, so navigation is never held on a slow request", async () => {
    const ensureQueryData = vi.fn(() => new Promise(() => {}));
    publishLoaderApi({ request: async () => ({}) as never, queryClient: { ensureQueryData } as never, isAuthenticated: true });
    const build = () => [{ queryKey: ["x"], queryFn: async () => "x" }];
    await expect(listLoader(build)(args())).resolves.toBeNull();
    expect(ensureQueryData).toHaveBeenCalledTimes(1);
  });

  it("a failed prefetch never rejects the loader — it must not replace the screen with an error boundary", async () => {
    const ensureQueryData = vi.fn(async () => {
      throw new Error("network down");
    });
    publishLoaderApi({ request: async () => ({}) as never, queryClient: { ensureQueryData } as never, isAuthenticated: true });
    const build = () => [{ queryKey: ["x"], queryFn: async () => "x" }];
    await expect(listLoader(build)(args())).resolves.toBeNull();
  });
});
