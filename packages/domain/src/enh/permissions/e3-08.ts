import type { PermissionFragment } from "../../permissions/fragment.js";

export const fragment: PermissionFragment = {
  rows: [
    ["audit.sequence_gaps.view", "audit.logs.view"],
    ["audit.evidence_pack.view", "audit.logs.view"],
    ["audit.evidence_pack.build", "audit.evidence_pack.view,audit.sequence_gaps.view,accounting.reports.view", "s"],
  ],
};
