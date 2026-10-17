import { Field, TextInput } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { EvidencePeriodDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { localIsoDay } from "../../../lib/dates";
import { useAppTranslation } from "../../../i18n";

export enum EvidenceCode {
  SequenceGaps = "audit.sequence_gaps.view",
  View = "audit.evidence_pack.view",
  Build = "audit.evidence_pack.build",
}

export function useGrants(...codes: readonly EvidenceCode[]): readonly boolean[] {
  const { session } = useApi();
  const auth = createAuthContext({ userId: session?.userId ?? "anonymous", permissions: session?.permissions ?? [], branchScope: "*", warehouseScope: "*" });
  return codes.map((code) => can(auth, code));
}

export function defaultPeriod(today = new Date()): EvidencePeriodDTO {
  const to = localIsoDay(today);
  return { from: `${to.slice(0, 4)}-01-01`, to };
}

export function isValidPeriod(period: EvidencePeriodDTO): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(period.from) && /^\d{4}-\d{2}-\d{2}$/.test(period.to) && period.from <= period.to;
}

interface PeriodFieldsProps {
  readonly value: EvidencePeriodDTO;
  readonly onChange: (next: EvidencePeriodDTO) => void;
}

export function PeriodFields({ value, onChange }: PeriodFieldsProps) {
  const { t } = useAppTranslation();
  return (
    <fieldset className="flex flex-wrap items-end gap-[12px]">
      <legend className="sr-only">{t("evidence.period")}</legend>
      <Field label={t("evidence.from")} htmlFor="evidence-from">
        <TextInput id="evidence-from" type="date" className="w-[170px]" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      </Field>
      <Field label={t("evidence.to")} htmlFor="evidence-to">
        <TextInput id="evidence-to" type="date" className="w-[170px]" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </Field>
    </fieldset>
  );
}
