import type { BarcodeConfig } from "./barcode-config.js";

/** Port for the single tenant-wide barcode-configuration bag (one row per tenant). */
export interface BarcodeConfigRepository {
  get(): Promise<BarcodeConfig | null>;
  save(config: BarcodeConfig): Promise<void>;
}
