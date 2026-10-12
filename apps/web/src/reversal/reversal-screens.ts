import { ReversalDocumentType } from "@mezan/contracts";

export interface ReversalScreen {
  readonly file: string;
  readonly marker: string;
}

const action = (file: string, type: ReversalDocumentType): ReversalScreen => {
  const member = (Object.keys(ReversalDocumentType) as (keyof typeof ReversalDocumentType)[]).find((key) => ReversalDocumentType[key] === type);
  return { file, marker: `ReversalDocumentType.${member}` };
};

export const REVERSAL_SCREENS: Readonly<Record<ReversalDocumentType, ReversalScreen | null>> = {
  [ReversalDocumentType.FxRevaluation]: action("screens/FxRevaluationScreen.tsx", ReversalDocumentType.FxRevaluation),
  [ReversalDocumentType.PayrollRun]: action("screens/PayrollRunsScreen.tsx", ReversalDocumentType.PayrollRun),
  [ReversalDocumentType.EmployeeAdvance]: action("screens/EmployeeAdvancesScreen.tsx", ReversalDocumentType.EmployeeAdvance),
  [ReversalDocumentType.Cheque]: action("screens/ChequesScreen.tsx", ReversalDocumentType.Cheque),
  [ReversalDocumentType.YearEndClose]: action("screens/YearEndCloseCard.tsx", ReversalDocumentType.YearEndClose),
  [ReversalDocumentType.AssetDisposal]: action("screens/AssetRegisterScreen.tsx", ReversalDocumentType.AssetDisposal),
  [ReversalDocumentType.HrLeaveProvision]: action("screens/HrProvisionsPanel.tsx", ReversalDocumentType.HrLeaveProvision),
  [ReversalDocumentType.StockAdjustment]: action("screens/StockAdjustmentsScreen.tsx", ReversalDocumentType.StockAdjustment),
  [ReversalDocumentType.Adjustment]: null,
  [ReversalDocumentType.WritedownRun]: action("screens/WritedownRunsScreen.tsx", ReversalDocumentType.WritedownRun),
  [ReversalDocumentType.LetterOfGuarantee]: action("screens/contracting/guarantees/GuaranteesScreen.tsx", ReversalDocumentType.LetterOfGuarantee),
  [ReversalDocumentType.EquipmentLog]: action("screens/contracting/site/EquipmentLogsScreen.tsx", ReversalDocumentType.EquipmentLog),
  [ReversalDocumentType.MaterialConsumption]: action("screens/contracting/site/MaterialConsumptionScreen.tsx", ReversalDocumentType.MaterialConsumption),
  [ReversalDocumentType.LandedCost]: { file: "screens/LandedCostsScreen.tsx", marker: "useReverseLandedCost(" },
  [ReversalDocumentType.DepreciationRun]: { file: "screens/DepreciationRunsScreen.tsx", marker: "useReverseDepreciationRun(" },
  [ReversalDocumentType.RecurringJournalTemplate]: { file: "screens/enh/recurring-journals/RecurringJournalsScreen.tsx", marker: "useReverseRecurringJournalRun(" },
};
