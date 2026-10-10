import type { EtaVatSubType, TaxCalculationType, TaxRate, TaxRateRepository, TaxRateStatus, TaxRateUsage } from "./tax-rate.js";
import { InvalidTaxRateError, SystemTaxRateLockedError, TaxRateInUseError, TaxRateNotFoundError } from "./errors.js";
import { isSystemTaxRate } from "./system-tax-rates.js";

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
 * Edits an existing tax rate (docs/archive/catalog/04's "Add Tax" dialog doubles as
 * the edit form). Re-validates the rate range and re-applies the
 * single-default invariant when `isDefault` flips to true.
 */
export async function updateTaxRate(
  taxRateId: string,
  command: UpdateTaxRateCommand,
  repo: TaxRateRepository,
  usage: TaxRateUsage,
): Promise<TaxRate> {
  // INVARIANT: the reference check and the write are one transaction, so a
  // document cannot start naming the rate between the two.
  return repo.transaction(() => updateTaxRateInTransaction(taxRateId, command, repo, usage));
}

async function updateTaxRateInTransaction(
  taxRateId: string,
  command: UpdateTaxRateCommand,
  repo: TaxRateRepository,
  usage: TaxRateUsage,
): Promise<TaxRate> {
  const current = await repo.findById(taxRateId);
  if (!current) throw new TaxRateNotFoundError(taxRateId);
  if (isSystemTaxRate(current.id)) throw new SystemTaxRateLockedError(current.id, current.name);

  const nextRate = command.rate ?? current.rate;
  // INVARIANT: a stored line names this row and reads its classification off
  // it. Changing the percent or the sub-type here would restate every document
  // already filed under it, so a referenced rate keeps both for good.
  const restatesIdentity = nextRate !== current.rate || (command.etaSubType ?? current.etaSubType) !== current.etaSubType;
  if (restatesIdentity && (await usage.isReferenced(taxRateId))) {
    throw new TaxRateInUseError(current.id, current.name);
  }
  if (!Number.isFinite(nextRate) || nextRate < 0 || nextRate > 100) {
    throw new InvalidTaxRateError(
      `نسبة الضريبة يجب أن تكون رقماً بين 0 و100، والقيمة المُدخلة ${nextRate}.`,
      `Tax rate must be a number between 0 and 100, got ${nextRate}.`,
    );
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
