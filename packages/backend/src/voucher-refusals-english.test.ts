import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ARABIC = /[\u0600-\u06FF]/;
const LATIN_SENTENCE = /[A-Za-z]{3,}/;

describe("voucher refusals", () => {
  it("each states its English message at the place it is raised", () => {
    for (const file of ["voucher-document.ts", "voucher-service.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(`../../domain/src/vouchers/${file}`, import.meta.url)), "utf8");
      const calls = source.split("new InvalidDocumentError(").slice(1).map((rest) => rest.slice(0, rest.indexOf(");")));
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) {
        const strings = call.match(/"[^"\n]*"|`[^`]*`/g) ?? [];
        const english = strings.filter((text) => !ARABIC.test(text) && LATIN_SENTENCE.test(text));
        expect(english.length, `${file}: ${call.trim().slice(0, 90)}`).toBeGreaterThan(0);
      }
    }
  });
});
