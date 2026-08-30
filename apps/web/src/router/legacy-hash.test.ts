// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { redirectLegacyHashRoute } from "./legacy-hash";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("redirectLegacyHashRoute", () => {
  it("rewrites a legacy #/path hash at the app root to a real path, preserving the query string", () => {
    window.history.replaceState(null, "", "/?keep=1#/sales/quotes/QT-0004");
    redirectLegacyHashRoute();
    expect(window.location.pathname).toBe("/sales/quotes/QT-0004");
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("");
  });

  it("also rewrites from /index.html, the other pre-router entry point", () => {
    window.history.replaceState(null, "", "/index.html#/dashboard");
    redirectLegacyHashRoute();
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("leaves a hash NOT starting with #/ alone — an in-page anchor, not an old route", () => {
    window.history.replaceState(null, "", "/#section-2");
    redirectLegacyHashRoute();
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("#section-2");
  });

  it("leaves a hash on a real (non-root) path alone", () => {
    window.history.replaceState(null, "", "/sales/quotes#/old-fragment");
    redirectLegacyHashRoute();
    expect(window.location.pathname).toBe("/sales/quotes");
    expect(window.location.hash).toBe("#/old-fragment");
  });

  it("is a no-op when there is no hash at all", () => {
    window.history.replaceState(null, "", "/dashboard");
    expect(() => redirectLegacyHashRoute()).not.toThrow();
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("uses replaceState, not pushState — the dead hash address never sits in the history stack", () => {
    window.history.replaceState(null, "", "/");
    const before = window.history.length;
    window.history.replaceState(null, "", "/#/dashboard");
    redirectLegacyHashRoute();
    expect(window.history.length).toBe(before);
  });
});
