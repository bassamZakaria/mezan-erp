// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";

const STORAGE_KEY = "mezan:theme";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: prefersDark }) as unknown as MediaQueryList),
  );
}

describe("useTheme — what it reads back at startup", () => {
  it("starts light when nothing has ever been stored", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("restores each stored preference verbatim", () => {
    for (const stored of ["light", "dark", "system"] as const) {
      window.localStorage.setItem(STORAGE_KEY, stored);
      const { result, unmount } = renderHook(() => useTheme());
      expect(result.current.theme).toBe(stored);
      unmount();
    }
  });

  it("ignores a stored value that is not a preference", () => {
    window.localStorage.setItem(STORAGE_KEY, "midnight");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("falls back to light when the browser refuses to read storage at all", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });
});

describe("useTheme — the attribute the tokens react to", () => {
  it("stamps the explicit preference on <html> and remembers it", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("removes the attribute entirely for «system», handing the choice to the media query", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));
    act(() => result.current.setTheme("system"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("system");
  });

  it("still applies the theme for this session when the write is refused", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("useTheme — the toggle", () => {
  it("flips light to dark and back", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");
  });

  it("resolves «system» against the OS first, then moves away from what the OS already gives", () => {
    stubMatchMedia(true);
    const dark = renderHook(() => useTheme());
    act(() => dark.result.current.setTheme("system"));
    act(() => dark.result.current.toggleTheme());
    expect(dark.result.current.theme).toBe("light");
    dark.unmount();

    stubMatchMedia(false);
    const light = renderHook(() => useTheme());
    act(() => light.result.current.setTheme("system"));
    act(() => light.result.current.toggleTheme());
    expect(light.result.current.theme).toBe("dark");
  });

  it("treats a browser without matchMedia as preferring light", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("system"));
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
  });
});
