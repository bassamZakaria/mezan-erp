import { describe, expect, it } from "vitest";
import { escapeLike, isPrimaryKeyViolation, numberedPlaceholders, placeholders, UnsupportedSqlSyntaxError } from "./sql-db.js";

describe("numberedPlaceholders", () => {
  it("numbers every bare ? in order", () => {
    expect(numberedPlaceholders("SELECT * FROM t WHERE a = ? AND b IN (?, ?)")).toBe("SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)");
  });

  it("leaves a ? inside a string literal or a quoted identifier alone", () => {
    expect(numberedPlaceholders(`SELECT '?' AS q, "c?" FROM t WHERE a = ?`)).toBe(`SELECT '?' AS q, "c?" FROM t WHERE a = $1`);
  });

  it("handles an escaped quote inside a literal", () => {
    expect(numberedPlaceholders("SELECT 'it''s ?' WHERE a = ?")).toBe("SELECT 'it''s ?' WHERE a = $1");
  });

  it("allows comment and dollar characters inside a literal", () => {
    expect(numberedPlaceholders("SELECT '-- $1 /*' WHERE a = ?")).toBe("SELECT '-- $1 /*' WHERE a = $1");
  });

  it.each(["SELECT 1 -- don't ?", "SELECT /* ? */ ?", "SELECT $$?$$", "SELECT E'\\'?'", "SELECT $1"])("refuses SQL it cannot number reliably: %j", (sql) => {
    expect(() => numberedPlaceholders(sql)).toThrow(UnsupportedSqlSyntaxError);
  });
});

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });
});

describe("placeholders", () => {
  it("builds a comma-separated list", () => {
    expect(placeholders(3)).toBe("?, ?, ?");
  });
});

describe("isPrimaryKeyViolation", () => {
  it("recognises SQLite's and Postgres's primary-key violations only", () => {
    expect(isPrimaryKeyViolation({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })).toBe(true);
    expect(isPrimaryKeyViolation({ code: "23505", constraint: "journal_entry_pkey" })).toBe(true);
    expect(isPrimaryKeyViolation({ code: "23505", constraint: "journal_entry_entry_no_key" })).toBe(false);
    expect(isPrimaryKeyViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(false);
    expect(isPrimaryKeyViolation(undefined)).toBe(false);
  });
});
