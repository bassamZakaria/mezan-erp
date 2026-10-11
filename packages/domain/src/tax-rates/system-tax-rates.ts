import { ReservedTaxRateError } from "./errors.js";
import { EtaVatSubTypeCode, TaxCalculationTypeCode, TaxRateStatusCode, type TaxRate, type TaxRateRepository } from "./tax-rate.js";

// EXTERNAL CONTRACT: stored on posted lines and journal lines. The id never
// changes, and the row keeps 0% and the authority's not-subject sub-type.
export const SYSTEM_NOT_SUBJECT_TAX_RATE_ID = "SYS-NOT-SUBJECT";

export const SYSTEM_NOT_SUBJECT_TAX_RATE: TaxRate = {
  id: SYSTEM_NOT_SUBJECT_TAX_RATE_ID,
  code: SYSTEM_NOT_SUBJECT_TAX_RATE_ID,
  name: "غير خاضع",
  rate: 0,
  calculationType: TaxCalculationTypeCode.Exclusive,
  isDefault: false,
  outputTaxAccountId: null,
  inputTaxAccountId: null,
  etaSubType: EtaVatSubTypeCode.NotSubject,
  status: TaxRateStatusCode.Active,
};

const SYSTEM_TAX_RATES: readonly TaxRate[] = [SYSTEM_NOT_SUBJECT_TAX_RATE];

export function isSystemTaxRate(taxRateId: string): boolean {
  return taxRateId === SYSTEM_NOT_SUBJECT_TAX_RATE_ID;
}

function sameRow(a: TaxRate, b: TaxRate): boolean {
  return (
    a.code === b.code &&
    a.name === b.name &&
    a.rate === b.rate &&
    a.calculationType === b.calculationType &&
    a.isDefault === b.isDefault &&
    a.outputTaxAccountId === b.outputTaxAccountId &&
    a.inputTaxAccountId === b.inputTaxAccountId &&
    a.etaSubType === b.etaSubType &&
    a.status === b.status
  );
}

// INVARIANT: the row is the system's, whole. Posted lines name it for what
// it IS — active, 0%, not subject — so a row another build or a hand on the
// file left otherwise is put back at start, not merely found to exist. It
// writes through the repository: `updateTaxRate` refuses this row by design.
export async function ensureSystemTaxRates(repo: TaxRateRepository): Promise<void> {
  await repo.transaction(async () => {
    for (const systemRate of SYSTEM_TAX_RATES) {
      const stored = await repo.findById(systemRate.id);
      if (!stored) await repo.create(systemRate);
      else if (!sameRow(stored, systemRate)) await repo.update(systemRate);
    }
  });
}

export function systemNotSubjectRateIn<T extends Pick<TaxRate, "id" | "status">>(taxRates: readonly T[]): T | null {
  return taxRates.find((r) => r.id === SYSTEM_NOT_SUBJECT_TAX_RATE_ID && r.status === TaxRateStatusCode.Active) ?? null;
}

const folded = (value: string): string => value.trim().toLowerCase();

// EXTERNAL CONTRACT: the same reading `resolveEtaVatSubType` gives the
// e-invoice — `auto` files a 0% line as not subject and a taxed one as basic.
function declaredSubType(rate: Pick<TaxRate, "rate" | "etaSubType">): string {
  if (rate.etaSubType !== EtaVatSubTypeCode.Auto) return rate.etaSubType;
  return rate.rate > 0 ? EtaVatSubTypeCode.BasicSales : EtaVatSubTypeCode.NotSubject;
}

// INVARIANT: nothing a user creates may be taken for the system's rate —
// not by its id or code in another case, and not by being indistinguishable
// from it in a picker (same name, percent and classification).
export function assertNotReservedTaxRate(candidate: Pick<TaxRate, "id" | "code" | "name" | "rate" | "etaSubType">): void {
  for (const systemRate of SYSTEM_TAX_RATES) {
    if (candidate.id === systemRate.id) continue;
    const reserved = [folded(systemRate.id), folded(systemRate.code)];
    const takesIdentity = reserved.includes(folded(candidate.id)) || reserved.includes(folded(candidate.code));
    const shadows =
      candidate.rate === systemRate.rate &&
      declaredSubType(candidate) === declaredSubType(systemRate) &&
      candidate.name.trim() === systemRate.name;
    if (takesIdentity || shadows) throw new ReservedTaxRateError(systemRate.name);
  }
}
