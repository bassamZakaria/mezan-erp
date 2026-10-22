export const VAT_RATE_PERCENT = 14;

export enum LedgerAccount {
  Customers = "customers",
  Sales = "sales",
  Vat = "vat",
  Cogs = "cogs",
  Inventory = "inventory",
}

export enum LedgerSide {
  Debit = "debitPiastres",
  Credit = "creditPiastres",
}

export interface LedgerLine {
  readonly account: LedgerAccount;
  readonly debitPiastres: number;
  readonly creditPiastres: number;
}

export interface SaleInput {
  readonly quantity: number;
  readonly unitPricePiastres: number;
  readonly unitCostPiastres: number;
  readonly withVat: boolean;
}

export interface SalePosting {
  readonly netPiastres: number;
  readonly vatPiastres: number;
  readonly totalPiastres: number;
  readonly costPiastres: number;
  readonly lines: readonly LedgerLine[];
}

export function postSale({ quantity, unitPricePiastres, unitCostPiastres, withVat }: SaleInput): SalePosting {
  const netPiastres = quantity * unitPricePiastres;
  const vatPiastres = withVat ? Math.round((netPiastres * VAT_RATE_PERCENT) / 100) : 0;
  const totalPiastres = netPiastres + vatPiastres;
  const costPiastres = quantity * unitCostPiastres;
  const lines: LedgerLine[] = [
    { account: LedgerAccount.Customers, debitPiastres: totalPiastres, creditPiastres: 0 },
    { account: LedgerAccount.Sales, debitPiastres: 0, creditPiastres: netPiastres },
    ...(withVat ? [{ account: LedgerAccount.Vat, debitPiastres: 0, creditPiastres: vatPiastres }] : []),
    { account: LedgerAccount.Cogs, debitPiastres: costPiastres, creditPiastres: 0 },
    { account: LedgerAccount.Inventory, debitPiastres: 0, creditPiastres: costPiastres },
  ];
  return { netPiastres, vatPiastres, totalPiastres, costPiastres, lines };
}

export function sumSide(lines: readonly LedgerLine[], side: LedgerSide): number {
  return lines.reduce((total, line) => total + line[side], 0);
}

export function piastresToDecimal(piastres: number): string {
  const sign = piastres < 0 ? "-" : "";
  const abs = Math.abs(piastres);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
