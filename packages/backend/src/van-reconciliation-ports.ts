import {
  DocumentStatusCode,
  Money,
  Qty,
  SALES_INVOICE_ACTIVE_STATUSES,
  VanReconciliationDocumentMismatchError,
  movementValue,
  salesInvoiceBaseGrandTotal,
  salesInvoiceTotals,
  salesReturnGrandTotal,
  treasuryAccountOwnBalance,
  type DocumentService,
  type FrameworkDocument,
  type LedgerRepository,
  type SalesInvoice,
  type SalesReturnLine,
  type StockAdjustmentDocLine,
  type StockLedgerService,
  type StockMovement,
  type StockTransferDocLine,
  type TreasuryAccountRepository,
  type VanPostingOutcome,
  type VanReconciliationPostingPort,
  type VanTrip,
  type VanTripActivity,
  type VanTripActivityPort,
  type VanTripStockActivity,
  type VoucherDocument,
  voucherStatedNet,
} from "@mezan/domain";

const SOLD_DOC_TYPES: ReadonlySet<StockMovement["sourceDocType"]> = new Set(["SALES_INVOICE", "POS_SALE"]);
const COLLECTION_VOUCHER_TYPES: ReadonlySet<string> = new Set(["customer_collection", "customer_advance"]);
const REFUND_VOUCHER_TYPES: ReadonlySet<string> = new Set(["customer_refund"]);

export interface VanActivityDeps {
  readonly stock: Pick<StockLedgerService, "getBalanceDetail">;
  readonly movementsOfWarehouse: (warehouseId: string) => Promise<readonly StockMovement[]>;
  readonly itemCostPrice: (itemId: string) => Promise<Money | null>;
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById" | "list">;
  readonly ledger: Pick<LedgerRepository, "accountBalance" | "treasuryAccountBalance">;
  readonly listVouchers: (filter: { status: "confirmed"; fromDate: string; toDate: string }) => Promise<readonly VoucherDocument[]>;
  readonly listInvoices: (filter: { warehouseId: string; fromDate: string; toDate: string }) => Promise<readonly SalesInvoice[]>;
  readonly listReturns: (filter: { status: "confirmed"; fromDate: string; toDate: string }) => Promise<readonly FrameworkDocument<SalesReturnLine>[]>;
}

const dayOf = (instant: string) => instant.slice(0, 10);

/**
 * What the books hold for a trip's van. On-hand and the till balance are the
 * ledgers' own figures; loaded/sold/returned and the collections are the
 * breakdown, read from the movements and vouchers dated inside the trip.
 */
export function createVanTripActivityPort(deps: VanActivityDeps): VanTripActivityPort {
  return {
    async read(trip: VanTrip, day: string, extraItemIds: readonly string[]): Promise<VanTripActivity> {
      const movements = await deps.movementsOfWarehouse(trip.vanWarehouseId);
      const inTrip = (m: StockMovement) => {
        const d = dayOf(m.occurredAt);
        return d >= trip.date && d <= day;
      };
      const itemIds = new Set<string>([...movements.map((m) => m.itemId), ...trip.loadedStock.map((l) => l.itemId), ...extraItemIds]);

      const stock: VanTripStockActivity[] = [];
      for (const itemId of itemIds) {
        const mine = movements.filter((m) => m.itemId === itemId && !m.qty.isZero());
        const signed = (m: StockMovement) => (m.direction === "IN" ? m.qty : m.qty.negate());
        const loadedQty = Qty.sum(mine.filter((m) => m.sourceDocType === "TRANSFER" && m.sourceDocId === trip.id).map(signed));
        const soldQty = Qty.sum(mine.filter((m) => inTrip(m) && SOLD_DOC_TYPES.has(m.sourceDocType)).map(signed)).negate();
        const returnedQty = Qty.sum(mine.filter((m) => inTrip(m) && m.sourceDocType === "SALES_RETURN").map(signed));
        const detail = await deps.stock.getBalanceDetail(itemId, trip.vanWarehouseId);
        const unitCost = detail.averageCost.scaled > 0n ? detail.averageCost : ((await deps.itemCostPrice(itemId)) ?? Money.zero());
        stock.push({ itemId, onHand: detail.onHand, unitCost, loadedQty, soldQty, returnedQty });
      }

      const till = await deps.treasuryAccounts.findById(trip.vanTreasuryAccountId);
      const tillBalance = till?.glAccountId
        ? await treasuryAccountOwnBalance({ id: till.id, glAccountId: till.glAccountId }, deps)
        : Money.zero();

      const vouchers = await deps.listVouchers({ status: "confirmed", fromDate: trip.date, toDate: day });
      let voucherCollections = Money.zero();
      for (const v of vouchers) {
        const line = v.lines[0];
        if (!line || line.treasuryAccountId !== trip.vanTreasuryAccountId || v.reversedByDocId) continue;
        if (COLLECTION_VOUCHER_TYPES.has(line.voucherType)) voucherCollections = voucherCollections.add(voucherStatedNet(line));
        if (REFUND_VOUCHER_TYPES.has(line.voucherType)) voucherCollections = voucherCollections.add(line.amount.negate());
      }

      const invoices = await deps.listInvoices({ warehouseId: trip.vanWarehouseId, fromDate: trip.date, toDate: day });
      const invoicedSales = Money.sum(
        invoices
          .filter((inv) => SALES_INVOICE_ACTIVE_STATUSES.has(inv.status))
          .map((inv) => salesInvoiceBaseGrandTotal(salesInvoiceTotals(inv), inv.fxRate)),
      );
      const returns = await deps.listReturns({ status: "confirmed", fromDate: trip.date, toDate: day });
      const returnsValue = Money.sum(
        returns.filter((r) => r.lines[0]?.warehouseId === trip.vanWarehouseId && !r.reversedByDocId).map(salesReturnGrandTotal),
      );

      return { stock, tillBalance, voucherCollections, invoicedSales, returnsValue };
    },
  };
}

