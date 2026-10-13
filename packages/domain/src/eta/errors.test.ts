import { describe, expect, it } from "vitest";
import {
  EtaBuyerIdentityRequiredError,
  EtaDeviceSerialNotRegisteredError,
  EtaDeviceSerialUnknownError,
  EtaOriginalReceiptNotFoundError,
  EtaReceiptNotReadyError,
  EtaRefundReferenceRequiredError,
  EtaRefundTooLateError,
} from "./errors.js";

const ENGLISH_SENTENCE = /[A-Za-z]{3,} [A-Za-z]{2,} [A-Za-z]{2,}/;
const ARABIC = /[؀-ۿ]/;

const REFUSALS: readonly (readonly [string, Error & { messageEn?: string }])[] = [
  ["a branch with no device serial", new EtaDeviceSerialNotRegisteredError("BR-MAIN")],
  ["a refund naming no sale receipt", new EtaRefundReferenceRequiredError("SRT-000001")],
  ["a refund whose sale was never receipted", new EtaOriginalReceiptNotFoundError("INV-000001")],
  ["an unregistered device serial", new EtaDeviceSerialUnknownError("POS-9")],
  ["a receipt with incomplete registration data", new EtaReceiptNotReadyError(["كود الصنف لدى المصلحة (IT-0010)"])],
  ["a large receipt to an unidentified person", new EtaBuyerIdentityRequiredError("150000")],
  ["a refund past the amendment window", new EtaRefundTooLateError("2024-01-01")],
];

describe("an e-receipt refusal reaches the user in Arabic, with its English kept apart", () => {
  it.each(REFUSALS)("%s", (_what, error) => {
    expect(error.message).toMatch(ARABIC);
    expect(error.message).not.toMatch(ENGLISH_SENTENCE);
    expect(error.messageEn).toMatch(ENGLISH_SENTENCE);
  });
});
