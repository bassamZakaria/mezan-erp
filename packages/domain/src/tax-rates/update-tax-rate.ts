import type { EtaVatSubType, TaxCalculationType, TaxRate, TaxRateRepository, TaxRateStatus } from "./tax-rate.js";
import { InvalidTaxRateError, TaxRateNotFoundError } from "./errors.js";

export interface UpdateTaxRateCommand {
  readonly name?: string;
  readonly rate?: number;
  readonly calculationType?: TaxCalculationType;
  readonly isDefault?: boolean;
  readonly outputTaxAccountId?: string | null;
  readonly inputTaxAccountId?: string | null;
  readonly etaSubType?: EtaVatSubType;
  readonly status?: TaxRateStatus;
}

/**
 * Edits an existing tax rate (docs/catalog/04's "Add Tax" dialog doubles as
 * the edit form). Re-validates the rate range and re-applies the
 * single-default invariant when `isDefault` flips to true.
 */
export async function updateTaxRate(
  taxRateId: string,
  command: UpdateTaxRateCommand,
  repo: TaxRateRepository,
): Promise<TaxRate> {
  const current = await repo.findById(taxRateId);
  if (!current) throw new TaxRateNotFoundError(taxRateId);

  const nextRate = command.rate ?? current.rate;
  if (!Number.isFinite(nextRate) || nextRate < 0 || nextRate > 100) {
    throw new InvalidTaxRateError(`Tax rate must be a number between 0 and 100, got ${nextRate}.`);
  }

  const nextIsDefault = command.isDefault ?? current.isDefault;
  if (nextIsDefault && !current.isDefault) {
    const existing = await repo.list();
    for (const other of existing) {
      if (other.id !== taxRateId && other.isDefault) await repo.update({ ...other, isDefault: false });
    }
  }

  const updated: TaxRate = {
    ...current,
    name: command.name ?? current.name,
    rate: nextRate,
    calculationType: command.calculationType ?? current.calculationType,
    isDefault: nextIsDefault,
    outputTaxAccountId: command.outputTaxAccountId !== undefined ? command.outputTaxAccountId : current.outputTaxAccountId,
    inputTaxAccountId: command.inputTaxAccountId !== undefined ? command.inputTaxAccountId : current.inputTaxAccountId,
    etaSubType: command.etaSubType ?? current.etaSubType,
    status: command.status ?? current.status,
  };

  await repo.update(updated);
  return updated;
}
