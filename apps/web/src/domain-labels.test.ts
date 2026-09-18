import { describe, expect, it } from "vitest";
import { SEQUENCE_DEFINITIONS } from "@mezan/domain";
import { webCatalogs } from "./i18n/catalog";

describe("sequenceLabel catalogue", () => {
  it("names every numbering sequence the domain defines, in Arabic and English", () => {
    const ar = webCatalogs.ar as Record<string, string>;
    const en = webCatalogs.en as Record<string, string>;
    const missing = SEQUENCE_DEFINITIONS.flatMap((d) => {
      const key = `sequence.${d.code}`;
      return [ar[key] ? null : `ar ${key}`, en[key] ? null : `en ${key}`].filter((m): m is string => m !== null);
    });
    expect(missing).toEqual([]);
  });
});
