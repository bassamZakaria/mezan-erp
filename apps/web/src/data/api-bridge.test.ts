import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { isSignedIn, loaderApi, publishLoaderApi } from "./api-bridge";

describe("api-bridge", () => {
  it("isSignedIn is false before any ApiProvider has published", () => {
    expect(isSignedIn()).toBe(false);
  });

  it("loaderApi throws before an ApiProvider has published", () => {
    expect(() => loaderApi()).toThrow(
      "Route loader ran before <ApiProvider> published its API. Is the router mounted inside AppProviders?",
    );
  });

  it("loaderApi returns exactly what was published, and isSignedIn follows isAuthenticated", () => {
    const queryClient = new QueryClient();
    const request = async () => ({ status: 200, ok: true, json: async <T = unknown>() => ({}) as T, text: async () => "" });
    publishLoaderApi({ request, queryClient, isAuthenticated: true });

    expect(loaderApi()).toEqual({ request, queryClient, isAuthenticated: true });
    expect(isSignedIn()).toBe(true);
  });

  it("a later publish with isAuthenticated:false flips isSignedIn back off", () => {
    const queryClient = new QueryClient();
    const request = async () => ({ status: 401, ok: false, json: async <T = unknown>() => ({}) as T, text: async () => "" });
    publishLoaderApi({ request, queryClient, isAuthenticated: false });

    expect(isSignedIn()).toBe(false);
    expect(loaderApi().isAuthenticated).toBe(false);
  });
});
