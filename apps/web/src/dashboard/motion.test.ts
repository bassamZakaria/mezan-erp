// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { riseStyle, useReducedMotion } from "./motion";

function mockMatchMedia(matches: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => {
      const i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    },
  };
  window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
  return {
    fire: (next: boolean) => {
      mql.matches = next;
      listeners.forEach((cb) => cb({ matches: next }));
    },
  };
}

describe("useReducedMotion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the initial prefers-reduced-motion value", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("defaults to false when matchMedia says reduced motion is not preferred", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("updates live when the media query changes", () => {
    const { fire } = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => fire(true));
    expect(result.current).toBe(true);
  });

  it("falls back to false when matchMedia is unavailable", () => {
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing matchMedia to exercise the guard
    delete window.matchMedia;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    window.matchMedia = original;
  });
});

describe("riseStyle", () => {
  it("returns an empty style object when motion is reduced", () => {
    expect(riseStyle(2, true)).toEqual({});
  });

  it("staggers the animation delay by 40ms per step when motion is allowed", () => {
    const style0 = riseStyle(0, false);
    const style3 = riseStyle(3, false);
    expect(style0.animation).toContain("0ms");
    expect(style3.animation).toContain("120ms");
    expect(style3.animation).toContain("mz-fade-in");
  });
});
