import { EtaVatSubTypeCode, TaxRateStatusCode, type TaxRate, type TaxRateRepository } from "./tax-rate.js";

// EXTERNAL CONTRACT: stored on posted lines and journal lines. The id never
// changes, and the row keeps 0% and the authority's not-subject sub-type.
export const SYSTEM_NOT_SUBJECT_TAX_RATE_ID = "SYS-NOT-SUBJECT";

export const SYSTEM_NOT_SUBJECT_TAX_RATE: TaxRate = {
  id: SYSTEM_NOT_SUBJECT_TAX_RATE_ID,
  code: SYSTEM_NOT_SUBJECT_TAX_RATE_ID,
  name: "غير خاضع",
  rate: 0,
  calculationType: "exclusive",
  isDefault: false,
  outputTaxAccountId: null,
  inputTaxAccountId: null,
  etaSubType: EtaVatSubTypeCode.NotSubject,
  status: TaxRateStatusCode.Active,
};

export function isSystemTaxRate(taxRateId: string): boolean {
  return taxRateId === SYSTEM_NOT_SUBJECT_TAX_RATE_ID;
}

export async function ensureSystemTaxRates(repo: TaxRateRepository): Promise<void> {
  await repo.transaction(async () => {
    if (await repo.findById(SYSTEM_NOT_SUBJECT_TAX_RATE_ID)) return;
    await repo.create(SYSTEM_NOT_SUBJECT_TAX_RATE);
  });
}

export function systemNotSubjectRateIn<T extends Pick<TaxRate, "id" | "status">>(taxRates: readonly T[]): T | null {
  return taxRates.find((r) => r.id === SYSTEM_NOT_SUBJECT_TAX_RATE_ID && r.status === TaxRateStatusCode.Active) ?? null;
}
