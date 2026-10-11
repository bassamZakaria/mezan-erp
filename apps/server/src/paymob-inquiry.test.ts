import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProviderInquiryStatus } from "@mezan/domain";
import { PAYMOB_NOT_FOUND_SHAPES, readPaymobInquiryAnswer } from "./paymob-inquiry.js";

interface Fixture {
  readonly documentedAt: string | null;
  readonly note: string;
  readonly status: number;
  readonly body: unknown;
  readonly expect: `${ProviderInquiryStatus}`;
}

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "paymob-inquiry");
const fixtures = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(DIR, file), "utf8")) as Fixture] as const);
const request = { providerOrderRef: "690898", merchantRef: "checkout-1" };
const INTEGRATIONS = [4242];

describe("reading Paymob's answer to a transaction inquiry", () => {
  it.each(fixtures)("reads %s as its fixture says", (_name, fixture) => {
    expect(readPaymobInquiryAnswer(fixture.status, fixture.body, INTEGRATIONS, request).status).toBe(fixture.expect);
  });

  it("holds a fixture for every answer Paymob's public documentation describes, and only those are marked documented", () => {
    const documented = fixtures.filter(([, fixture]) => fixture.documentedAt !== null);
    expect(documented.length).toBeGreaterThan(0);
    for (const [, fixture] of documented) {
      expect(fixture.documentedAt).toMatch(/^https:\/\/developers\.paymob\.com\//);
      expect(fixture.status).toBe(200);
    }
  });

  it("counts as no transaction only the fixtures that match a recognised not-found shape exactly", () => {
    const none = fixtures.filter(([, fixture]) => fixture.expect === ProviderInquiryStatus.None);
    expect(none.map(([name]) => name)).toEqual(["undocumented-404-detail-not-found"]);
    for (const [, fixture] of none) {
      expect(PAYMOB_NOT_FOUND_SHAPES.some((shape) => shape.status === fixture.status && shape.matches(fixture.body))).toBe(true);
    }
  });

  it("never reads an answer it does not recognise as no transaction", () => {
    const oddBodies: unknown[] = ["Not found.", 404, true, { detail: "not found" }, { detail: "Not found" }, { detail: ["Not found."] }, { Detail: "Not found." }, { detail: "Not found.", detail2: "" }];
    for (const status of [200, 204, 301, 400, 404, 410, 422]) {
      for (const body of oddBodies) {
        expect(readPaymobInquiryAnswer(status, body, INTEGRATIONS, request).status, `${status} ${JSON.stringify(body)}`).not.toBe(ProviderInquiryStatus.None);
      }
    }
  });
});
