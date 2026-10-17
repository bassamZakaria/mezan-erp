export enum OpportunityLostReason {
  Price = "PRICE",
  Competitor = "COMPETITOR",
  Budget = "BUDGET",
  Timing = "TIMING",
  NoResponse = "NO_RESPONSE",
  RequirementsNotMet = "REQUIREMENTS_NOT_MET",
  CustomerDecidedNotToBuy = "CUSTOMER_DECIDED_NOT_TO_BUY",
  Other = "OTHER",
}

export interface OpportunityLostReasonDefinition {
  readonly code: OpportunityLostReason;
  readonly labelAr: string;
  readonly labelEn: string;
}

export const OPPORTUNITY_LOST_REASON_DEFINITIONS: readonly OpportunityLostReasonDefinition[] = [
  { code: OpportunityLostReason.Price, labelAr: "السعر مرتفع", labelEn: "Price too high" },
  { code: OpportunityLostReason.Competitor, labelAr: "اختار منافساً", labelEn: "Chose a competitor" },
  { code: OpportunityLostReason.Budget, labelAr: "لا توجد ميزانية", labelEn: "No budget" },
  { code: OpportunityLostReason.Timing, labelAr: "التوقيت غير مناسب", labelEn: "Bad timing" },
  { code: OpportunityLostReason.NoResponse, labelAr: "لا يوجد رد من العميل", labelEn: "Customer stopped responding" },
  { code: OpportunityLostReason.RequirementsNotMet, labelAr: "لا نلبّي المتطلبات", labelEn: "Requirements not met" },
  { code: OpportunityLostReason.CustomerDecidedNotToBuy, labelAr: "ألغى العميل قرار الشراء", labelEn: "Customer decided not to buy" },
  { code: OpportunityLostReason.Other, labelAr: "أخرى", labelEn: "Other" },
];

const BY_CODE: ReadonlyMap<string, OpportunityLostReasonDefinition> = new Map(
  OPPORTUNITY_LOST_REASON_DEFINITIONS.map((d) => [d.code, d]),
);

export function isOpportunityLostReason(value: string): value is OpportunityLostReason {
  return BY_CODE.has(value);
}

export function getOpportunityLostReasonLabel(code: OpportunityLostReason): string {
  return (BY_CODE.get(code) as OpportunityLostReasonDefinition).labelAr;
}
