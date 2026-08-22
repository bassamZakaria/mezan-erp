/** Licensing — Ed25519 offline license verification + ports. */

export type {
  Clock,
  FingerprintSource,
  MonotonicClockStore,
} from "./ports.js";

export {
  base64UrlToBytes,
  bytesToUtf8,
  utf8ToBytes,
  hexToBytes,
  bytesToHex,
  saltedFingerprintHash,
} from "./encoding.js";

export {
  parseLicense,
  verifyLicense,
  LicenseParseError,
  type LicensePayload,
  type LicenseState,
  type LicenseVerifyResult,
  type VerifyOptions,
  type ParsedLicense,
} from "./license.js";
