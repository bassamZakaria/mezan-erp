/**
 * Landed Costs (التكاليف الإضافية، docs/catalog/02) — allocates freight/
 * customs/insurance/etc across a purchase invoice's item costs by value or by
 * quantity, raising their landed unit cost via the costing engine.
 */

export {
  LANDED_COST_TYPES,
  LANDED_COST_DISTRIBUTION_METHODS,
  distributeLandedCost,
  landedCostTotalsByType,
  totalLandedCost,
  type LandedCostType,
  type LandedCostDistributionMethod,
  type LandedCostItemEntry,
  type LandedCostAllocationTarget,
  type AllocatedLandedCostLine,
} from "./distribution.js";

export {
  DOC_TYPE as LANDED_COST_DOC_TYPE,
  createLandedCostDocumentType,
  type LandedCostLine,
  type LandedCostDocument,
  type LandedCostGlAccounts,
} from "./landed-cost-document.js";

export { LandedCostService } from "./service.js";

export { EmptyLandedCostTargetsError, ZeroLandedCostWeightError } from "./errors.js";
