export {
  BARCODE_SYMBOLOGIES,
  createDefaultBarcodeConfig,
  validateBarcodeConfig,
  validateBarcodeConfigBilingual,
  updateBarcodeConfig,
  parseEmbeddedBarcode,
  InvalidBarcodeConfigError,
  type BarcodeSymbology,
  type ItemBarcodeMode,
  type EmbeddedValueType,
  type EmbeddedBarcodeRule,
  type BarcodeConfig,
  type EmbeddedBarcodeMatch,
} from "./barcode-config.js";
export type { BarcodeConfigRepository } from "./ports.js";
