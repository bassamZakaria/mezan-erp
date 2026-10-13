import { Money, Qty, allocate } from "../../money/index.js";
import { routedAccountId, type AccountRoutingRepository } from "../../accounts/account-routing.js";
import { postJournalEntry, reverseJournalEntry, ReversalDateBeforeOriginalError, type JournalPostingDeps } from "../../gl/index.js";
import { mirrorStockPlan } from "../../documents/hooks.js";
import { extend } from "../../inventory/wac-math.js";
import { occurredAtFromDocumentDate } from "../../inventory/movement.js";
import type { StockLedgerService } from "../../inventory/stock-ledger-service.js";
import type { NextNumberService } from "../../numbering/index.js";
import type { AuditSink } from "../../audit/index.js";
import { recordTransition } from "../audit.js";
import type { ProjectRepository } from "../../projects/project.js";
import { ProjectNotFoundError } from "../../projects/errors.js";
import type { AssetRepository } from "../../fixed-assets/asset.js";
import {
  resolveInternalHourlyRate,
  type AssetInternalRateHistoryRepository,
} from "../../fixed-assets/internal-rate-history.js";
import { createWarehouse, type Warehouse } from "../../settings/warehouse.js";
import type { WarehouseRepository } from "../../settings/ports.js";
import {
  InvalidSiteDocumentError,
  SiteDocumentNotFoundError,
  SiteDocumentStatusError,
  SiteReceiptSelfReceiptError,
} from "./errors.js";
import type {
  ActiveWorksContractPort,
  BoqLineExistencePort,
  CustodyFilter,
  CustodyRepository,
  EquipmentLogFilter,
  EquipmentLogRepository,
  MaterialConsumptionFilter,
  MaterialConsumptionRepository,
  SiteIssueFilter,
  SiteIssueRepository,
  SiteReceiptFilter,
  SiteReceiptRepository,
} from "./ports.js";
import type {
  ConsumptionByBoqLineRow,
  CustodyItem,
  EquipmentHoursRow,
  EquipmentLog,
  MaterialConsumption,
  SiteIssue,
  SiteIssueStatus,
  SiteReceipt,
  UnreceivedRow,
} from "./site-documents.js";
import { EquipmentLogStatus, MaterialConsumptionStatus } from "./site-documents.js";

export interface SiteServiceDeps {
  readonly issues: SiteIssueRepository;
  readonly receipts: SiteReceiptRepository;
  readonly consumptions: MaterialConsumptionRepository;
  readonly custody: CustodyRepository;
  readonly equipmentLogs: EquipmentLogRepository;
  readonly warehouses: WarehouseRepository;
  readonly projects: Pick<ProjectRepository, "findById">;
  readonly assets: Pick<AssetRepository, "findById">;
  /**
   * تاريخ سعر الساعة الداخلي. Present, a log is priced at the rate in force on
   * ITS date; absent — or empty for the asset — the asset's current rate stands,
   * which is what the register did before the series existed.
   */
  readonly assetRateHistory?: Pick<AssetInternalRateHistoryRepository, "list">;
  readonly stockLedger: StockLedgerService;
  /** The REAL GL posting engine's ports — consumption and plant hours post through it, nothing else. */
  readonly gl: JournalPostingDeps;
  readonly numbering: NextNumberService;
  readonly accountRouting?: Pick<AccountRoutingRepository, "get">;
  readonly boqLines?: BoqLineExistencePort;
  /** Slice 1. Absent, a consumption may be booked without naming a BOQ line. */
  readonly worksContracts?: ActiveWorksContractPort;
  /** Wraps confirm in one atomic transaction: stock, numbering and the GL entry commit together. */
  readonly transaction?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** سجل العمليات الحساسة — a confirmed consumption or plant log relieves stock into WIP, so it is recorded. */
  readonly audit?: AuditSink;
  /** ISO `YYYY-MM-DD` "today" — the upper bound on every site document date. */
  readonly today?: () => string;
  readonly now?: () => string;
}

export interface CreateSiteIssueCommand {
  readonly id: string;
  readonly date: string;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly issuedByUserId: string;
  readonly notes?: string | null;
  readonly lines: readonly { readonly itemId: string; readonly qty: Qty }[];
}

export interface CreateSiteReceiptCommand {
  readonly id: string;
  readonly issueId: string;
  readonly date: string;
  readonly receivedByUserId: string;
  readonly notes?: string | null;
  readonly lines: readonly { readonly itemId: string; readonly qtyReceived: Qty }[];
}

export interface CreateMaterialConsumptionCommand {
  readonly id: string;
  readonly date: string;
  readonly warehouseId: string;
  readonly boqLineId?: string | null;
  /** عقد الباطن الذي صُرفت له المواد — prefills the sub certificate's deduction. */
  readonly subcontractId?: string | null;
  readonly notes?: string | null;
  readonly lines: readonly { readonly itemId: string; readonly qty: Qty }[];
}

export interface IssueCustodyCommand {
  readonly id: string;
  readonly warehouseId: string;
  readonly descriptionAr: string;
  readonly qtyOut: Qty;
  readonly issuedDate: string;
  readonly expectedReturnDate?: string | null;
  readonly notes?: string | null;
}

export interface ReturnCustodyCommand {
  readonly qty: Qty;
  readonly date: string;
}

