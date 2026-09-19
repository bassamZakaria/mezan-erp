import { auditFieldChangeSchema, type AuditEventDTO, type AuditFieldChangeDTO } from "@mezan/contracts";
import { useMemo } from "react";
import { AuditChangeAction } from "@mezan/domain";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { ar as fragmentAr } from "../nav/e1-05";

const FIELD_KEY_PREFIX = "auditLedger.fieldName.";

export const AUDIT_FIELD_NAMES: readonly string[] = Object.keys(fragmentAr)
  .filter((key) => key.startsWith(FIELD_KEY_PREFIX))
  .map((key) => key.slice(FIELD_KEY_PREFIX.length));

const changesSchema = auditFieldChangeSchema.array();

export function auditChangesOfEvent(event: AuditEventDTO): AuditFieldChangeDTO[] {
  const parsed = changesSchema.safeParse(event.details?.["changes"]);
  return parsed.success ? parsed.data : [];
}

const MONEY_LIKE = /^(-?\d+)\.(\d{6})$/;

function trimScale(value: string): string {
  const match = MONEY_LIKE.exec(value);
  if (!match) return value;
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return `${match[1]}.${fraction.padEnd(2, "0")}`;
}

export function useAuditLabels() {
  const { t } = useAppTranslation();
  return useMemo(() => buildAuditLabels(t), [t]);
}

function buildAuditLabels(t: ReturnType<typeof useAppTranslation>["t"]) {
  function fieldLabel(field: string): string {
    const key = `${FIELD_KEY_PREFIX}${field}`;
    return key in fragmentAr ? t(key as AppTranslationKey) : field;
  }

  function actionLabel(action: string): string {
    return (Object.values(AuditChangeAction) as string[]).includes(action)
      ? t(`auditLedger.action.${action}` as AppTranslationKey)
      : action;
  }

  function valueLabel(value: unknown): string {
    if (value === null || value === undefined || value === "") return t("auditLedger.empty");
    if (typeof value === "boolean") return value ? t("auditLedger.yes") : t("auditLedger.no");
    if (typeof value === "string") return trimScale(value);
    if (typeof value === "number") return String(value);
    return JSON.stringify(value);
  }

  function changeLine(change: AuditFieldChangeDTO): string {
    const name = change.key ? `${fieldLabel(change.field)} [${change.key}]` : fieldLabel(change.field);
    return `${name}: ${valueLabel(change.from)} ${t("auditLedger.arrow")} ${valueLabel(change.to)}`;
  }

  return { fieldLabel, actionLabel, valueLabel, changeLine };
}

export function ChangeSummary({ changes, max = 2 }: { changes: readonly AuditFieldChangeDTO[]; max?: number }) {
  const { t } = useAppTranslation();
  const labels = useAuditLabels();
  if (changes.length === 0) return <span className="text-ink-faint">—</span>;
  const shown = changes.slice(0, max);
  return (
    <span className="flex flex-col gap-[2px] text-[12px]">
      {shown.map((change, i) => (
        <span key={`${change.field}-${change.key ?? ""}-${i}`} className="text-ink-muted">
          <span className="font-semibold text-ink">{labels.fieldLabel(change.field)}</span>
          {change.key ? <span className="mz-num text-ink-faint"> [{change.key}]</span> : null}
          {": "}
          <span className="mz-num line-through decoration-ink-faint">{labels.valueLabel(change.from)}</span>
          {` ${t("auditLedger.arrow")} `}
          <span className="mz-num text-ink">{labels.valueLabel(change.to)}</span>
        </span>
      ))}
      {changes.length > max ? (
        <span className="text-ink-faint">{t("auditLedger.moreChanges", { count: changes.length - max })}</span>
      ) : null}
    </span>
  );
}

export function ChangesTable({ changes }: { changes: readonly AuditFieldChangeDTO[] }) {
  const { t } = useAppTranslation();
  const labels = useAuditLabels();
  if (changes.length === 0) {
    return <p className="text-[12.5px] text-ink-faint">{t("auditLedger.noFieldChanges")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[360px] border-collapse text-[12.5px]">
        <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
          <tr>
            <th className="px-[12px] py-[8px] text-start">{t("auditLedger.field")}</th>
            <th className="px-[12px] py-[8px] text-start">{t("auditLedger.before")}</th>
            <th className="px-[12px] py-[8px] text-start">{t("auditLedger.after")}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change, i) => (
            <tr key={`${change.field}-${change.key ?? ""}-${i}`} className="border-t border-border align-top">
              <td className="px-[12px] py-[8px] font-semibold text-ink">
                {labels.fieldLabel(change.field)}
                {change.key ? <div className="mz-num text-[11px] font-normal text-ink-faint">{change.key}</div> : null}
              </td>
              <td className="mz-num break-all px-[12px] py-[8px] text-ink-muted">{labels.valueLabel(change.from)}</td>
              <td className="mz-num break-all px-[12px] py-[8px] text-ink">{labels.valueLabel(change.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
