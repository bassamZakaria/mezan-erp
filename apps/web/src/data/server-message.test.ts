// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, ENGLISH_LOCALE } from "@mezan/ui";
import { pickLocalized, serverMessage, serverReasons } from "./server-message";
import { readError } from "./hooks";

const BOTH = { message: "الفترة مقفلة", messageEn: "The period is closed." };

function answering(body: unknown) {
  return { status: 409, json: async <T,>() => body as T };
}

describe("serverMessage", () => {
  afterEach(() => document.documentElement.setAttribute("lang", DEFAULT_LOCALE));

  it("shows the Arabic text in the Arabic interface", () => {
    document.documentElement.setAttribute("lang", DEFAULT_LOCALE);
    expect(serverMessage(BOTH)).toBe("الفترة مقفلة");
  });

  it("shows the English text in the English interface", () => {
    document.documentElement.setAttribute("lang", ENGLISH_LOCALE);
    expect(serverMessage(BOTH)).toBe("The period is closed.");
  });

  it("falls back to whichever text the server sent", () => {
    document.documentElement.setAttribute("lang", ENGLISH_LOCALE);
    expect(serverMessage({ message: "الفترة مقفلة" })).toBe("الفترة مقفلة");
    document.documentElement.setAttribute("lang", DEFAULT_LOCALE);
    expect(serverMessage({ messageEn: "The period is closed." })).toBe("The period is closed.");
    expect(serverMessage({ message: "" })).toBeUndefined();
    expect(serverMessage({ message: "  ", messageEn: " " })).toBeUndefined();
  });

  it("is what readError shows, so every screen follows the interface language", async () => {
    document.documentElement.setAttribute("lang", ENGLISH_LOCALE);
    expect(await readError(answering(BOTH), "fallback")).toBe("The period is closed.");
    document.documentElement.setAttribute("lang", DEFAULT_LOCALE);
    expect(await readError(answering(BOTH), "fallback")).toBe("الفترة مقفلة");
  });
});

describe("serverReasons", () => {
  const body = { reasons: ["سبب أ", "سبب ب"], message: "رسالة", messageEn: "Reason A; Reason B" };

  it("joins the Arabic reasons on an Arabic page", () => {
    document.documentElement.lang = DEFAULT_LOCALE;
    expect(serverReasons(body, " — ")).toBe("سبب أ — سبب ب");
  });

  it("reads the English twin on an English page", () => {
    document.documentElement.lang = ENGLISH_LOCALE;
    expect(serverReasons(body, " — ")).toBe("Reason A; Reason B");
    expect(serverReasons({ ...body, reasonsEn: ["Reason A", "Reason B"] }, " — ")).toBe("Reason A — Reason B");
    document.documentElement.lang = DEFAULT_LOCALE;
  });
});

describe("pickLocalized with an explicit locale", () => {
  afterEach(() => document.documentElement.setAttribute("lang", DEFAULT_LOCALE));

  it("lets the locale decide over a stale document language", () => {
    document.documentElement.setAttribute("lang", DEFAULT_LOCALE);
    expect(pickLocalized(BOTH.message, BOTH.messageEn, ENGLISH_LOCALE)).toBe(BOTH.messageEn);
    document.documentElement.setAttribute("lang", ENGLISH_LOCALE);
    expect(pickLocalized(BOTH.message, BOTH.messageEn, DEFAULT_LOCALE)).toBe(BOTH.message);
  });

  it("still falls back to whichever text exists", () => {
    expect(pickLocalized(BOTH.message, undefined, ENGLISH_LOCALE)).toBe(BOTH.message);
  });
});