export interface CreateEquipmentLogCommand {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly date: string;
  readonly hours: Qty;
  readonly boqLineId?: string | null;
  readonly notes?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sumQty(values: readonly Qty[]): Qty {
  return values.reduce((total, q) => total.add(q), Qty.zero());
}

export interface SiteReversalOptions {
  readonly reversalId: string;
  readonly date?: string;
  readonly memo?: string;
  readonly actor?: string | null;
}

export class SiteService {
  constructor(private readonly deps: SiteServiceDeps) {}

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }

  private today(): string {
    return this.deps.today ? this.deps.today() : this.now().slice(0, 10);
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return this.deps.transaction ? this.deps.transaction(fn) : fn();
  }

  private async routed(key: string, fallback: string): Promise<string> {
    const routing = (await this.deps.accountRouting?.get()) ?? null;
    return routedAccountId(routing, key) ?? fallback;
  }

  private async requireSiteWarehouse(id: string, field: string): Promise<Warehouse> {
    const warehouse = await this.deps.warehouses.findById(id);
    if (!warehouse) throw new InvalidSiteDocumentError([`${field}: مستودع الموقع غير موجود`]);
    if (warehouse.type !== "SITE") {
      throw new InvalidSiteDocumentError([`${field}: يجب اختيار مستودع موقع`]);
    }
    if (!warehouse.projectId) {
      throw new InvalidSiteDocumentError([`${field}: مستودع الموقع بلا مشروع`]);
    }
    if (!(await this.deps.projects.findById(warehouse.projectId))) {
      throw new ProjectNotFoundError(warehouse.projectId);
    }
    return warehouse;
  }

