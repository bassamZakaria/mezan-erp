import { describe, expect, it } from "vitest";
import { REDACTED, redactText, redactValue } from "./redact.js";

describe("redacting passwords from diagnostics", () => {
  it("masks every spelling of a password key in logged text", () => {
    const out = redactText(
      '{"password":"p1","temporaryPassword":"Abc123xyz","currentPassword":"q1w2e3r4","new_password":"zz9"} adminPassword=foo',
    );
    for (const secret of ["p1", "Abc123xyz", "q1w2e3r4", "zz9", "foo"]) expect(out).not.toContain(secret);
  });

  it("masks password fields of a logged object", () => {
    expect(redactValue({ username: "a", password: "x", temporaryPassword: "y", newPassword: "z" })).toEqual({
      username: "a",
      password: REDACTED,
      temporaryPassword: REDACTED,
      newPassword: REDACTED,
    });
  });
});
