import type { ReportRunnerParamField } from "@mezan/ui";
import { ReportParamKind, UNATTRIBUTED_BRANCH_ID, type ReportParamField } from "@mezan/domain";
import type { BranchLookupDTO } from "@mezan/contracts";
import { useBranchLookup } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";

export interface BranchParam {
  readonly paramFields: readonly ReportRunnerParamField[];
  readonly caveat: string | null;
}

interface BranchPickerCopy {
  readonly label: string;
  readonly every: string;
  readonly unattributed: string;
}

function branchPicker(
  field: Extract<ReportParamField, { kind: ReportParamKind.Branch }>,
  lookup: BranchLookupDTO | undefined,
  copy: BranchPickerCopy,
): ReportRunnerParamField {
  const offersUnattributed = field.allowUnattributed && (lookup?.unattributed ?? true);
  return {
    kind: "select",
    key: field.key,
    label: copy.label,
    wide: true,
    options: [
      { value: "", label: copy.every },
      ...(lookup?.branches ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
      ...(offersUnattributed ? [{ value: UNATTRIBUTED_BRANCH_ID, label: copy.unattributed }] : []),
    ],
  };
}

function runnerField(field: ReportParamField, lookup: BranchLookupDTO | undefined, copy: BranchPickerCopy): ReportRunnerParamField {
  switch (field.kind) {
    case ReportParamKind.Date:
      return { kind: "date", key: field.key, label: field.label };
    case ReportParamKind.DateRange:
      return { kind: "dateRange", fromKey: field.fromKey, toKey: field.toKey, label: field.label };
    case ReportParamKind.Select:
      return { kind: "select", key: field.key, label: field.label, options: field.options };
    case ReportParamKind.Text:
      return { kind: "text", key: field.key, label: field.label, placeholder: field.placeholder };
    case ReportParamKind.Branch:
      return branchPicker(field, lookup, copy);
  }
}

export function useBranchParam(paramFields: readonly ReportParamField[]): BranchParam {
  const { t } = useAppTranslation();
  const lookup = useBranchLookup().data;
  const copy: BranchPickerCopy = {
    label: t("reports.branchFilter"),
    every: lookup?.restricted ? t("reports.allMyBranches") : t("reports.allBranches"),
    unattributed: t("reports.unattributedBranch"),
  };
  const statementWithoutUnattributed =
    lookup?.unattributed === false &&
    paramFields.some((field) => field.kind === ReportParamKind.Branch && field.allowUnattributed);
  return {
    paramFields: paramFields.map((field) => runnerField(field, lookup, copy)),
    caveat: statementWithoutUnattributed ? t("reports.unattributedExcluded") : null,
  };
}
