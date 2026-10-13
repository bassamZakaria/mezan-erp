import { useMemo } from "react";
import { useFormat, type PrintPartyInfo } from "@mezan/ui";
import type {
  GoodsReceiptDTO,
  PurchaseInvoiceDTO,
  PurchaseOrderDTO,
  PurchaseReturnDocumentDTO,
  SalesReturnDocumentDTO,
  VoucherDTO,
} from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { useAccounts, useBranches, useCustomers, useItems, useDisplaySettings, useSuppliers, useTreasuryAccounts, useWarehouses } from "../data/hooks";
import type { JournalEntryDTO, SalesQuoteRecord } from "../data/hooks";
import { DocumentPrintPage } from "./DocumentPrintPage";
import { documentPrintModel, type DocumentPrintLineInput } from "./document-print";
import { ledgerPrintModel, type LedgerPrintLabels, type LedgerPrintRowInput } from "./ledger-print";
import { EMPTY } from "../lib/empty";
import { scaledOf } from "../lib/money";

/**
 * The nine printable documents that had no compliant template (P-6): the
 * quote, the purchase order, the purchase invoice, both returns, the goods
 * receipt, the journal entry, the treasury voucher and the party statement.
 *
 * They are pages, not overlays — each screen routes to `…/<docNo>/print` the
 * way the sales invoice already does, so a printed document survives a reload
 * and leaves through the shell's own «رجوع». Every one of them carries the
 * company name and tax registration, the document number and date, the VAT
 * broken down by the rate each line was charged at, and the total in Arabic
 * words. None of them invents an ETA identifier: the block appears only where
 * the authority has actually returned one.
 */

function useLedgerLabels(): LedgerPrintLabels {
  const { t } = useAppTranslation();
  return {
    date: t("print.ledger.col.date"),
    reference: t("print.ledger.col.reference"),
    description: t("print.ledger.col.description"),
    debit: t("print.ledger.col.debit"),
    credit: t("print.ledger.col.credit"),
    balance: t("print.ledger.col.balance"),
  };
}

/* ------------------------------------------------------------------ */
/* Goods documents                                                     */
/* ------------------------------------------------------------------ */

export function QuotePrintPage({ quote }: { quote: SalesQuoteRecord }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const customers = useCustomers().data ?? EMPTY;
  const branches = useBranches().data ?? EMPTY;
  const items = useItems().data ?? EMPTY;

  const document = useMemo(() => {
    const customer = customers.find((c) => c.id === quote.customerId);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const party: PrintPartyInfo = {
      roleLabel: t("print.role.customer"),
      name: quote.customerNameAr,
      code: customer?.code,
      taxNumber: customer?.taxNumber ?? undefined,
      address: customer?.address ?? undefined,
      phone: customer?.phone ?? undefined,
    };
    const lines: DocumentPrintLineInput[] = quote.lines.map((line) => ({
      code: itemById.get(line.itemId)?.code,
      description: line.itemNameAr,
      unit: itemById.get(line.itemId)?.baseUnitCode,
      qty: line.qty,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? 0,
      // A tax-exempt customer is charged nothing whatever the item says, and
      // a quote that printed the item's rate would promise a price the
      // invoice will not honour.
      taxRatePercent: quote.customerTaxExempt ? 0 : (line.taxRatePercent ?? 0),
    }));
    return documentPrintModel({
      documentType: "SALES_QUOTE",
      documentTypeLabel: t("print.doc.quote"),
      number: quote.docNo ?? quote.id,
      date: quote.date,
      // العرض صالح حتى — the expiry is what makes a quote binding for a
      // period, so it prints where an invoice prints its due date.
      dueDate: quote.expiryDate,
      settings,
      branchName: branches.find((b) => b.id === quote.branchId)?.name,
      party,
      notes: quote.notes,
      currencyLabel: format.currencyLabel,
      vatLabel: t("print.vat"),
      lines,
      documentDiscount: quote.discount.type === "amount" ? quote.discount.amount : undefined,
    });
  }, [quote, settings, customers, branches, items, format.currencyLabel, t]);

  return <DocumentPrintPage document={document} />;
}

