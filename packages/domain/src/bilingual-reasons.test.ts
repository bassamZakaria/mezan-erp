import { describe, expect, it } from "vitest";
import { splitReasons } from "./bilingual-reasons.js";

describe("splitReasons", () => {
  it("keeps the Arabic list and joins the English twins", () => {
    const out = splitReasons([{ ar: "السبب أ", en: "Reason A" }, { ar: "السبب ب", en: "Reason B" }], "fallback");
    expect(out.ar).toEqual(["السبب أ", "السبب ب"]);
    expect(out.en).toBe("Reason A; Reason B");
  });

  it("shows a reason that has no English twin rather than dropping it", () => {
    const out = splitReasons([{ ar: "السبب أ", en: "Reason A" }, "سبب بلا ترجمة"], "fallback");
    expect(out.en).toBe("Reason A; سبب بلا ترجمة");
  });

  it("uses the fallback only when there is no reason at all", () => {
    expect(splitReasons([], "The details are not valid.").en).toBe("The details are not valid.");
  });
});