export interface VanPostingDeps {
  readonly adjustments: DocumentService<StockAdjustmentDocLine>;
  readonly transfers: DocumentService<StockTransferDocLine>;
  readonly movementsOfDocument: (documentId: string) => Promise<readonly StockMovement[]>;
  readonly voucherExists: (voucherId: string) => Promise<boolean>;
  readonly recordCashVariance: (input: {
    voucherId: string;
    tripId: string;
    date: string;
    branchId: string;
    vanTreasuryAccountId: string;
    variance: Money;
  }) => Promise<void>;
  readonly treasuryTransfer: (input: {
    id: string;
    voucherId: string;
    date: string;
    amount: Money;
    branchId: string;
    fromTreasuryAccountId: string;
    toTreasuryAccountId: string;
  }) => Promise<void>;
}

const FINGERPRINT_KEYS = ["itemId", "qty", "warehouseId", "fromWarehouseId", "toWarehouseId", "direction", "reason"] as const;

const fingerprint = (lines: readonly unknown[]) =>
  JSON.stringify(
    lines.map((line) => {
      const record = line as Record<string, unknown>;
      return FINGERPRINT_KEYS.map((key) => {
        const value = record[key];
        return value instanceof Money || value instanceof Qty ? value.toString() : (value ?? null);
      });
    }),
  );

async function driveDocument<Line>(
  service: DocumentService<Line>,
  draft: { id: string; date: string; memo: string; lines: readonly Line[] },
  actor: { actor: string; actorRoles?: readonly string[] },
): Promise<boolean> {
  const found = await service.findById(draft.id);
  // SECURITY: the minted id is guessable, so a document already holding it is
  // only resumed when it carries exactly the lines this settlement would post.
  if (found && fingerprint(found.lines) !== fingerprint(draft.lines)) throw new VanReconciliationDocumentMismatchError(draft.id);
  const existing = found ?? (await service.createDraft(draft));
  if (existing.status === DocumentStatusCode.Confirmed) return false;
  const { held } = await service.confirm(draft.id, { actor: actor.actor, actorRoles: actor.actorRoles });
  return held;
}

/**
 * The approval's postings, each through the engine every other screen uses:
 * vouchers for the cash, the stock-adjustment and stock-transfer documents for
 * the goods — so each carries a number, its own approval gate, the tenant's GL
 * routing and an audit row. Keyed by the domain's minted document id, so a
 * resumed approval never posts the same thing twice.
 */
export function createVanReconciliationPostingPort(deps: VanPostingDeps): VanReconciliationPostingPort {
  const valueOf = async (documentId: string): Promise<Money> =>
    Money.sum((await deps.movementsOfDocument(documentId)).map((m) => movementValue(m)));

  return {
    async recordCashVariance(input) {
      if (await deps.voucherExists(input.documentId)) return;
      await deps.recordCashVariance({ ...input, voucherId: input.documentId });
    },
    async returnCash(input) {
      if (await deps.voucherExists(input.documentId)) return;
      await deps.treasuryTransfer({
        id: input.tripId,
        voucherId: input.documentId,
        date: input.date,
        amount: input.amount,
        branchId: input.branchId,
        fromTreasuryAccountId: input.fromTreasuryAccountId,
        toTreasuryAccountId: input.toTreasuryAccountId,
      });
    },
    async postAdjustment(input): Promise<VanPostingOutcome> {
      const held = await driveDocument(
        deps.adjustments,
        {
          id: input.documentId,
          date: input.date,
          memo: input.memo,
          lines: input.lines.map((l) => ({
            itemId: l.itemId,
            warehouseId: input.warehouseId,
            reason: input.reason,
            direction: input.direction,
            qty: l.qty,
            ...(l.unitCost ? { unitCost: l.unitCost } : {}),
          })),
        },
        input,
      );
      return { held, value: held ? null : await valueOf(input.documentId) };
    },
    async postTransfer(input): Promise<VanPostingOutcome> {
      const held = await driveDocument(
        deps.transfers,
        {
          id: input.documentId,
          date: input.date,
          memo: input.memo,
          lines: input.lines.map((l) => ({
            itemId: l.itemId,
            fromWarehouseId: input.fromWarehouseId,
            toWarehouseId: input.toWarehouseId,
            qty: l.qty,
          })),
        },
        input,
      );
      return { held, value: held ? null : Money.sum((await deps.movementsOfDocument(input.documentId)).filter((m) => m.direction === "OUT").map((m) => movementValue(m))) };
    },
  };
}
