import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GL_DIR = fileURLToPath(new URL("../../domain/src/gl/", import.meta.url));
const UPWARD = /from\s+"\.\.\/tax-rates\//;

describe("the ledger does not depend on tax classification", () => {
  it("no gl module imports from tax-rates: the ports the ledger implements are stated in gl", () => {
    const offenders = readdirSync(GL_DIR)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => UPWARD.test(readFileSync(join(GL_DIR, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