export function PurchaseOrderPrintPage({ order }: { order: PurchaseOrderDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const suppliers = useSuppliers().data ?? EMPTY;
  const branches = useBranches().data ?? EMPTY;
  const warehouses = useWarehouses().data ?? EMPTY;
  const items = useItems().data ?? EMPTY;

  const document = useMemo(() => {
    const supplier = suppliers.find((s) => s.id === order.supplierId);
    const itemById = new Map(items.map((i) => [i.id, i]));
    return documentPrintModel({
      documentType: "PURCHASE_ORDER",
      documentTypeLabel: t("print.doc.purchaseOrder"),
      number: order.number,
      date: order.date,
      dueDate: order.expectedDeliveryDate ?? undefined,
      settings,
      branchName: branches.find((b) => b.id === order.branchId)?.name,
      warehouseName: warehouses.find((w) => w.id === order.warehouseId)?.name,
      party: supplierParty(t("print.role.supplier"), supplier),
      notes: order.notes,
      currencyLabel: format.currencyLabel,
      vatLabel: t("print.vat"),
      lines: order.lines.map((line) => ({
        code: itemById.get(line.itemId)?.code,
        description: line.description || itemById.get(line.itemId)?.nameAr || line.itemId,
        unit: itemById.get(line.itemId)?.baseUnitCode,
        qty: line.qty,
        unitPrice: line.unitPrice,
      })),
    });
  }, [order, settings, suppliers, branches, warehouses, items, format.currencyLabel, t]);

  return <DocumentPrintPage document={document} />;
}

export function PurchaseInvoicePrintPage({ invoice }: { invoice: PurchaseInvoiceDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const suppliers = useSuppliers().data ?? EMPTY;
  const branches = useBranches().data ?? EMPTY;
  const warehouses = useWarehouses().data ?? EMPTY;
  const items = useItems().data ?? EMPTY;

  const document = useMemo(() => {
    const supplier = suppliers.find((s) => s.id === invoice.supplierId);
    const itemById = new Map(items.map((i) => [i.id, i]));
    return documentPrintModel({
      documentType: "PURCHASE_INVOICE",
      documentTypeLabel: t("print.doc.purchaseInvoice"),
      // The SUPPLIER's own invoice number where they gave one — it is what a
      // tax inspector matches against their copy — with ours beside it.
      number: invoice.supplierInvoiceNumber ? `${invoice.number} / ${invoice.supplierInvoiceNumber}` : invoice.number,
      date: invoice.date,
      dueDate: invoice.dueDate ?? undefined,
      settings,
      branchName: branches.find((b) => b.id === invoice.branchId)?.name,
      warehouseName: warehouses.find((w) => w.id === invoice.warehouseId)?.name,
      party: supplierParty(t("print.role.supplier"), supplier),
      notes: invoice.notes,
      currencyLabel: format.currencyLabel,
      vatLabel: t("print.vat"),
      lines: invoice.lines.map((line) => ({
        code: line.itemId ? itemById.get(line.itemId)?.code : undefined,
        description: line.description || (line.itemId ? itemById.get(line.itemId)?.nameAr : undefined) || line.itemId || "",
        unit: line.itemId ? itemById.get(line.itemId)?.baseUnitCode : undefined,
        qty: line.qty,
        unitPrice: line.unitCost,
        taxRatePercent: line.taxRatePercent,
      })),
    });
  }, [invoice, settings, suppliers, branches, warehouses, items, format.currencyLabel, t]);

  return <DocumentPrintPage document={document} />;
}

export function SalesReturnPrintPage({ document: doc }: { document: SalesReturnDocumentDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const customers = useCustomers().data ?? EMPTY;
  const items = useItems().data ?? EMPTY;

  const model = useMemo(() => {
    const customerId = doc.lines[0]?.customerId;
    const customer = customers.find((c) => c.id === customerId);
    const itemById = new Map(items.map((i) => [i.id, i]));
    return documentPrintModel({
      documentType: "SALES_RETURN",
      documentTypeLabel: t("print.doc.salesReturn"),
      number: doc.docNo ?? doc.id,
      date: doc.date,
      settings,
      party: customer
        ? {
            roleLabel: t("print.role.customer"),
            name: customer.nameAr,
            code: customer.code,
            taxNumber: customer.taxNumber ?? undefined,
            address: customer.address ?? undefined,
            phone: customer.phone ?? undefined,
          }
        : undefined,
      notes: doc.memo,
      currencyLabel: format.currencyLabel,
      vatLabel: t("print.vat"),
      lines: doc.lines.map((line) => ({
        code: itemById.get(line.itemId)?.code,
        description: itemById.get(line.itemId)?.nameAr ?? line.itemId,
        unit: itemById.get(line.itemId)?.baseUnitCode,
        qty: line.qty,
        unitPrice: line.unitPrice,
        // The VAT the source invoice actually charged, taken verbatim — a
        // credit note reverses what was charged, not what today's rate is.
        taxAmount: line.taxAmount,
        taxRatePercent: line.taxRatePercent ?? 0,
      })),
    });
  }, [doc, settings, customers, items, format.currencyLabel, t]);

  return <DocumentPrintPage document={model} />;
}

export function PurchaseReturnPrintPage({ document: doc }: { document: PurchaseReturnDocumentDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const suppliers = useSuppliers().data ?? EMPTY;
  const items = useItems().data ?? EMPTY;

  const model = useMemo(() => {
    const supplier = suppliers.find((s) => s.id === doc.lines[0]?.supplierId);
    const itemById = new Map(items.map((i) => [i.id, i]));
    return documentPrintModel({
      documentType: "PURCHASE_RETURN",
      documentTypeLabel: t("print.doc.purchaseReturn"),
      number: doc.docNo ?? doc.id,
      date: doc.date,
      settings,
      party: supplierParty(t("print.role.supplier"), supplier),
      notes: doc.memo,
      currencyLabel: format.currencyLabel,
      vatLabel: t("print.vat"),
      lines: doc.lines.map((line) => ({
        code: itemById.get(line.itemId)?.code,
        description: itemById.get(line.itemId)?.nameAr ?? line.itemId,
        unit: itemById.get(line.itemId)?.baseUnitCode,
        qty: line.qty,
        unitPrice: line.unitCost,
        taxAmount: line.taxAmount,
        taxRatePercent: line.taxRatePercent ?? 0,
      })),
    });
  }, [doc, settings, suppliers, items, format.currencyLabel, t]);

  return <DocumentPrintPage document={model} />;
}

export function GoodsReceiptPrintPage({ receipt }: { receipt: GoodsReceiptDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const suppliers = useSuppliers().data ?? EMPTY;
  const warehouses = useWarehouses().data ?? EMPTY;
  const items = useItems().data ?? EMPTY;

  const document = useMemo(() => {
    const supplier = suppliers.find((s) => s.id === receipt.supplierId);
    const itemById = new Map(items.map((i) => [i.id, i]));
    return documentPrintModel({
      documentType: "GOODS_RECEIPT",
      documentTypeLabel: t("print.doc.goodsReceipt"),
      number: receipt.number,
      date: receipt.date,
      settings,
      warehouseName: warehouses.find((w) => w.id === receipt.warehouseId)?.name,
      party: supplierParty(t("print.role.supplier"), supplier),
      notes: receipt.notes,
      currencyLabel: format.currencyLabel,
      vatLabel: t("print.vat"),
      lines: receipt.lines.map((line) => {
        // Batch and expiry belong on the paper a storekeeper signs: it is the
        // only record of WHICH batch was accepted at the gate.
        const traits = [
          line.batchNo ? t("print.grn.batch", { value: line.batchNo }) : null,
          line.expiryDate ? t("print.grn.expiry", { value: line.expiryDate }) : null,
        ].filter((entry): entry is string => entry !== null);
        const name = line.description || itemById.get(line.itemId)?.nameAr || line.itemId;
        return {
          code: itemById.get(line.itemId)?.code,
          description: traits.length > 0 ? `${name} (${traits.join("، ")})` : name,
          unit: itemById.get(line.itemId)?.baseUnitCode,
          qty: line.qty,
          unitPrice: line.unitCost,
        };
      }),
    });
  }, [receipt, settings, suppliers, warehouses, items, format.currencyLabel, t]);

  return <DocumentPrintPage document={document} />;
}

/* ------------------------------------------------------------------ */
/* Ledger documents                                                    */
/* ------------------------------------------------------------------ */

export function JournalEntryPrintPage({ entry }: { entry: JournalEntryDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const accounts = useAccounts().data ?? EMPTY;
  const labels = useLedgerLabels();

  const document = useMemo(() => {
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const rows: LedgerPrintRowInput[] = entry.lines.map((line, index) => {
      const account = accountById.get(line.accountId);
      return {
        key: `${index}`,
        reference: account?.code ?? line.accountId,
        label: account?.nameAr ?? line.accountId,
        note: line.memo,
        debit: scaledOf(line.debit),
        credit: scaledOf(line.credit),
      };
    });
    return ledgerPrintModel({
      documentType: "JOURNAL_ENTRY",
      documentTypeLabel: t("print.doc.journalEntry"),
      number: entry.entryNo ?? entry.id,
      date: entry.date,
      settings,
      notes: entry.memo,
      currencyLabel: format.currencyLabel,
      labels,
      rows,
      // A posted entry balances by construction, so the closing figure is
      // zero and spelling out zero says nothing.
      closingLabel: t("print.ledger.entryBalance"),
      amountInWordsOf: "none",
    });
  }, [entry, settings, accounts, format.currencyLabel, labels, t]);

  return <DocumentPrintPage document={document} />;
}

export function VoucherPrintPage({ voucher, partyName }: { voucher: VoucherDTO; partyName?: string }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const branches = useBranches().data ?? EMPTY;
  const treasuries = useTreasuryAccounts().data ?? EMPTY;
  const labels = useLedgerLabels();

  const document = useMemo(() => {
    const treasury = treasuries.find((a) => a.id === voucher.treasuryAccountId);
    const receipt = voucher.direction === "receipt";
    const amount = scaledOf(voucher.amount);
    const withheld = scaledOf(voucher.withholdingAmount);
    const rows: LedgerPrintRowInput[] = [
      {
        key: "amount",
        date: voucher.date,
        reference: voucher.referenceNo ?? treasury?.name ?? voucher.treasuryAccountId,
        label: voucher.memo || t(`print.doc.voucher`),
        debit: receipt ? amount : 0n,
        credit: receipt ? 0n : amount,
      },
    ];
    // Withholding is money the payee never receives; a voucher that printed
    // only the gross would not reconcile with what left the drawer.
    if (withheld > 0n) {
      rows.push({
        key: "withholding",
        date: voucher.date,
        reference: "",
        label: t("print.ledger.netMovement"),
        debit: receipt ? 0n : withheld,
        credit: receipt ? withheld : 0n,
      });
    }
    return ledgerPrintModel({
      documentType: "TREASURY_VOUCHER",
      documentTypeLabel: t("print.doc.voucher"),
      number: voucher.docNo ?? voucher.id,
      date: voucher.date,
      settings,
      branchName: branches.find((b) => b.id === voucher.branchId)?.name,
      party: partyName
        ? { roleLabel: receipt ? t("print.role.customer") : t("print.role.supplier"), name: partyName }
        : undefined,
      notes: voucher.memo,
      currencyLabel: format.currencyLabel,
      labels,
      rows,
      closingLabel: t("print.ledger.netMovement"),
      // A voucher is a payable instrument: the figure has to be readable as
      // words on the paper someone signs for.
      amountInWordsOf: "closing",
    });
  }, [voucher, partyName, settings, branches, treasuries, format.currencyLabel, labels, t]);

  return <DocumentPrintPage document={document} />;
}

/** One statement row, in the shape both party screens already build. */
export interface StatementPrintRow {
  readonly key: string;
  readonly date: string | null;
  readonly label: string;
  readonly note: string | null;
  readonly reference: string;
  readonly debit: bigint;
  readonly credit: bigint;
}

/**
 * كشف حساب — the printable statement, taking rows rather than a party id so
 * the customer screen and the supplier screen (whose server route is being
 * added separately) both feed the same template.
 */
export function StatementPrintPage({
  rows,
  party,
  kind,
  periodFrom,
  periodTo,
}: {
  rows: readonly StatementPrintRow[];
  party: PrintPartyInfo;
  kind: "customer" | "supplier";
  periodFrom?: string;
  periodTo?: string;
}) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const settings = useDisplaySettings().data ?? null;
  const labels = useLedgerLabels();

  const document = useMemo(
    () =>
      ledgerPrintModel({
        documentType: kind === "customer" ? "CUSTOMER_STATEMENT" : "SUPPLIER_STATEMENT",
        documentTypeLabel: kind === "customer" ? t("print.doc.customerStatement") : t("print.doc.supplierStatement"),
        number: party.code ?? party.name,
        date: periodTo ?? new Date().toISOString().slice(0, 10),
        settings,
        party,
        currencyLabel: format.currencyLabel,
        labels,
        rows: rows.map((row) => ({
          key: row.key,
          date: row.date,
          reference: row.reference,
          label: row.label,
          note: row.note,
          debit: row.debit,
          credit: row.credit,
        })),
        periodLabel: periodFrom && periodTo ? t("print.ledger.period", { from: periodFrom, to: periodTo }) : undefined,
        showRunningBalance: true,
        closingLabel: t("print.ledger.closingBalance"),
        // A closing balance can be a credit; `amountInWords` refuses a
        // negative, so a customer in credit gets figures and no words rather
        // than a spelled-out lie.
        amountInWordsOf: "closing",
      }),
    [rows, party, kind, periodFrom, periodTo, settings, format.currencyLabel, labels, t],
  );

  return <DocumentPrintPage document={document} />;
}

/* ------------------------------------------------------------------ */

function supplierParty(roleLabel: string, supplier: { code: string; nameAr: string; taxNumber: string | null; phone: string | null; addressCity: string | null; addressDistrict: string | null; addressStreet: string | null } | undefined): PrintPartyInfo | undefined {
  if (!supplier) return undefined;
  const address = [supplier.addressStreet, supplier.addressDistrict, supplier.addressCity]
    .filter((part): part is string => Boolean(part))
    .join("، ");
  return {
    roleLabel,
    name: supplier.nameAr,
    code: supplier.code,
    taxNumber: supplier.taxNumber ?? undefined,
    address: address || undefined,
    phone: supplier.phone ?? undefined,
  };
}
