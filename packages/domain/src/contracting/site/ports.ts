import type {
  CustodyItem,
  EquipmentLog,
  MaterialConsumption,
  SiteIssue,
  SiteReceipt,
} from "./site-documents.js";

export interface SiteIssueFilter {
  readonly projectId?: string;
  readonly status?: SiteIssue["status"];
  readonly warehouseId?: string;
}

export interface SiteIssueRepository {
  findById(id: string): Promise<SiteIssue | null>;
  findByDocNo(docNo: string): Promise<SiteIssue | null>;
  list(filter?: SiteIssueFilter): Promise<readonly SiteIssue[]>;
  /** Insert-only: a taken id is refused with DuplicateRecordIdError, never replaced. */
  insert(issue: SiteIssue): Promise<void>;
  save(issue: SiteIssue): Promise<void>;
}

export interface SiteReceiptFilter {
  readonly projectId?: string;
  readonly issueId?: string;
}

export interface SiteReceiptRepository {
  findById(id: string): Promise<SiteReceipt | null>;
  findByDocNo(docNo: string): Promise<SiteReceipt | null>;
  list(filter?: SiteReceiptFilter): Promise<readonly SiteReceipt[]>;
  /** Insert-only: a taken id is refused with DuplicateRecordIdError, never replaced. */
  insert(receipt: SiteReceipt): Promise<void>;
  save(receipt: SiteReceipt): Promise<void>;
}

export interface MaterialConsumptionFilter {
  readonly projectId?: string;
  readonly warehouseId?: string;
  readonly subcontractId?: string;
  readonly status?: MaterialConsumption["status"];
}

export interface MaterialConsumptionRepository {
  findById(id: string): Promise<MaterialConsumption | null>;
  findByDocNo(docNo: string): Promise<MaterialConsumption | null>;
  list(filter?: MaterialConsumptionFilter): Promise<readonly MaterialConsumption[]>;
  /** Insert-only: a taken id is refused with DuplicateRecordIdError, never replaced. */
  insert(consumption: MaterialConsumption): Promise<void>;
  save(consumption: MaterialConsumption): Promise<void>;
}

export interface CustodyFilter {
  readonly projectId?: string;
  readonly warehouseId?: string;
  /** Only rows with something still out. */
  readonly outstandingOnly?: boolean;
}

export interface CustodyRepository {
  findById(id: string): Promise<CustodyItem | null>;
  list(filter?: CustodyFilter): Promise<readonly CustodyItem[]>;
  /** Insert-only: a taken id is refused with DuplicateRecordIdError, never replaced. */
  insert(item: CustodyItem): Promise<void>;
  save(item: CustodyItem): Promise<void>;
}

export interface EquipmentLogFilter {
  readonly projectId?: string;
  readonly assetId?: string;
  readonly status?: EquipmentLog["status"];
}

export interface EquipmentLogRepository {
  findById(id: string): Promise<EquipmentLog | null>;
  findByDocNo(docNo: string): Promise<EquipmentLog | null>;
  list(filter?: EquipmentLogFilter): Promise<readonly EquipmentLog[]>;
  /** Insert-only: a taken id is refused with DuplicateRecordIdError, never replaced. */
  insert(log: EquipmentLog): Promise<void>;
  save(log: EquipmentLog): Promise<void>;
}

/**
 * جدول الكميات — slice 1 owns the BOQ; this module only needs to know that a
 * line id names something. Omit the port and a boqLineId is accepted as an
 * opaque string, which is what the module did before the BOQ route existed.
 */
export interface BoqLineExistencePort {
  exists(boqLineId: string): Promise<boolean>;
}

/**
 * عقد أعمال سارٍ على المشروع. A project running under a live works contract is
 * measured against its جدول الكميات, so consumption on it MUST name the line it
 * was spent on; a project with no live contract has no bill to name.
 */
export interface ActiveWorksContractPort {
  hasActiveContract(projectId: string): Promise<boolean>;
}
