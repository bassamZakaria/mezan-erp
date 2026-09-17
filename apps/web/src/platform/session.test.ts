// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadPersistedPlatformSession, persistPlatformSession, type PlatformSession } from "./session";

const STORAGE_KEY = "mezan.platform.session";

const validSession: PlatformSession = {
  token: "TOKEN-1",
  user: { id: "PU-1", email: "owner@mezan.example", role: "owner" },
};

beforeEach(() => {
  localStorage.clear();
});

describe("loadPersistedPlatformSession", () => {
  it("returns null when nothing is stored", () => {
    expect(loadPersistedPlatformSession()).toBeNull();
  });

  it("returns the parsed session when it matches the schema", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validSession));
    expect(loadPersistedPlatformSession()).toEqual(validSession);
  });

  it("returns null for corrupt (non-JSON) storage", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadPersistedPlatformSession()).toBeNull();
  });

  it("returns null when the stored value doesn't match the session schema", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "T" }));
    expect(loadPersistedPlatformSession()).toBeNull();
  });
});

describe("persistPlatformSession", () => {
  it("stores the session under mezan.platform.session", () => {
    persistPlatformSession(validSession);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(validSession);
  });

  it("clears the stored session when given null", () => {
    persistPlatformSession(validSession);
    persistPlatformSession(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
