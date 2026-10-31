// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { serverMessage } from "./server-message";
import { readError } from "./hooks";

const BOTH = { message: "الفترة مقفلة", messageEn: "The period is closed." };

function answering(body: unknown) {
  return { status: 409, json: async <T,>() => body as T };
}

describe("serverMessage", () => {
  afterEach(() => document.documentElement.setAttribute("lang", "ar"));

  it("shows the Arabic text in the Arabic interface", () => {
    document.documentElement.setAttribute("lang", "ar");
    expect(serverMessage(BOTH)).toBe("الفترة مقفلة");
  });

  it("shows the English text in the English interface", () => {
    document.documentElement.setAttribute("lang", "en");
    expect(serverMessage(BOTH)).toBe("The period is closed.");
  });

  it("falls back to whichever text the server sent", () => {
    document.documentElement.setAttribute("lang", "en");
    expect(serverMessage({ message: "الفترة مقفلة" })).toBe("الفترة مقفلة");
    document.documentElement.setAttribute("lang", "ar");
    expect(serverMessage({ messageEn: "The period is closed." })).toBe("The period is closed.");
    expect(serverMessage({ message: "" })).toBeUndefined();
  });

  it("is what readError shows, so every screen follows the interface language", async () => {
    document.documentElement.setAttribute("lang", "en");
    expect(await readError(answering(BOTH), "fallback")).toBe("The period is closed.");
    document.documentElement.setAttribute("lang", "ar");
    expect(await readError(answering(BOTH), "fallback")).toBe("الفترة مقفلة");
  });
});
