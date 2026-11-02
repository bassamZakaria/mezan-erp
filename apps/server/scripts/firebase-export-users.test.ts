import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs script with no declarations
import { importRecord } from "./firebase-export-users.mjs";

const SALT = "ab".repeat(16);
const HASH = "cd".repeat(64);
const row = (overrides: Record<string, unknown>) => ({ email: " Owner@Shop.eg ", name_ar: "المالك", name_en: null, password_hash: `scrypt$${SALT}$${HASH}`, must_change_password: "0", ...overrides });

describe("the Firebase export of a Mezan user", () => {
  it("carries the password over when Postgres hands the flag back as the string 0", () => {
    const record = importRecord(row({}));
    expect(record).toMatchObject({ email: "owner@shop.eg", emailVerified: true, displayName: "المالك" });
    expect(Buffer.from(record.passwordHash, "base64").toString("hex")).toBe(HASH);
    expect(Buffer.from(record.salt, "base64").toString("hex")).toBe(SALT);
  });

  it("leaves a temporary password behind", () => {
    expect(importRecord(row({ must_change_password: "1" }))).not.toHaveProperty("passwordHash");
    expect(importRecord(row({ must_change_password: 1 }))).not.toHaveProperty("passwordHash");
  });
});
