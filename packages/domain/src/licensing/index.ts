/** Licensing — Ed25519 offline license verification + ports. */

export type {
  Clock,
  FingerprintSource,
  MonotonicClockStore,
} from "./ports.js";

export {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToUtf8,
  utf8ToBytes,
  hexToBytes,
  bytesToHex,
  saltedFingerprintHash,
} from "./encoding.js";

export {
  checkinSignedBytes,
  signCheckinResponse,
  verifyCheckinResponse,
  type CheckinClaim,
} from "./checkin.js";

export {
  licensePublicKeyHex,
  parseLicense,
  signLicense,
  verifyLicense,
  LicenseParseError,
  type LicensePayload,
  type LicenseState,
  type LicenseVerifyResult,
  type VerifyOptions,
  type ParsedLicense,
} from "./license.js";
