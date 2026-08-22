import {
  Money,
  Qty,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type GoodsReceipt,
  type GoodsReceiptLine,
  type PurchaseInvoice,
  type PurchaseInvoiceLine,
} from "@mezan/domain";
import { demoSuppliers } from "./partners-sample-data";

/**
 * Sample purchase-chain documents for the Cyag (شركة سياج) demo tenant
 * (docs/catalog/02-purchases.md). Drives the Purchase Orders / Goods Receipts /
 * Purchase Invoices screens exactly like demoInvoices drives the sales screen —
 * no live API wiring (apps/server already exposes the real `/purchases` routes).
 */

export interface DemoPurchaseItem {
  id: string;
  nameAr: string;
  unit: string;
  taxRatePercent: number;
  defaultCost: string;
}

export const demoPurchaseItems: DemoPurchaseItem[] = [
  { id: "item-cement", nameAr: "أسمنت بورتلاندي", unit: "شيكارة", taxRatePercent: 14, defaultCost: "85.00" },
  { id: "item-steel", nameAr: "حديد تسليح 12مم", unit: "طن", taxRatePercent: 14, defaultCost: "42000.00" },
  { id: "item-sand", nameAr: "رمل", unit: "متر مكعب", taxRatePercent: 0, defaultCost: "150.00" },
  { id: "item-brick", nameAr: "طوب أحمر", unit: "ألف", taxRatePercent: 14, defaultCost: "1800.00" },
];

export function supplierName(supplierId: string): string {
  return demoSuppliers.find((s) => s.id === supplierId)?.nameAr ?? supplierId;
}

export function itemName(itemId: string | null): string {
  if (!itemId) return "—";
  return demoPurchaseItems.find((i) => i.id === itemId)?.nameAr ?? itemId;
}

function poLine(itemId: string, qty: string, unitPrice: string, receivedQty = "0"): PurchaseOrderLine {
  return {
    itemId,
    description: null,
    qty: Qty.fromMajor(qty),
    unitPrice: Money.fromMajor(unitPrice),
    receivedQty: Qty.fromMajor(receivedQty),
  };
}

function grLine(itemId: string, qty: string, unitCost: string): GoodsReceiptLine {
  return { itemId, description: null, qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost) };
}

function piLine(
  itemId: string | null,
  kind: "inventory" | "expense",
  qty: string,
  unitCost: string,
  taxRatePercent: number,
  description: string | null = null,
): PurchaseInvoiceLine {
  return { itemId, description, kind, qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost), taxRatePercent };
}

export const demoPurchaseOrders: PurchaseOrder[] = [
  {
    id: "po-1",
    number: "PO-000003",
    supplierId: "sup-1",
    date: "2026-08-18",
    expectedDeliveryDate: "2026-08-25",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: "توريد دفعة أسمنت وحديد للمشروع",
    lines: [poLine("item-cement", "200", "85.00"), poLine("item-steel", "3", "42000.00")],
    status: "sent",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-18T09:00:00.000Z",
  },
  {
    id: "po-2",
    number: "PO-000002",
    supplierId: "sup-2",
    date: "2026-08-14",
    expectedDeliveryDate: "2026-08-20",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    lines: [poLine("item-brick", "10", "1800.00", "4"), poLine("item-sand", "20", "150.00", "20")],
    status: "partially_received",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-14T11:30:00.000Z",
  },
  {
    id: "po-3",
    number: "PO-000001",
    supplierId: "sup-4",
    date: "2026-08-09",
    expectedDeliveryDate: null,
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    lines: [poLine("item-sand", "8", "150.00")],
    status: "draft",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-09T08:15:00.000Z",
  },
];

export const demoGoodsReceipts: GoodsReceipt[] = [
  {
    id: "gr-1",
    number: "GR-000001",
    purchaseOrderId: "po-2",
    supplierId: "sup-2",
    warehouseId: "MAIN-WH",
    date: "2026-08-19",
    notes: null,
    lines: [grLine("item-brick", "4", "1800.00"), grLine("item-sand", "20", "150.00")],
    status: "confirmed",
    invoiced: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-19T10:00:00.000Z",
  },
];

export const demoPurchaseInvoices: PurchaseInvoice[] = [
  {
    id: "pi-1",
    number: "PI-000002",
    supplierId: "sup-1",
    date: "2026-08-20",
    dueDate: "2026-09-19",
    supplierInvoiceNumber: "INV-9911",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    receiptId: null,
    lines: [piLine("item-cement", "inventory", "5", "2.00", 0)],
    status: "confirmed",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-20T12:00:00.000Z",
  },
  {
    id: "pi-2",
    number: "PI-000001",
    supplierId: "sup-1",
    date: "2026-08-20",
    dueDate: "2026-09-04",
    supplierInvoiceNumber: null,
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    receiptId: null,
    lines: [piLine("item-cement", "inventory", "1", "100.00", 0)],
    status: "confirmed",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-20T09:30:00.000Z",
  },
];
