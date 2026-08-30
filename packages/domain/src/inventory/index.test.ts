import { describe, it, expect } from "vitest";
import * as Inventory from "./index.js";

/**
 * The barrel is the public surface every other module imports through
 * (`import { StockLedgerService } from "@mezan/domain/inventory"` style). A
 * broken re-export path (wrong file, renamed symbol, typo) fails silently at
 * the type level in some configurations but is a hard runtime `undefined`
 * here — this test is the tripwire.
 */

describe("inventory barrel exports", () => {
  it("re-exports the 8 adjustment reasons and their lookup helpers", () => {
    expect(Inventory.ADJUSTMENT_REASONS).toHaveLength(8);
    expect(Inventory.ADJUSTMENT_REASON_DEFINITIONS).toHaveLength(8);
    expect(Inventory.isAdjustmentReason("DAMAGE")).toBe(true);
    expect(Inventory.getAdjustmentReasonDefinition("DAMAGE").labelAr).toBe("تلف");
  });

  it("re-exports the movement helpers", () => {
    expect(Inventory.STOCK_SOURCE_DOC_TYPES).toContain("ADJUSTMENT");
    expect(typeof Inventory.signedQty).toBe("function");
    expect(typeof Inventory.signedValue).toBe("function");
    expect(typeof Inventory.occurredAtFromDocumentDate).toBe("function");
  });

  it("re-exports the cost-layer and WAC math helpers", () => {
    expect(typeof Inventory.layerRemainingValue).toBe("function");
    expect(typeof Inventory.drawDownLayer).toBe("function");
    expect(typeof Inventory.extend).toBe("function");
    expect(typeof Inventory.unitCostOf).toBe("function");
    expect(typeof Inventory.emptyPosition).toBe("function");
    expect(typeof Inventory.replay).toBe("function");
    expect(typeof Inventory.runningBalance).toBe("function");
    expect(typeof Inventory.checkDrift).toBe("function");
  });

  it("re-exports every domain error class as a real Error constructor", () => {
    expect(new Inventory.ExpiredStockError("i", "w", null, "2026-01-01")).toBeInstanceOf(Error);
    expect(new Inventory.InvalidStockMovementError(["x"])).toBeInstanceOf(Error);
    expect(new Inventory.SameWarehouseTransferError("w")).toBeInstanceOf(Error);
  });

  it("re-exports the posted-documents read model", () => {
    expect(typeof Inventory.foldPostedAdjustments).toBe("function");
    expect(typeof Inventory.foldPostedTransfers).toBe("function");
    expect(typeof Inventory.filterPostedAdjustments).toBe("function");
    expect(typeof Inventory.filterPostedTransfers).toBe("function");
  });

  it("re-exports StockLedgerService as a constructible class", () => {
    expect(typeof Inventory.StockLedgerService).toBe("function");
    expect(Inventory.StockLedgerService.prototype.postAdjustment).toBeDefined();
    expect(Inventory.StockLedgerService.prototype.postTransfer).toBeDefined();
  });

  it("re-exports the phase-4 document types (adjustment + transfer)", () => {
    expect(Inventory.stockAdjustmentDocumentType).toBeDefined();
    expect(Inventory.stockAdjustmentDocumentType.code).toBe("STOCK_ADJUSTMENT");
    expect(Inventory.stockTransferDocumentType).toBeDefined();
    expect(typeof Inventory.adjustmentHeaderOf).toBe("function");
    expect(typeof Inventory.transferHeaderOf).toBe("function");
  });

  it("re-exports the document-hook adapters", () => {
    expect(typeof Inventory.createInventoryOpsStockHook).toBe("function");
    expect(typeof Inventory.createInventoryGlPostingHook).toBe("function");
  });

  it("re-exports the stock-balance rollup", () => {
    expect(typeof Inventory.rollupStockBalance).toBe("function");
  });

  it("re-exports the physical-count service and its read side", () => {
    expect(Inventory.PHYSICAL_COUNT_STATUSES).toHaveLength(4);
    expect(typeof Inventory.PhysicalCountService).toBe("function");
    expect(typeof Inventory.varianceOf).toBe("function");
    expect(typeof Inventory.revealsSystemQty).toBe("function");
    expect(typeof Inventory.lineVarianceOf).toBe("function");
    expect(typeof Inventory.varianceLinesOf).toBe("function");
    expect(typeof Inventory.summarizePhysicalCountVariance).toBe("function");
  });

  it("re-exports the label-printing surface (templates, barcode-fit, batch, layout)", () => {
    expect(Inventory.LABEL_TEMPLATES).toHaveLength(3);
    expect(typeof Inventory.isLabelTemplateCode).toBe("function");
    expect(typeof Inventory.getLabelTemplate).toBe("function");
    expect(typeof Inventory.checkBarcodeFit).toBe("function");
    expect(typeof Inventory.buildLabelBatch).toBe("function");
    expect(Inventory.LABEL_PAGE_SIZES).toEqual(["A4", "A5"]);
    expect(typeof Inventory.createLabelLayout).toBe("function");
    expect(typeof Inventory.updateLabelLayout).toBe("function");
    expect(typeof Inventory.deleteLabelLayout).toBe("function");
    expect(typeof Inventory.labelsPerPage).toBe("function");
  });

  it("re-exports the aging + write-down run pipeline", () => {
    expect(Inventory.DEFAULT_AGING_WRITEDOWN_POLICY.length).toBeGreaterThan(0);
    expect(typeof Inventory.tenantAgingPolicy).toBe("function");
    expect(typeof Inventory.periodEndDate).toBe("function");
    expect(typeof Inventory.agingDaysBetween).toBe("function");
    expect(typeof Inventory.writedownRateForAgingDays).toBe("function");
    expect(typeof Inventory.applyRateBps).toBe("function");
    expect(typeof Inventory.createWritedownRun).toBe("function");
    expect(typeof Inventory.postWritedownRun).toBe("function");
  });

  it("re-exports the product-template CRUD + variant generator", () => {
    expect(typeof Inventory.variantKey).toBe("function");
    expect(typeof Inventory.createProductTemplateSpecificationUsage).toBe("function");
    expect(typeof Inventory.createProductTemplate).toBe("function");
    expect(typeof Inventory.addTemplateAttribute).toBe("function");
    expect(typeof Inventory.addAttributeValue).toBe("function");
    expect(typeof Inventory.deleteTemplateAttribute).toBe("function");
    expect(typeof Inventory.deleteAttributeValue).toBe("function");
    expect(typeof Inventory.generateVariants).toBe("function");
  });

  it("re-exports the reservations helpers", () => {
    expect(typeof Inventory.buildStockReservations).toBe("function");
    expect(typeof Inventory.availableQty).toBe("function");
  });
});
