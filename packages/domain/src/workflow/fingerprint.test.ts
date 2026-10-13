import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { documentFingerprint, sha256Hex } from "./fingerprint.js";

describe("sha256Hex", () => {
  it("matches the published vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });

  it("hashes Arabic text by its UTF-8 bytes", () => {
    expect(sha256Hex("ميزان")).toBe(sha256Hex("ميزان"));
    expect(sha256Hex("ميزان")).not.toBe(sha256Hex("ميزا"));
  });
});

describe("documentFingerprint", () => {
  const invoice = { id: "INV-1", status: "draft", workflowRequestId: null, docNo: null, branchId: "BR-MAIN", lines: [{ qty: "1", unitPrice: Money.fromMajor("100") }] };

  it("is unmoved by the document's own lifecycle and by key order", () => {
    const held = { lines: invoice.lines, branchId: "BR-MAIN", docNo: "INV-000001", workflowRequestId: "INV-1:confirm", status: "pending", id: "INV-1", version: 4 };
    expect(documentFingerprint(held)).toBe(documentFingerprint(invoice));
  });

  it("moves when an amount, a line or the branch changes", () => {
    const base = documentFingerprint(invoice);
    expect(documentFingerprint({ ...invoice, lines: [{ qty: "1", unitPrice: Money.fromMajor("100.01") }] })).not.toBe(base);
    expect(documentFingerprint({ ...invoice, lines: [...invoice.lines, { qty: "1", unitPrice: Money.fromMajor("1") }] })).not.toBe(base);
    expect(documentFingerprint({ ...invoice, branchId: "BR-ALEX" })).not.toBe(base);
  });

  it("is unmoved by what the service stamps on a held document's lines after submission", () => {
    const voucher = { id: "V-1", lines: [{ amount: Money.fromMajor("300"), treasuryAccountId: "TR-1" }] };
    const carrying = { id: "V-1", lines: [{ amount: Money.fromMajor("300"), treasuryAccountId: "TR-1", heldAllocations: [{ invoiceId: "INV-1" }], fxRate: "13.5" }] };
    expect(documentFingerprint(carrying)).toBe(documentFingerprint(voucher));
    expect(documentFingerprint({ ...carrying, lines: [{ ...carrying.lines[0]!, treasuryAccountId: "TR-2" }] })).not.toBe(documentFingerprint(voucher));
  });
});
