import { describe, expect, it } from "vitest";
import { ApprovalRequestUntrustedError, InvalidVoucherError } from "@mezan/domain";
import { domainRefusalOf } from "./domain-refusal.js";

function driverError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("domainRefusalOf", () => {
  it("passes a domain refusal's code and both messages through", () => {
    const err = new ApprovalRequestUntrustedError("req-1");
    expect(domainRefusalOf(err)).toEqual({ code: "APPROVAL_REQUEST_UNTRUSTED", message: err.message, messageEn: err.messageEn });
  });

  it("passes a domain refusal that has no English message", () => {
    const err = new InvalidVoucherError("v-1", "سند غير صالح");
    expect(domainRefusalOf(err)).toEqual({ code: err.code, message: err.message });
  });

  it.each([
    ["a Postgres SQLSTATE", driverError('duplicate key value violates unique constraint "voucher_pkey"', "23505")],
    ["a Postgres SQLSTATE with a letter", driverError('relation "t_abc.voucher" does not exist', "42P01")],
    ["a better-sqlite3 code", driverError("UNIQUE constraint failed: voucher.id", "SQLITE_CONSTRAINT_PRIMARYKEY")],
    ["a Node code", driverError("bad arg", "ERR_INVALID_ARG_TYPE")],
    ["an error with no code", new Error("SELECT * FROM voucher")],
    ["a thrown string", "boom"],
  ])("withholds %s", (_label, err) => {
    expect(domainRefusalOf(err)).toBeNull();
  });
});
