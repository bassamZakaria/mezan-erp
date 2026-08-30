// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPersistedLocale, persistLocale } from "./storage";

const KEY = "mezan.locale";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("loadPersistedLocale", () => {
  it("returns null when nothing has been persisted", () => {
    expect(loadPersistedLocale()).toBeNull();
  });

  it("returns the persisted locale", () => {
    window.localStorage.setItem(KEY, "en");
    expect(loadPersistedLocale()).toBe("en");
  });

  it("returns null for a stored value that is not a known locale", () => {
    window.localStorage.setItem(KEY, "fr");
    expect(loadPersistedLocale()).toBeNull();
  });

  it("returns null rather than throwing when localStorage access throws (privacy mode)", () => {
    vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPersistedLocale()).toBeNull();
  });
});

describe("persistLocale", () => {
  it("writes the locale under the mezan.locale key", () => {
    persistLocale("en");
    expect(window.localStorage.getItem(KEY)).toBe("en");
  });

  it("does not throw when localStorage.setItem throws (privacy mode / quota)", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => persistLocale("ar")).not.toThrow();
  });
});
