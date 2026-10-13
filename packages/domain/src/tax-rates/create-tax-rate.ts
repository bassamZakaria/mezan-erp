import { EtaVatSubTypeCode, TaxCalculationTypeCode, TaxRateStatusCode, type EtaVatSubType, type TaxCalculationType, type TaxRate, type TaxRateRepository } from "./tax-rate.js";
import { assertNotReservedTaxRate } from "./system-tax-rates.js";
import { DuplicateTaxCodeError, DuplicateTaxRateIdError, InvalidTaxRateError } from "./errors.js";

export interface CreateTaxRateCommand {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly rate: number;
  readonly calculationType?: TaxCalculationType;
  readonly isDefault?: boolean;
  readonly outputTaxAccountId?: string | null;
  readonly inputTaxAccountId?: string | null;
  readonly etaSubType?: EtaVatSubType;
}

function assertValidRate(rate: number): void {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new InvalidTaxRateError(
      `نسبة الضريبة يجب أن تكون رقماً بين 0 و100، والقيمة المُدخلة ${rate}.`,
      `Tax rate must be a number between 0 and 100, got ${rate}.`,
    );
  }
}

/**
 * Validates a new-tax-rate command against the existing list (docs/archive/catalog/04
 * "الضرائب"): the code must be unique and the rate must be a 0–100 percentage.
 */
export function validateNewTaxRate(command: CreateTaxRateCommand, existing: readonly TaxRate[]): void {
  const sameId = existing.find((t) => t.id === command.id);
  if (sameId) throw new DuplicateTaxRateIdError(sameId.id, sameId.name);
  assertNotReservedTaxRate({ ...command, etaSubType: command.etaSubType ?? EtaVatSubTypeCode.Auto });
  if (existing.some((t) => t.code === command.code)) {
    throw new DuplicateTaxCodeError(command.code);
  }
  assertValidRate(command.rate);
}

/**
 * Creates and persists a new tax rate. New rates always start `active`. At
 * most one tax rate may be `isDefault` — when the new rate is marked default,
 * every currently-default rate is flipped off first (mirrors the mockup's
 * single "الافتراضي" badge).
 */
export async function createTaxRate(command: CreateTaxRateCommand, repo: TaxRateRepository): Promise<TaxRate> {
  return repo.transaction(() => createTaxRateInTransaction(command, repo));
}

async function createTaxRateInTransaction(command: CreateTaxRateCommand, repo: TaxRateRepository): Promise<TaxRate> {
  const existing = await repo.list();
  validateNewTaxRate(command, existing);

  const isDefault = command.isDefault ?? false;
  if (isDefault) {
    for (const other of existing) {
      if (other.isDefault) await repo.update({ ...other, isDefault: false });
    }
  }

  const taxRate: TaxRate = {
    id: command.id,
    code: command.code,
    name: command.name,
    rate: command.rate,
    calculationType: command.calculationType ?? TaxCalculationTypeCode.Exclusive,
    isDefault,
    outputTaxAccountId: command.outputTaxAccountId ?? null,
    inputTaxAccountId: command.inputTaxAccountId ?? null,
    etaSubType: command.etaSubType ?? EtaVatSubTypeCode.Auto,
    status: TaxRateStatusCode.Active,
  };

  await repo.create(taxRate);
  return taxRate;
}
