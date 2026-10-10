import { useMemo } from "react";
import type { ReportRunnerParamField } from "@mezan/ui";
import { UNATTRIBUTED_BRANCH_ID, type ReportParamField } from "@mezan/domain";
import { useScopeSelector } from "../../data/hub-hooks";
import { useAppTranslation } from "../../i18n";

/**
 * Turns a report's declared «الفرع» parameter into a picker over the branch
 * register. The options are the branches this SESSION may see, so the picker
 * can only narrow what the server already scopes; the value sent is the real
 * branch id, never typed text.
 */
export function useBranchParamFields(paramFields: readonly ReportParamField[]): readonly ReportRunnerParamField[] {
  const { t } = useAppTranslation();
  const { branchOptions, isBranchScoped } = useScopeSelector();
  return useMemo(
    () =>
      paramFields.map((field): ReportRunnerParamField => {
        if (field.kind !== "branch") return field;
        return {
          kind: "select",
          key: field.key,
          label: t("reports.branchFilter"),
          options: [
            { value: "", label: isBranchScoped ? t("reports.allMyBranches") : t("reports.allBranches") },
            ...branchOptions.map((branch) => ({ value: branch.id, label: branch.label })),
            ...(field.allowUnattributed ? [{ value: UNATTRIBUTED_BRANCH_ID, label: t("reports.unattributedBranch") }] : []),
          ],
        };
      }),
    [paramFields, branchOptions, isBranchScoped, t],
  );
}
