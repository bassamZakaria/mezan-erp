/**
 * تقرير أسباب الرفض (WF-04 step 6, "acceptance rate and outstanding
 * rejections") — every رفض (error) submission grouped by its authority error
 * code, so the accountant fixes the rule that rejects the most documents
 * first instead of reading rejections one at a time.
 */

import type { EtaSubmission } from "./submission.js";

const UNKNOWN_CODE = "UNKNOWN";

export interface EtaRejectionReasonGroup {
  /** The authority's own error code, or `"UNKNOWN"` when the rejection carried none. */
  readonly code: string;
  readonly count: number;
  readonly sampleMessage: string;
  /** Document numbers, capped, newest first. */
  readonly exampleInternalIds: readonly string[];
}

export interface EtaRejectionsReport {
  readonly totalRejected: number;
  readonly groups: readonly EtaRejectionReasonGroup[];
}

/** The submission's own bucket: its first authority code, or `UNKNOWN`. */
function primaryCode(s: EtaSubmission): string {
  return s.rejectionCodes?.find((c) => c !== null) ?? UNKNOWN_CODE;
}

export function summarizeEtaRejections(
  submissions: readonly EtaSubmission[],
  exampleLimit = 5,
): EtaRejectionsReport {
  const rejected = submissions.filter((s) => s.status === "error");
  const byCode = new Map<string, EtaSubmission[]>();
  for (const s of rejected) {
    const code = primaryCode(s);
    const bucket = byCode.get(code);
    if (bucket) bucket.push(s);
    else byCode.set(code, [s]);
  }
  const groups = [...byCode.entries()]
    .map(([code, docs]): EtaRejectionReasonGroup => {
      const sorted = [...docs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      return {
        code,
        count: sorted.length,
        sampleMessage: sorted[0]?.errors[0] ?? "",
        exampleInternalIds: sorted.slice(0, exampleLimit).map((s) => s.internalId),
      };
    })
    .sort((a, b) => b.count - a.count);
  return { totalRejected: rejected.length, groups };
}
