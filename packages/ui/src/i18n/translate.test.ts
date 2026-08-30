import { describe, expect, it, vi } from "vitest";
import { humanizeKey, interpolate, mergeCatalogs, translate, type LocaleCatalogs } from "./translate";

describe("interpolate", () => {
  it("replaces every {name} placeholder with the matching param", () => {
    expect(interpolate("مرحباً {name}، لديك {count} رسالة", { name: "سارة", count: 3 })).toBe(
      "مرحباً سارة، لديك 3 رسالة",
    );
  });

  it("returns the template unchanged when no params are given", () => {
    expect(interpolate("plain text {x}")).toBe("plain text {x}");
  });

  it("leaves an unmatched placeholder verbatim rather than blanking it", () => {
    expect(interpolate("{known} and {missing}", { known: "a" })).toBe("a and {missing}");
  });

  it("stringifies a numeric param", () => {
    expect(interpolate("{n}", { n: 42 })).toBe("42");
  });
});

describe("humanizeKey", () => {
  it("takes the last dot-segment and turns camelCase into words", () => {
    expect(humanizeKey("customers.openingBalance")).toBe("Opening Balance");
  });

  it("turns dashes and underscores into spaces", () => {
    expect(humanizeKey("some-key_name")).toBe("Some key name");
  });

  it("capitalizes a single-word key", () => {
    expect(humanizeKey("empty")).toBe("Empty");
  });

  it("handles a key with no dots at all", () => {
    expect(humanizeKey("plainKey")).toBe("Plain Key");
  });
});

describe("mergeCatalogs", () => {
  it("merges the ar and en dictionaries of multiple catalogs, later catalogs winning on conflict", () => {
    const a: LocaleCatalogs = { ar: { x: "أ" }, en: { x: "a" } };
    const b: LocaleCatalogs = { ar: { x: "ب", y: "ص" }, en: { x: "b", y: "y" } };
    const merged = mergeCatalogs(a, b);
    expect(merged.ar).toEqual({ x: "ب", y: "ص" });
    expect(merged.en).toEqual({ x: "b", y: "y" });
  });

  it("merges zero catalogs into an empty dictionary", () => {
    expect(mergeCatalogs()).toEqual({ ar: {}, en: {} });
  });
});

const catalogs: LocaleCatalogs = {
  ar: { "greeting.hello": "أهلاً {name}", "only.ar": "فقط عربي" },
  en: { "greeting.hello": "Hello {name}" },
};

describe("translate", () => {
  it("resolves the key directly in the active locale, interpolated", () => {
    expect(translate(catalogs, "en", "greeting.hello", { name: "Sam" })).toBe("Hello Sam");
  });

  it("falls back to Arabic (the source language) when the active locale lacks the key", () => {
    expect(translate(catalogs, "en", "only.ar")).toBe("فقط عربي");
  });

  it("falls back to a humanized key when neither locale has it", () => {
    expect(translate(catalogs, "en", "totally.unknownKey")).toBe("Unknown Key");
  });

  it("calls the missing-key reporter with the key and the locale that lacked it, only when it actually falls back", () => {
    const onMissing = vi.fn();
    translate(catalogs, "en", "only.ar", undefined, onMissing);
    expect(onMissing).toHaveBeenCalledWith("only.ar", "en");

    onMissing.mockClear();
    translate(catalogs, "en", "greeting.hello", { name: "Sam" }, onMissing);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("interpolates params into the Arabic fallback string too", () => {
    const withParam: LocaleCatalogs = { ar: { "x.y": "قيمة {v}" }, en: {} };
    expect(translate(withParam, "en", "x.y", { v: "١" })).toBe("قيمة ١");
  });
});
