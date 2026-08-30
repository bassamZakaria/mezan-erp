// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitListNav,
  isHelpKey,
  isTopListNavSubscriber,
  latinLetter,
  LIST_NAV_EVENT,
  popListNavSubscriber,
  pushListNavSubscriber,
} from "./keys";

function keyEvent(init: Partial<KeyboardEvent> & { key: string; code?: string }): KeyboardEvent {
  return { key: init.key, code: init.code ?? "" } as KeyboardEvent;
}

describe("latinLetter", () => {
  it("returns the lowercase letter for a plain a-z key", () => {
    expect(latinLetter(keyEvent({ key: "k" }))).toBe("k");
    expect(latinLetter(keyEvent({ key: "K" }))).toBe("k");
  });

  it("falls back to the physical code on a non-Latin layout, e.g. Arabic ن for K", () => {
    expect(latinLetter(keyEvent({ key: "ن", code: "KeyK" }))).toBe("k");
  });

  it("returns null for a key that is neither a Latin letter nor a KeyX code", () => {
    expect(latinLetter(keyEvent({ key: "1", code: "Digit1" }))).toBeNull();
    expect(latinLetter(keyEvent({ key: "Enter", code: "Enter" }))).toBeNull();
  });
});

describe("isHelpKey", () => {
  it("is true for a plain '?'", () => {
    expect(isHelpKey(keyEvent({ key: "?" }))).toBe(true);
  });

  it("is true for the Arabic question mark Shift+Q emits on the Arabic layout", () => {
    expect(isHelpKey(keyEvent({ key: "؟" }))).toBe(true);
  });

  it("is false for any other key", () => {
    expect(isHelpKey(keyEvent({ key: "k" }))).toBe(false);
  });
});

describe("emitListNav", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches a CustomEvent on window carrying the action in its detail", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    emitListNav("next");
    expect(spy).toHaveBeenCalledOnce();
    const event = spy.mock.calls[0]?.[0] as CustomEvent<{ action: string }>;
    expect(event.type).toBe(LIST_NAV_EVENT);
    expect(event.detail).toEqual({ action: "next" });
  });
});

describe("list-nav subscriber stack", () => {
  it("the most recently pushed subscriber is top", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    pushListNavSubscriber(a);
    pushListNavSubscriber(b);
    expect(isTopListNavSubscriber(b)).toBe(true);
    expect(isTopListNavSubscriber(a)).toBe(false);
    popListNavSubscriber(a);
    popListNavSubscriber(b);
  });

  it("popping the top subscriber restores the one beneath it", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    pushListNavSubscriber(a);
    pushListNavSubscriber(b);
    popListNavSubscriber(b);
    expect(isTopListNavSubscriber(a)).toBe(true);
    popListNavSubscriber(a);
  });

  it("popping an id that is not present is a no-op", () => {
    const a = Symbol("a");
    const ghost = Symbol("ghost");
    pushListNavSubscriber(a);
    popListNavSubscriber(ghost);
    expect(isTopListNavSubscriber(a)).toBe(true);
    popListNavSubscriber(a);
  });

  it("an empty stack has no top subscriber", () => {
    const a = Symbol("a");
    expect(isTopListNavSubscriber(a)).toBe(false);
  });
});
