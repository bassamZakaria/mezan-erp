import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const EVIDENCE_PACK_MAX_SPAN_DAYS = 3 * 366;
export const EVIDENCE_PACK_HISTORY_LIMIT = 50;

export enum EvidencePackRefusal {
  InvalidPeriod = "EVIDENCE_PERIOD_INVALID",
  PeriodTooLong = "EVIDENCE_PERIOD_TOO_LONG",
  BuildFailed = "EVIDENCE_PACK_BUILD_FAILED",
}

export enum EvidencePackEncoding {
  Base64 = "base64",
}

export const EVIDENCE_PACK_ENCODING_PARAM = "encoding";

export const evidencePackInlineSchema = z.object({
  packId: z.string(),
  fileName: z.string(),
  manifestSha256: z.string(),
  zipBase64: z.string(),
});
export type EvidencePackInlineDTO = z.infer<typeof evidencePackInlineSchema>;

export enum SequenceGapExplanationCode {
  CounterAdjusted = "counter_adjusted",
  DraftDeleted = "draft_deleted",
  Unexplained = "unexplained",
}

export enum SequenceAnomalyCode {
  Duplicate = "duplicate",
  BeyondCounter = "beyond_counter",
}

export enum SequenceCoverageCode {
  Documents = "documents",
  CounterOnly = "counter_only",
}

export const evidencePeriodSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { message: "from must not be after to", path: ["to"] });
export type EvidencePeriodDTO = z.infer<typeof evidencePeriodSchema>;

export const evidencePackRecordSchema = z.object({
  id: z.string(),
  periodFrom: isoDate,
  periodTo: isoDate,
  builtBy: z.string(),
  builtByName: z.string(),
  builtAt: z.string(),
  manifestSha256: z.string(),
  keyId: z.string(),
  fileCount: z.number().int(),
  totalBytes: z.number().int(),
  auditChainOk: z.boolean(),
});
export type EvidencePackRecordDTO = z.infer<typeof evidencePackRecordSchema>;

export const evidencePublicKeySchema = z.object({
  algorithm: z.literal("Ed25519"),
  keyId: z.string(),
  publicKeyHex: z.string(),
  publicKeyPem: z.string(),
  format: z.string(),
});
export type EvidencePublicKeyDTO = z.infer<typeof evidencePublicKeySchema>;

export const sequenceGapRangeSchema = z.object({
  firstNumber: z.string(),
  lastNumber: z.string(),
  count: z.number().int(),
  explanation: z.nativeEnum(SequenceGapExplanationCode),
  reference: z.string().nullable(),
  inWindow: z.boolean(),
});

export const sequenceSeriesSchema = z.object({
  code: z.string(),
  labelAr: z.string(),
  period: z.number().int().nullable(),
  scope: z.string().nullable(),
  series: z.string(),
  coverage: z.nativeEnum(SequenceCoverageCode),
  issued: z.number().int(),
  documentsFound: z.number().int(),
  voidedCount: z.number().int(),
  missingCount: z.number().int(),
  unexplainedCount: z.number().int(),
  gaps: z.array(sequenceGapRangeSchema),
  voided: z.array(z.object({ number: z.string(), date: z.string(), status: z.string(), source: z.string(), inWindow: z.boolean() })),
  anomalies: z.array(z.object({ kind: z.nativeEnum(SequenceAnomalyCode), number: z.string(), occurrences: z.number().int(), sources: z.array(z.string()) })),
});

export const sequenceGapReportSchema = z.object({
  window: evidencePeriodSchema,
  series: z.array(sequenceSeriesSchema),
  totals: z.object({
    sequences: z.number().int(),
    issued: z.number().int(),
    documentsFound: z.number().int(),
    voided: z.number().int(),
    missing: z.number().int(),
    unexplained: z.number().int(),
    anomalies: z.number().int(),
  }),
});
export type SequenceGapReportDTO = z.infer<typeof sequenceGapReportSchema>;
export type SequenceSeriesDTO = z.infer<typeof sequenceSeriesSchema>;
