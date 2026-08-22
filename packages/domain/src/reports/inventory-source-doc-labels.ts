import type { StockSourceDocType } from "../inventory/movement.js";

/** Arabic labels for `StockSourceDocType` — shared by the movement and ledger reports (docs/catalog/08 §"نوع المرجع"). */
export const STOCK_SOURCE_DOC_TYPE_LABELS_AR: Record<StockSourceDocType, string> = {
  ADJUSTMENT: "تسوية مخزون",
  TRANSFER: "تحويل مخزون",
  PURCHASE_INVOICE: "فاتورة مشتريات",
  PURCHASE_RECEIPT: "استلام بضاعة",
  SALES_INVOICE: "فاتورة مبيعات",
  SALES_RETURN: "مرتجع مبيعات",
  PURCHASE_RETURN: "مرتجع مشتريات",
  POS_SALE: "بيع نقطة بيع",
  WORK_ORDER: "أمر إنتاج",
  PURCHASE_CANCELLATION: "إلغاء استلام/فاتورة مشتريات",
};