  /**
   * مواد في الطريق — one transit store per branch, minted on the first issue out
   * of that branch. It is deliberately not pickable in ordinary forms: stock
   * standing in it is the exception report's evidence, not a place anyone sends
   * goods on purpose.
   */
  private async transitWarehouseFor(branchId: string): Promise<Warehouse> {
    const code = `TRANSIT-${branchId}`.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 20);
    const existing = (await this.deps.warehouses.findByBranch(branchId)).find(
      (w) => w.type === "TRANSIT" && w.code === code,
    );
    if (existing) return existing;
    const warehouse = createWarehouse({
      id: `WH-${code}`,
      code,
      name: "مواد في الطريق",
      nameEn: "Materials in transit",
      branchId,
      type: "TRANSIT",
    });
    await this.deps.warehouses.save(warehouse);
    return warehouse;
  }

  // --- إذن صرف للموقع ---

  async createIssueDraft(command: CreateSiteIssueCommand): Promise<SiteIssue> {
    const reasons: string[] = [];
    if (!ISO_DATE.test(command.date)) reasons.push("التاريخ مطلوب بصيغة YYYY-MM-DD");
    if (command.issuedByUserId.trim() === "") reasons.push("لا بد من معرفة من أصدر إذن الصرف");
    if (command.lines.length === 0) reasons.push("إذن الصرف يحتاج سطراً واحداً على الأقل");
    command.lines.forEach((line, i) => {
      if (line.itemId.trim() === "") reasons.push(`السطر ${i + 1}: الصنف مطلوب`);
      if (line.qty.isZero() || line.qty.isNegative()) reasons.push(`السطر ${i + 1}: الكمية يجب أن تكون رقماً موجباً`);
    });
    if (reasons.length > 0) throw new InvalidSiteDocumentError(reasons);

    const destination = await this.requireSiteWarehouse(command.toWarehouseId, "مستودع الموقع");
    const source = await this.deps.warehouses.findById(command.fromWarehouseId);
    if (!source) throw new InvalidSiteDocumentError(["المستودع المصدر غير موجود"]);
    if (source.type === "SITE" || source.type === "TRANSIT") {
      throw new InvalidSiteDocumentError(["الصرف للموقع يكون من مستودع رئيسي وليس من مستودع موقع أو مواد في الطريق"]);
    }
    if (source.id === destination.id) throw new InvalidSiteDocumentError(["المستودع المصدر والمستودع المستلم واحد"]);

    const issue: SiteIssue = {
      id: command.id,
      docNo: null,
      date: command.date,
      fromWarehouseId: source.id,
      toWarehouseId: destination.id,
      projectId: destination.projectId as string,
      issuedByUserId: command.issuedByUserId,
      transitWarehouseId: null,
      notes: command.notes ?? null,
      status: "draft",
      lines: command.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      createdAt: this.now(),
      issuedAt: null,
    };
    await this.deps.issues.insert(issue);
    return issue;
  }

  async confirmIssue(id: string): Promise<SiteIssue> {
    const issue = await this.deps.issues.findById(id);
    if (!issue) throw new SiteDocumentNotFoundError(id);
    if (issue.status !== "draft") {
      throw new SiteDocumentStatusError("إذن الصرف صُرف بالفعل ولا يُصرف مرتين.");
    }
    const source = await this.deps.warehouses.findById(issue.fromWarehouseId);
    if (!source) throw new InvalidSiteDocumentError(["المستودع المصدر غير موجود"]);

    return this.run(async () => {
      const transit = await this.transitWarehouseFor(source.branchId);
      const number = await this.deps.numbering.next("SITE_ISSUE");
      await this.deps.stockLedger.postTransfer({
        transferId: issue.id,
        transferNumber: number.formatted,
        fromWarehouseId: issue.fromWarehouseId,
        toWarehouseId: transit.id,
        sourceDocType: "SITE_ISSUE",
        occurredAt: occurredAtFromDocumentDate(issue.date),
        lines: issue.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      });
      const confirmed: SiteIssue = {
        ...issue,
        docNo: number.formatted,
        transitWarehouseId: transit.id,
        status: "issued",
        issuedAt: this.now(),
      };
      await this.deps.issues.save(confirmed);
      return confirmed;
    });
  }

  /** Quantity already signed for on site, per item, from CONFIRMED receipts only. */
  async receivedSoFar(issueId: string): Promise<Map<string, Qty>> {
    const receipts = await this.deps.receipts.list({ issueId });
    const received = new Map<string, Qty>();
    for (const receipt of receipts) {
      if (receipt.status !== "confirmed") continue;
      for (const line of receipt.lines) {
        received.set(line.itemId, (received.get(line.itemId) ?? Qty.zero()).add(line.qtyReceived));
      }
    }
    return received;
  }

  /** The remaining quantity per item of an issue — derived, never read off a request. */
  async outstandingOf(issue: SiteIssue): Promise<Map<string, Qty>> {
    const received = await this.receivedSoFar(issue.id);
    const outstanding = new Map<string, Qty>();
    for (const line of issue.lines) {
      const already = received.get(line.itemId) ?? Qty.zero();
      const remaining = line.qty.subtract(already);
      outstanding.set(line.itemId, remaining.isNegative() ? Qty.zero() : remaining);
    }
    return outstanding;
  }

  // --- استلام بالموقع ---

  async createReceiptDraft(command: CreateSiteReceiptCommand): Promise<SiteReceipt> {
    const issue = await this.deps.issues.findById(command.issueId);
    if (!issue) throw new SiteDocumentNotFoundError(command.issueId);
    if (issue.status === "draft") {
      throw new SiteDocumentStatusError("لا يمكن الاستلام قبل صرف إذن الصرف.");
    }
    if (issue.status === "received") {
      throw new SiteDocumentStatusError("تم استلام إذن الصرف بالكامل.");
    }
    if (command.receivedByUserId.trim() === "") {
      throw new InvalidSiteDocumentError(["لا بد من معرفة من استلم بالموقع"]);
    }
    // The control, enforced on the USER id rather than on a role: an admin
    // wildcard grants every permission, and would otherwise walk straight
    // through the only check that makes the second step worth taking.
    if (command.receivedByUserId === issue.issuedByUserId) {
      throw new SiteReceiptSelfReceiptError(command.receivedByUserId);
    }

    const reasons: string[] = [];
    if (!ISO_DATE.test(command.date)) {
      reasons.push("التاريخ مطلوب بصيغة YYYY-MM-DD");
    } else {
      // A receipt signed BEFORE the material left the store is the signature of
      // a back-dated cover-up, not a clerical slip: the transit leg cannot be
      // closed before it opened, and nothing may be received in the future.
      const today = this.today();
      if (command.date < issue.date) {
        reasons.push(`تاريخ الاستلام (${command.date}) يسبق تاريخ إذن الصرف (${issue.date})`);
      }
      if (command.date > today) {
        reasons.push(`تاريخ الاستلام (${command.date}) بعد تاريخ اليوم (${today})`);
      }
    }
    if (command.lines.length === 0) reasons.push("الاستلام يحتاج سطراً واحداً على الأقل");
    const outstanding = await this.outstandingOf(issue);
    command.lines.forEach((line, i) => {
      if (line.qtyReceived.isZero() || line.qtyReceived.isNegative()) {
        reasons.push(`السطر ${i + 1}: الكمية يجب أن تكون رقماً موجباً`);
        return;
      }
      const cap = outstanding.get(line.itemId);
      if (cap === undefined) {
        reasons.push(`السطر ${i + 1}: الصنف غير مدرج في إذن الصرف`);
        return;
      }
      if (line.qtyReceived.compare(cap) > 0) {
        reasons.push(`السطر ${i + 1}: الكمية المستلمة (${line.qtyReceived.toString()}) تتجاوز المتبقي بالطريق (${cap.toString()})`);
      }
    });
    if (reasons.length > 0) throw new InvalidSiteDocumentError(reasons);

    const receipt: SiteReceipt = {
      id: command.id,
      docNo: null,
      issueId: issue.id,
      date: command.date,
      receivedByUserId: command.receivedByUserId,
      projectId: issue.projectId,
      notes: command.notes ?? null,
      status: "draft",
      lines: command.lines.map((l) => ({ itemId: l.itemId, qtyReceived: l.qtyReceived })),
      createdAt: this.now(),
      confirmedAt: null,
    };
    await this.deps.receipts.insert(receipt);
    return receipt;
  }

  async confirmReceipt(id: string): Promise<SiteReceipt> {
    const receipt = await this.deps.receipts.findById(id);
    if (!receipt) throw new SiteDocumentNotFoundError(id);
    if (receipt.status === "confirmed") {
      throw new SiteDocumentStatusError("تم اعتماد هذا الاستلام بالفعل.");
    }
    const issue = await this.deps.issues.findById(receipt.issueId);
    if (!issue) throw new SiteDocumentNotFoundError(receipt.issueId);
    if (!issue.transitWarehouseId) {
      throw new SiteDocumentStatusError("لا يمكن الاستلام قبل صرف إذن الصرف.");
    }
    if (receipt.receivedByUserId === issue.issuedByUserId) {
      throw new SiteReceiptSelfReceiptError(receipt.receivedByUserId);
    }
    // Re-derived at CONFIRM time, not trusted from the draft: another receipt
    // against the same issue may have been confirmed in between.
    const outstanding = await this.outstandingOf(issue);
    const overruns = receipt.lines
      .filter((l) => l.qtyReceived.compare(outstanding.get(l.itemId) ?? Qty.zero()) > 0)
      .map((l) => `الصنف ${l.itemId}: الكمية المستلمة تتجاوز المتبقي بالطريق`);
    if (overruns.length > 0) throw new InvalidSiteDocumentError(overruns);

    return this.run(async () => {
      const number = await this.deps.numbering.next("SITE_RECEIPT");
      await this.deps.stockLedger.postTransfer({
        transferId: receipt.id,
        transferNumber: number.formatted,
        fromWarehouseId: issue.transitWarehouseId as string,
        toWarehouseId: issue.toWarehouseId,
        sourceDocType: "SITE_RECEIPT",
        occurredAt: occurredAtFromDocumentDate(receipt.date),
        lines: receipt.lines.map((l) => ({ itemId: l.itemId, qty: l.qtyReceived })),
      });
      const confirmed: SiteReceipt = {
        ...receipt,
        docNo: number.formatted,
        status: "confirmed",
        confirmedAt: this.now(),
      };
      await this.deps.receipts.save(confirmed);

      const stillOut = await this.outstandingOf(issue);
      const anyOutstanding = [...stillOut.values()].some((q) => !q.isZero());
      const nextStatus: SiteIssueStatus = anyOutstanding ? "partially_received" : "received";
      await this.deps.issues.save({ ...issue, status: nextStatus });
      return confirmed;
    });
  }

  // --- استهلاك مواد ---

  async createConsumptionDraft(command: CreateMaterialConsumptionCommand): Promise<MaterialConsumption> {
    const reasons: string[] = [];
    if (!ISO_DATE.test(command.date)) reasons.push("التاريخ مطلوب بصيغة YYYY-MM-DD");
    if (command.lines.length === 0) reasons.push("مستند الاستهلاك يحتاج سطراً واحداً على الأقل");
    command.lines.forEach((line, i) => {
      if (line.itemId.trim() === "") reasons.push(`السطر ${i + 1}: الصنف مطلوب`);
      if (line.qty.isZero() || line.qty.isNegative()) reasons.push(`السطر ${i + 1}: الكمية يجب أن تكون رقماً موجباً`);
    });
    if (reasons.length > 0) throw new InvalidSiteDocumentError(reasons);

    const warehouse = await this.requireSiteWarehouse(command.warehouseId, "مستودع الصرف");
    const boqLineId = command.boqLineId?.trim() ? command.boqLineId.trim() : null;
    if (boqLineId && this.deps.boqLines && !(await this.deps.boqLines.exists(boqLineId))) {
      throw new InvalidSiteDocumentError([`بند جدول الكميات "${boqLineId}" غير موجود`]);
    }
    // Consumption with no BOQ line is invisible to انحراف الاستهلاك — it has no
    // theoretical quantity to be compared against — so on a project running
    // under a live works contract the line is not optional.
    if (
      boqLineId === null &&
      this.deps.worksContracts &&
      (await this.deps.worksContracts.hasActiveContract(warehouse.projectId as string))
    ) {
      throw new InvalidSiteDocumentError([
        "بند جدول الكميات مطلوب — المشروع يعمل تحت عقد سارٍ، والاستهلاك بلا بند لا يظهر في تقرير انحراف الاستهلاك",
      ]);
    }

    const consumption: MaterialConsumption = {
      id: command.id,
      docNo: null,
      date: command.date,
      warehouseId: warehouse.id,
      projectId: warehouse.projectId as string,
      boqLineId,
      subcontractId: command.subcontractId?.trim() ? command.subcontractId.trim() : null,
      notes: command.notes ?? null,
      status: MaterialConsumptionStatus.Draft,
      lines: command.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      totalCost: Money.zero(),
      journalEntryId: null,
      createdAt: this.now(),
      confirmedAt: null,
    };
    await this.deps.consumptions.insert(consumption);
    return consumption;
  }

  /**
   * The only stock → project-cost conversion in the module (D-11). The debit is
   * أعمال تحت التنفيذ, never تكلفة البضاعة المباعة: WIP is relieved to cost of
   * contract revenue by the monthly recognition run (D-12), not by a storeman
   * issuing cement.
   */
  async confirmConsumption(id: string, actor?: string | null): Promise<MaterialConsumption> {
    const consumption = await this.deps.consumptions.findById(id);
    if (!consumption) throw new SiteDocumentNotFoundError(id);
    if (consumption.status === MaterialConsumptionStatus.Confirmed) {
      throw new SiteDocumentStatusError("تم اعتماد مستند الاستهلاك بالفعل.");
    }
    const [wipAccountId, inventoryAccountId] = await Promise.all([
      this.routed("contracting.wip", "1230"),
      this.routed("item_type.inventory", "1200"),
    ]);

    const saved = await this.run(async () => {
      const number = await this.deps.numbering.next("MATERIAL_CONSUMPTION");
      const result = await this.deps.stockLedger.postIssue({
        issueId: consumption.id,
        sourceDocType: "MATERIAL_CONSUMPTION",
        sourceDocId: consumption.id,
        sourceDocNumber: number.formatted,
        warehouseId: consumption.warehouseId,
        occurredAt: occurredAtFromDocumentDate(consumption.date),
        projectId: consumption.projectId,
        costCategory: "materials",
        lines: consumption.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      });

      // The credit is the value the LEDGER moved, not a figure this document
      // holds — crediting anything else parts the 1200 control account from the
      // stock sub-ledger permanently (D47).
      let journalEntryId: string | null = null;
      if (result.totalCost.scaled !== 0n) {
        const branchId = (await this.deps.warehouses.findById(consumption.warehouseId))?.branchId ?? null;
        const entry = await postJournalEntry(
          {
            id: consumption.id,
            date: consumption.date,
            memo: `استهلاك مواد ${number.formatted}`,
            source: "system",
            sourceDocType: "MATERIAL_CONSUMPTION",
            sourceDocId: consumption.id,
            sourceDocNumber: number.formatted,
            lines: [
              {
                accountId: wipAccountId,
                debit: result.totalCost,
                credit: Money.zero(),
                projectId: consumption.projectId,
                costCategory: "materials",
                branchId,
              },
              {
                accountId: inventoryAccountId,
                debit: Money.zero(),
                credit: result.totalCost,
                projectId: consumption.projectId,
                branchId,
              },
            ],
          },
          this.deps.gl,
        );
        journalEntryId = entry.id;
      }

      const confirmed: MaterialConsumption = {
        ...consumption,
        docNo: number.formatted,
        status: MaterialConsumptionStatus.Confirmed,
        totalCost: result.totalCost,
        journalEntryId,
        confirmedAt: this.now(),
      };
      await this.deps.consumptions.save(confirmed);
      return confirmed;
    });
    await recordTransition(this.deps.audit, {
      entityType: "MATERIAL_CONSUMPTION",
      entityId: saved.id,
      action: "CONFIRM",
      actor: actor ?? "system",
      details: {
        docNo: saved.docNo,
        projectId: saved.projectId,
        totalCost: saved.totalCost.toString(),
        journalEntryId: saved.journalEntryId,
      },
    });
    return saved;
  }

  /** INVARIANT: the stock movement and the mirror entry carry the same day, so stock and GL 1200 tie at every month end. */
  async reverseConsumption(id: string, opts: SiteReversalOptions): Promise<MaterialConsumption> {
    const consumption = await this.deps.consumptions.findById(id);
    if (!consumption) throw new SiteDocumentNotFoundError(id);
    if (consumption.status !== MaterialConsumptionStatus.Confirmed) {
      throw new SiteDocumentStatusError("مستند الاستهلاك ليس معتمداً، فلا يمكن عكسه.", "The consumption is not confirmed, so it cannot be reversed.");
    }
    const date = opts.date ?? consumption.date;
    if (date < consumption.date) throw new ReversalDateBeforeOriginalError(consumption.journalEntryId ?? consumption.id, date, consumption.date);
    const gl = { ...this.deps.gl, actor: opts.actor ?? this.deps.gl.actor };

    const saved = await this.run(async () => {
      const mirrored = mirrorStockPlan(
        { sourceDocType: "MATERIAL_CONSUMPTION", sourceDocId: opts.reversalId, sourceDocNumber: consumption.docNo, warehouseId: consumption.warehouseId, date, lines: [] },
        await this.deps.stockLedger.getMovementsOfDocument(consumption.id),
      );
      if (mirrored) {
        await this.deps.stockLedger.applyDocumentStockPlan({
          sourceDocType: "MATERIAL_CONSUMPTION",
          sourceDocId: mirrored.sourceDocId,
          sourceDocNumber: mirrored.sourceDocNumber,
          warehouseId: mirrored.warehouseId,
          lines: mirrored.lines,
          occurredAt: occurredAtFromDocumentDate(date),
        });
      }
      const reversal = consumption.journalEntryId
        ? (await reverseJournalEntry(consumption.journalEntryId, gl, { reversalId: opts.reversalId, date, memo: opts.memo ?? `عكس استهلاك مواد ${consumption.docNo ?? consumption.id}` })).reversal
        : null;
      const reversed: MaterialConsumption = { ...consumption, status: MaterialConsumptionStatus.Reversed };
      await this.deps.consumptions.save(reversed);
      await recordTransition(this.deps.audit, {
        entityType: "MATERIAL_CONSUMPTION",
        entityId: consumption.id,
        action: "REVERSE",
        actor: opts.actor ?? "system",
        severity: "WARNING",
        details: { docNo: consumption.docNo, projectId: consumption.projectId, totalCost: consumption.totalCost.toString(), journalEntryId: consumption.journalEntryId, reversalId: reversal?.id ?? null, date },
      });
      return reversed;
    });
    return saved;
  }

  async reverseEquipmentLog(id: string, opts: SiteReversalOptions): Promise<EquipmentLog> {
    const log = await this.deps.equipmentLogs.findById(id);
    if (!log) throw new SiteDocumentNotFoundError(id);
    if (log.status !== EquipmentLogStatus.Confirmed || !log.journalEntryId) {
      throw new SiteDocumentStatusError("سجل التشغيل ليس معتمداً، فلا يمكن عكسه.", "The equipment log is not confirmed, so it cannot be reversed.");
    }
    const entryId = log.journalEntryId;
    const date = opts.date ?? log.date;
    if (date < log.date) throw new ReversalDateBeforeOriginalError(entryId, date, log.date);
    const gl = { ...this.deps.gl, actor: opts.actor ?? this.deps.gl.actor };

    return this.run(async () => {
      const { reversal } = await reverseJournalEntry(entryId, gl, { reversalId: opts.reversalId, date, memo: opts.memo ?? `عكس تشغيل معدات ${log.docNo ?? log.id}` });
      const reversed: EquipmentLog = { ...log, status: EquipmentLogStatus.Reversed };
      await this.deps.equipmentLogs.save(reversed);
      await recordTransition(this.deps.audit, {
        entityType: "EQUIPMENT_LOG",
        entityId: log.id,
        action: "REVERSE",
        actor: opts.actor ?? "system",
        severity: "WARNING",
        details: { docNo: log.docNo, projectId: log.projectId, assetId: log.assetId, amount: log.amount.toString(), journalEntryId: entryId, reversalId: reversal.id, date },
      });
      return reversed;
    });
  }

  // --- عهدة المواد المرتجعة ---

  async issueCustody(command: IssueCustodyCommand): Promise<CustodyItem> {
    const reasons: string[] = [];
    if (!ISO_DATE.test(command.issuedDate)) reasons.push("تاريخ الصرف مطلوب بصيغة YYYY-MM-DD");
    if (command.descriptionAr.trim() === "") reasons.push("وصف العهدة مطلوب");
    if (command.qtyOut.isZero() || command.qtyOut.isNegative()) reasons.push("الكمية يجب أن تكون رقماً موجباً");
    if (reasons.length > 0) throw new InvalidSiteDocumentError(reasons);

    const warehouse = await this.requireSiteWarehouse(command.warehouseId, "مستودع الموقع");

    const item: CustodyItem = {
      id: command.id,
      projectId: warehouse.projectId as string,
      warehouseId: warehouse.id,
      custodianUserId: warehouse.custodianUserId as string,
      descriptionAr: command.descriptionAr.trim(),
      qtyOut: command.qtyOut,
      qtyReturned: Qty.zero(),
      issuedDate: command.issuedDate,
      expectedReturnDate: command.expectedReturnDate ?? null,
      notes: command.notes ?? null,
    };
    await this.deps.custody.insert(item);
    return item;
  }

  async returnCustody(id: string, command: ReturnCustodyCommand): Promise<CustodyItem> {
    const item = await this.deps.custody.findById(id);
    if (!item) throw new SiteDocumentNotFoundError(id);
    if (!ISO_DATE.test(command.date)) throw new InvalidSiteDocumentError(["تاريخ الارتجاع مطلوب بصيغة YYYY-MM-DD"]);
    if (command.qty.isZero() || command.qty.isNegative()) {
      throw new InvalidSiteDocumentError(["الكمية يجب أن تكون رقماً موجباً"]);
    }
    const nextReturned = item.qtyReturned.add(command.qty);
    if (nextReturned.compare(item.qtyOut) > 0) {
      throw new InvalidSiteDocumentError([
        `الكمية المرتجعة (${nextReturned.toString()}) تتجاوز الكمية المصروفة (${item.qtyOut.toString()})`,
      ]);
    }
    const updated: CustodyItem = { ...item, qtyReturned: nextReturned };
    await this.deps.custody.save(updated);
    return updated;
  }

  // --- تشغيل المعدات ---

  async createEquipmentLogDraft(command: CreateEquipmentLogCommand): Promise<EquipmentLog> {
    const reasons: string[] = [];
    if (!ISO_DATE.test(command.date)) reasons.push("التاريخ مطلوب بصيغة YYYY-MM-DD");
    if (command.hours.isZero() || command.hours.isNegative()) reasons.push("عدد الساعات يجب أن يكون رقماً موجباً");
    if (reasons.length > 0) throw new InvalidSiteDocumentError(reasons);

    if (!(await this.deps.projects.findById(command.projectId))) {
      throw new ProjectNotFoundError(command.projectId);
    }
    const asset = await this.deps.assets.findById(command.assetId);
    if (!asset) throw new InvalidSiteDocumentError([`الأصل "${command.assetId}" غير موجود`]);

    // INVARIANT: the rate is the ASSET's سعر الساعة الداخلي and nothing else.
    // A per-log override let whoever typed the log set the number that becomes
    // WIP, then cost, then the percentage of completion, then recognised
    // revenue — with no approval anywhere. Changing the rate is an edit of the
    // asset register, gated and audited there.
    if (!asset.internalHourlyRate || asset.internalHourlyRate.scaled <= 0n) {
      throw new InvalidSiteDocumentError(["سعر الساعة الداخلي غير محدد على هذه المعدة — حدّده على الأصل أولاً"]);
    }
    // INVARIANT: the rate is the one effective on the LOG's date, not today's.
    // Pricing last month's hours at a rate changed yesterday restates the WIP,
    // the cost and the recognised revenue of a month already reported.
    const history = (await this.deps.assetRateHistory?.list(asset.id)) ?? [];
    const hourlyRate =
      history.length === 0 ? asset.internalHourlyRate : resolveInternalHourlyRate(history, command.date);
    if (!hourlyRate || hourlyRate.scaled <= 0n) {
      throw new InvalidSiteDocumentError([
        `لا يوجد سعر ساعة داخلي سارٍ للمعدة في ${command.date} — أقدم سعر مسجل يبدأ في ${history[0]?.effectiveFrom ?? "—"}`,
      ]);
    }
    const boqLineId = command.boqLineId?.trim() ? command.boqLineId.trim() : null;
    if (boqLineId && this.deps.boqLines && !(await this.deps.boqLines.exists(boqLineId))) {
      throw new InvalidSiteDocumentError([`بند جدول الكميات "${boqLineId}" غير موجود`]);
    }

    const log: EquipmentLog = {
      id: command.id,
      docNo: null,
      projectId: command.projectId,
      assetId: asset.id,
      date: command.date,
      hours: command.hours,
      hourlyRate,
      amount: extend(command.hours, hourlyRate),
      boqLineId,
      notes: command.notes ?? null,
      status: EquipmentLogStatus.Draft,
      journalEntryId: null,
      createdAt: this.now(),
      confirmedAt: null,
    };
    await this.deps.equipmentLogs.insert(log);
    return log;
  }

  async confirmEquipmentLog(id: string, actor?: string | null): Promise<EquipmentLog> {
    const log = await this.deps.equipmentLogs.findById(id);
    if (!log) throw new SiteDocumentNotFoundError(id);
    if (log.status === EquipmentLogStatus.Confirmed) {
      throw new SiteDocumentStatusError("تم اعتماد سجل التشغيل بالفعل.");
    }
    const [wipAccountId, recoveryAccountId] = await Promise.all([
      this.routed("contracting.wip", "1230"),
      this.routed("contracting.plant_recovery", "5160"),
    ]);

    const saved = await this.run(async () => {
      const number = await this.deps.numbering.next("EQUIPMENT_LOG");
      // Recomputed here rather than trusted from the stored draft: the rate or
      // the hours could have been edited between draft and confirm.
      const amount = extend(log.hours, log.hourlyRate);
      const entry = await postJournalEntry(
        {
          id: log.id,
          date: log.date,
          memo: `تشغيل معدات ${number.formatted}`,
          source: "system",
          sourceDocType: "EQUIPMENT_LOG",
          sourceDocId: log.id,
          sourceDocNumber: number.formatted,
          lines: [
            {
              accountId: wipAccountId,
              debit: amount,
              credit: Money.zero(),
              projectId: log.projectId,
              costCategory: "equipment",
            },
            {
              accountId: recoveryAccountId,
              debit: Money.zero(),
              credit: amount,
              projectId: log.projectId,
            },
          ],
        },
        this.deps.gl,
      );
      const confirmed: EquipmentLog = {
        ...log,
        docNo: number.formatted,
        amount,
        status: EquipmentLogStatus.Confirmed,
        journalEntryId: entry.id,
        confirmedAt: this.now(),
      };
      await this.deps.equipmentLogs.save(confirmed);
      return confirmed;
    });
    await recordTransition(this.deps.audit, {
      entityType: "EQUIPMENT_LOG",
      entityId: saved.id,
      action: "CONFIRM",
      actor: actor ?? "system",
      details: {
        docNo: saved.docNo,
        projectId: saved.projectId,
        assetId: saved.assetId,
        journalEntryId: saved.journalEntryId,
      },
    });
    return saved;
  }

  // --- reads ---

  listIssues(filter: SiteIssueFilter = {}): Promise<readonly SiteIssue[]> {
    return this.deps.issues.list(filter) as Promise<readonly SiteIssue[]>;
  }

  listReceipts(filter: SiteReceiptFilter = {}): Promise<readonly SiteReceipt[]> {
    return this.deps.receipts.list(filter) as Promise<readonly SiteReceipt[]>;
  }

  listConsumptions(filter: MaterialConsumptionFilter = {}): Promise<readonly MaterialConsumption[]> {
    return this.deps.consumptions.list(filter) as Promise<readonly MaterialConsumption[]>;
  }

  listCustody(filter: CustodyFilter = {}): Promise<readonly CustodyItem[]> {
    return this.deps.custody.list(filter) as Promise<readonly CustodyItem[]>;
  }

  listEquipmentLogs(filter: EquipmentLogFilter = {}): Promise<readonly EquipmentLog[]> {
    return this.deps.equipmentLogs.list(filter) as Promise<readonly EquipmentLog[]>;
  }

  async getIssue(idOrDocNo: string): Promise<SiteIssue | null> {
    return (await this.deps.issues.findById(idOrDocNo)) ?? (await this.deps.issues.findByDocNo(idOrDocNo));
  }

  async getReceipt(idOrDocNo: string): Promise<SiteReceipt | null> {
    return (await this.deps.receipts.findById(idOrDocNo)) ?? (await this.deps.receipts.findByDocNo(idOrDocNo));
  }

  async getConsumption(idOrDocNo: string): Promise<MaterialConsumption | null> {
    return (
      (await this.deps.consumptions.findById(idOrDocNo)) ?? (await this.deps.consumptions.findByDocNo(idOrDocNo))
    );
  }

  async getEquipmentLog(idOrDocNo: string): Promise<EquipmentLog | null> {
    return (
      (await this.deps.equipmentLogs.findById(idOrDocNo)) ?? (await this.deps.equipmentLogs.findByDocNo(idOrDocNo))
    );
  }

  /**
   * ما صُرف ولم يصل — the exception the two-step split exists to produce.
   * Quantities are derived from confirmed receipts, so a shortfall cannot be
   * typed away.
   */
  async listUnreceived(options: { olderThanDays?: number; projectId?: string; asOf?: string } = {}): Promise<readonly UnreceivedRow[]> {
    const olderThanDays = options.olderThanDays ?? 0;
    const asOf = options.asOf ? Date.parse(`${options.asOf}T00:00:00Z`) : Date.now();
    const issues = await this.deps.issues.list(options.projectId ? { projectId: options.projectId } : {});
    const rows: UnreceivedRow[] = [];
    for (const issue of issues) {
      const ageDays = Math.floor((asOf - Date.parse(`${issue.date}T00:00:00Z`)) / 86_400_000);
      // A receipt dated before the issue it closes is reported REGARDLESS of
      // the issue's status or the ageing window: it is not a shortfall waiting
      // to be signed for, it is the signature of a back-dated one, and an aged
      // filter is exactly where such a row would hide.
      for (const receipt of await this.deps.receipts.list({ issueId: issue.id })) {
        if (receipt.status !== "confirmed" || receipt.date >= issue.date) continue;
        for (const line of receipt.lines) {
          rows.push({
            issueId: issue.id,
            docNo: issue.docNo,
            date: issue.date,
            projectId: issue.projectId,
            fromWarehouseId: issue.fromWarehouseId,
            toWarehouseId: issue.toWarehouseId,
            transitWarehouseId: issue.transitWarehouseId,
            issuedByUserId: issue.issuedByUserId,
            itemId: line.itemId,
            qtyIssued: line.qtyReceived,
            qtyReceived: line.qtyReceived,
            qtyOutstanding: Qty.zero(),
            ageDays: Math.floor((asOf - Date.parse(`${receipt.date}T00:00:00Z`)) / 86_400_000),
            kind: "received_before_issue",
            receiptId: receipt.id,
            receiptDocNo: receipt.docNo,
            receiptDate: receipt.date,
          });
        }
      }
      if (issue.status !== "issued" && issue.status !== "partially_received") continue;
      if (ageDays < olderThanDays) continue;
      const received = await this.receivedSoFar(issue.id);
      for (const line of issue.lines) {
        const already = received.get(line.itemId) ?? Qty.zero();
        const outstanding = line.qty.subtract(already);
        if (outstanding.isZero() || outstanding.isNegative()) continue;
        rows.push({
          issueId: issue.id,
          docNo: issue.docNo,
          date: issue.date,
          projectId: issue.projectId,
          fromWarehouseId: issue.fromWarehouseId,
          toWarehouseId: issue.toWarehouseId,
          transitWarehouseId: issue.transitWarehouseId,
          issuedByUserId: issue.issuedByUserId,
          itemId: line.itemId,
          qtyIssued: line.qty,
          qtyReceived: already,
          qtyOutstanding: outstanding,
          ageDays,
          kind: "outstanding",
          receiptId: null,
          receiptDocNo: null,
          receiptDate: null,
        });
      }
    }
    return rows;
  }

  /** Consumed quantity and value per (BOQ line, item) — slice 5's consumed-vs-theoretical input. */
  async consumptionByBoqLine(projectId: string): Promise<readonly ConsumptionByBoqLineRow[]> {
    const consumptions = await this.deps.consumptions.list({ projectId, status: MaterialConsumptionStatus.Confirmed });
    const byKey = new Map<string, { boqLineId: string | null; itemId: string; qty: Qty; cost: Money }>();
    for (const doc of consumptions) {
      // Largest-remainder, so the shares of a multi-line document sum back to
      // exactly the value the ledger moved.
      const totalQty = sumQty(doc.lines.map((l) => l.qty));
      const shares = totalQty.isZero()
        ? doc.lines.map(() => Money.zero())
        : allocate(doc.totalCost, doc.lines.map((l) => l.qty.scaled));
      doc.lines.forEach((line, i) => {
        const key = `${doc.boqLineId ?? ""}|${line.itemId}`;
        const existing = byKey.get(key) ?? { boqLineId: doc.boqLineId, itemId: line.itemId, qty: Qty.zero(), cost: Money.zero() };
        byKey.set(key, {
          ...existing,
          qty: existing.qty.add(line.qty),
          cost: existing.cost.add(shares[i] ?? Money.zero()),
        });
      });
    }
    return [...byKey.values()];
  }

  /** Confirmed plant hours and their charged value per BOQ line. */
  async equipmentHours(projectId: string): Promise<readonly EquipmentHoursRow[]> {
    const logs = await this.deps.equipmentLogs.list({ projectId, status: EquipmentLogStatus.Confirmed });
    const byLine = new Map<string, { boqLineId: string | null; hours: Qty; amount: Money }>();
    for (const log of logs) {
      const key = log.boqLineId ?? "";
      const existing = byLine.get(key) ?? { boqLineId: log.boqLineId, hours: Qty.zero(), amount: Money.zero() };
      byLine.set(key, { ...existing, hours: existing.hours.add(log.hours), amount: existing.amount.add(log.amount) });
    }
    return [...byLine.values()];
  }
}
