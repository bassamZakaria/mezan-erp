import type { Qty } from "../money/index.js";
import type { StockSourceDocType } from "../inventory/movement.js";

export enum ExpiryStatus {
  Expired = "expired",
  NearExpiry = "near_expiry",
  Ok = "ok",
  NoExpiry = "no_expiry",
}

export enum ExpiryAlertKind {
  NearExpiry = "near_expiry",
  Expired = "expired",
}

export enum ExpiryEventCode {
  NearExpiry = "STOCK_NEAR_EXPIRY",
  Expired = "STOCK_EXPIRED",
}

export enum LotIssueKind {
  MissingBatch = "missing_batch",
  MissingExpiry = "missing_expiry",
  ExpiredOnReceipt = "expired_on_receipt",
}

export const DEFAULT_NEAR_EXPIRY_DAYS = 90;
export const MIN_NEAR_EXPIRY_DAYS = 1;
export const MAX_NEAR_EXPIRY_DAYS = 730;

export interface LotRequirement {
  readonly batch: boolean;
  readonly expiry: boolean;
  readonly labelAr?: string;
}

export type LotRequirementLookup = (itemId: string) => Promise<LotRequirement | null> | LotRequirement | null;

export interface BatchTrailEntry {
  readonly movementId: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly sourceDocType: StockSourceDocType;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly qty: Qty;
  readonly occurredAt: string;
}

export interface BatchTrailRecorder {
  record(entries: readonly BatchTrailEntry[]): Promise<void>;
}

export interface BatchTrailRepository extends BatchTrailRecorder {
  listBySourceDoc(sourceDocId: string): Promise<readonly BatchTrailEntry[]>;
  listByBatch(batchNo: string, itemId?: string): Promise<readonly BatchTrailEntry[]>;
}

export interface ExpirySettings {
  readonly nearExpiryDays: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface ExpiryAlertRecord {
  readonly layerId: string;
  readonly kind: ExpiryAlertKind;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly qty: string;
  readonly emittedAt: string;
}

export interface ExpiryStore {
  getSettings(): Promise<ExpirySettings>;
  saveSettings(settings: ExpirySettings): Promise<void>;
  hasAlert(layerId: string, kind: ExpiryAlertKind): Promise<boolean>;
  recordAlert(alert: ExpiryAlertRecord): Promise<boolean>;
  listAlerts(limit: number): Promise<readonly ExpiryAlertRecord[]>;
  getFlag(key: string): Promise<string | null>;
  setFlag(key: string, value: string): Promise<void>;
}
