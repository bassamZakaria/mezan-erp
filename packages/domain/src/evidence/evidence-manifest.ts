import { getPublicKeyAsync, signAsync, verifyAsync } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "../licensing/encoding.js";

export const EVIDENCE_PACK_FORMAT = "mezan-evidence-pack-v1";
export const EVIDENCE_SIGNATURE_ALGORITHM = "Ed25519";

export enum EvidenceFileName {
  ReadMe = "README.txt",
  TrialBalance = "trial-balance.csv",
  GeneralLedger = "general-ledger.csv",
  SubLedgerReconciliation = "subledger-reconciliation.csv",
  ReceivablesAging = "ar-aging.csv",
  PayablesAging = "ap-aging.csv",
  SequenceGaps = "sequence-gaps.csv",
  AuditExtract = "audit-extract.csv",
  AuditChainVerdict = "audit-chain-verdict.csv",
  SegregationOfDuties = "sod-report.csv",
  PeriodCloseSummaries = "period-close-summaries.csv",
  Manifest = "manifest.json",
  Signature = "manifest.sig",
}

export interface EvidenceFileEntry {
  readonly name: EvidenceFileName;
  readonly sha256: string;
  readonly bytes: number;
  readonly rows: number;
}

export interface EvidenceAuditChainVerdict {
  readonly ok: boolean;
  readonly checkedRows: number;
  readonly firstBrokenRowId: number | null;
  readonly reason: string | null;
}

export interface EvidenceManifest {
  readonly format: typeof EVIDENCE_PACK_FORMAT;
  readonly packId: string;
  readonly companyName: string;
  readonly period: { readonly from: string; readonly to: string };
  readonly generatedAt: string;
  readonly generatedBy: { readonly userId: string; readonly name: string };
  readonly signing: { readonly algorithm: typeof EVIDENCE_SIGNATURE_ALGORITHM; readonly keyId: string; readonly publicKeyHex: string };
  readonly auditChain: EvidenceAuditChainVerdict;
  readonly files: readonly EvidenceFileEntry[];
  readonly notice: string;
}

export const EVIDENCE_SIGNATURE_NOTICE =
  "This signature proves the files are unchanged since this Mezan installation produced them. It is not a qualified electronic signature under Egyptian Law 15/2004 and does not by itself identify a natural person. / يثبت هذا التوقيع أن الملفات لم تتغير منذ أنتجها هذا التثبيت من ميزان، وليس توقيعًا إلكترونيًا معتمدًا وفق القانون 15 لسنة 2004.";

const SEED_HEX = /^[0-9a-f]{64}$/;

export class EvidenceKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceKeyError";
  }
}

function seedBytes(seedHex: string): Uint8Array {
  if (!SEED_HEX.test(seedHex)) throw new EvidenceKeyError("the evidence signing seed must be 64 lowercase hex characters");
  return hexToBytes(seedHex);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
}

export async function evidenceKeyId(publicKeyHex: string): Promise<string> {
  return (await sha256Hex(utf8ToBytes(publicKeyHex))).slice(0, 16);
}

export interface EvidenceSigningIdentity {
  readonly publicKeyHex: string;
  readonly keyId: string;
}

export async function evidenceSigningIdentity(seedHex: string): Promise<EvidenceSigningIdentity> {
  const publicKeyHex = bytesToHex(await getPublicKeyAsync(seedBytes(seedHex)));
  return { publicKeyHex, keyId: await evidenceKeyId(publicKeyHex) };
}

export function serializeEvidenceManifest(manifest: EvidenceManifest): Uint8Array {
  return utf8ToBytes(`${JSON.stringify(manifest, null, 2)}\n`);
}

/** Signs the exact manifest bytes; the signature file carries the base64 of the 64-byte Ed25519 signature. */
export async function signEvidenceManifest(manifestBytes: Uint8Array, seedHex: string): Promise<string> {
  const signature = await signAsync(manifestBytes, seedBytes(seedHex));
  let binary = "";
  for (const b of signature) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function verifyEvidenceManifest(manifestBytes: Uint8Array, signatureBase64: string, publicKeyHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  try {
    const binary = atob(signatureBase64.trim());
    const signature = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) signature[i] = binary.charCodeAt(i);
    return await verifyAsync(signature, manifestBytes, hexToBytes(publicKeyHex.toLowerCase()));
  } catch {
    return false;
  }
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** RFC 4180 cell. A text cell a spreadsheet would run as a formula is prefixed with an apostrophe; a number is left as it is. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const safe = typeof value === "string" && !NUMERIC.test(text) && FORMULA_LEAD.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvLine(cells: readonly (string | number | boolean | null | undefined)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

export const CSV_BOM = "﻿";
