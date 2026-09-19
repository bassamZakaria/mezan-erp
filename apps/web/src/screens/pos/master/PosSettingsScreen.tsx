import { useState } from "react";
import { Button, Card, EmptyState, IconButton, TextInput } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { PosSettingsDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { FormColumns, FormError, FormPage, NumberField, SectionCard, TextField, ToggleField } from "../../../settings/form-controls";
import { useAppTranslation } from "../../../i18n";
import { useEntityName } from "../../../lib/entity-names";
import { usePosSettings, usePosWalkInCustomer, useUpdatePosSettings } from "./hooks";

interface MealDraft {
  readonly key: string;
  readonly id: string | null;
  readonly name: string;
}

interface Draft {
  receiptScreenSeconds: number;
  allowArCollection: boolean;
  pricesIncludeTax: boolean;
  cashierPercent: string;
  cashierAmount: string;
  managerPercent: string;
  managerAmount: string;
  approvalExpiryMinutes: number;
  mealSections: MealDraft[];
}

/** "50.000000" → "50", "12.500000" → "12.5": the wire's six decimals, trimmed for typing — no float in between. */
function trimAmount(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function draftFrom(settings: PosSettingsDTO): Draft {
  return {
    receiptScreenSeconds: settings.receiptScreenSeconds,
    allowArCollection: settings.allowArCollection,
    pricesIncludeTax: settings.pricesIncludeTax,
    cashierPercent: settings.cashierDiscountLimit.percent,
    cashierAmount: trimAmount(settings.cashierDiscountLimit.amount),
    managerPercent: settings.managerDiscountLimit.percent,
    managerAmount: trimAmount(settings.managerDiscountLimit.amount),
    approvalExpiryMinutes: settings.approvalExpiryMinutes,
    mealSections: settings.mealSections.map((s) => ({ key: s.id, id: s.id, name: s.name })),
  };
}

export function PosSettingsScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(auth, "pos.terminal.view");
  const mayEdit = can(auth, "pos.settings.edit");
  const query = usePosSettings();

  if (!mayView) return <EmptyState title={t("pos.common.noAccessTitle")} description={t("pos.common.noAccessBody")} />;
  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("pos.common.loadFailed")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  if (!query.data) return <p className="p-6 text-sm text-ink-muted">{t("common.loading")}</p>;
  return <SettingsForm settings={query.data} mayEdit={mayEdit} />;
}

function SettingsForm({ settings, mayEdit }: { settings: PosSettingsDTO; mayEdit: boolean }) {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const update = useUpdatePosSettings();
  const walkIn = usePosWalkInCustomer(settings.walkInCustomerId).data;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(settings));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [nextKey, setNextKey] = useState(1);
  const readOnly = !mayEdit;

  function patch(next: Partial<Draft>) {
    setSaved(false);
    setDraft((d) => ({ ...d, ...next }));
  }

  async function submit() {
    setError(null);
    try {
      await update.mutateAsync({
        receiptScreenSeconds: draft.receiptScreenSeconds,
        allowArCollection: draft.allowArCollection,
        pricesIncludeTax: draft.pricesIncludeTax,
        cashierDiscountLimit: { percent: draft.cashierPercent.trim(), amount: draft.cashierAmount.trim() },
        managerDiscountLimit: { percent: draft.managerPercent.trim(), amount: draft.managerAmount.trim() },
        approvalExpiryMinutes: draft.approvalExpiryMinutes,
        mealSections: draft.mealSections.filter((s) => s.name.trim() !== "").map((s) => ({ id: s.id, name: s.name.trim() })),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pos.common.saveFailed"));
    }
  }

  return (
    <FormPage
      eyebrow={t("nav.group.pos")}
      title={t("pos.settings.title")}
      description={mayEdit ? t("pos.settings.description") : t("pos.settings.readOnly")}
      actions={
        mayEdit ? (
          <>
            {saved ? <span className="text-[12px] font-semibold text-success-ink">{t("pos.common.saved")}</span> : null}
            <Button variant="primary" onClick={() => void submit()} disabled={update.isPending}>
              {t("pos.settings.save")}
            </Button>
          </>
        ) : undefined
      }
    >
      <FormError message={error} />
      <FormColumns
        aside={
          <>
            <SectionCard title={t("pos.settings.section.walkIn")} columns={1}>
              <p className="text-[12.5px] text-ink">
                {t("pos.settings.walkInBody", { name: walkIn ? nameOf(walkIn) : settings.walkInCustomerId })}
              </p>
            </SectionCard>
            <SectionCard title={t("pos.settings.section.meals")} description={t("pos.settings.section.mealsHint")} columns={1}>
              {draft.mealSections.length === 0 ? <p className="text-[12px] text-ink-muted">{t("pos.settings.meal.empty")}</p> : null}
              <ul className="flex flex-col gap-[8px]">
                {draft.mealSections.map((section) => (
                  <li key={section.key} className="flex items-center gap-[8px]">
                    <TextInput
                      value={section.name}
                      disabled={readOnly}
                      placeholder={t("pos.settings.meal.placeholder")}
                      aria-label={t("pos.settings.section.meals")}
                      onChange={(e) =>
                        patch({ mealSections: draft.mealSections.map((s) => (s.key === section.key ? { ...s, name: e.target.value } : s)) })
                      }
                    />
                    {mayEdit ? (
                      <IconButton
                        aria-label={t("pos.settings.meal.remove", { name: section.name })}
                        onClick={() => patch({ mealSections: draft.mealSections.filter((s) => s.key !== section.key) })}
                      >
                        ×
                      </IconButton>
                    ) : null}
                  </li>
                ))}
              </ul>
              {mayEdit ? (
                <Button
                  size="sm"
                  onClick={() => {
                    patch({ mealSections: [...draft.mealSections, { key: `new-${nextKey}`, id: null, name: "" }] });
                    setNextKey((k) => k + 1);
                  }}
                >
                  {t("pos.settings.meal.add")}
                </Button>
              ) : null}
            </SectionCard>
          </>
        }
      >
        <SectionCard title={t("pos.settings.section.till")} columns={1}>
          <NumberField
            label={t("pos.settings.field.receiptSeconds")}
            hint={t("pos.settings.field.receiptSecondsHint")}
            value={draft.receiptScreenSeconds}
            min={0}
            max={600}
            disabled={readOnly}
            onChange={(v) => patch({ receiptScreenSeconds: Number.isNaN(v) ? 0 : Math.trunc(v) })}
          />
          <ToggleField
            label={t("pos.settings.field.allowAr")}
            hint={t("pos.settings.field.allowArHint")}
            checked={draft.allowArCollection}
            disabled={readOnly}
            onChange={(v) => patch({ allowArCollection: v })}
          />
          <ToggleField
            label={t("pos.settings.field.taxInclusive")}
            hint={t("pos.settings.field.taxInclusiveHint")}
            checked={draft.pricesIncludeTax}
            disabled={readOnly}
            onChange={(v) => patch({ pricesIncludeTax: v })}
          />
        </SectionCard>

        <SectionCard title={t("pos.settings.section.discounts")} description={t("pos.settings.section.discountsHint")}>
          <TextField
            label={t("pos.settings.field.cashierPercent")}
            value={draft.cashierPercent}
            disabled={readOnly}
            onChange={(v) => patch({ cashierPercent: v })}
          />
          <TextField
            label={t("pos.settings.field.cashierAmount")}
            value={draft.cashierAmount}
            disabled={readOnly}
            onChange={(v) => patch({ cashierAmount: v })}
          />
          <TextField
            label={t("pos.settings.field.managerPercent")}
            hint={t("pos.settings.field.managerHint")}
            value={draft.managerPercent}
            disabled={readOnly}
            onChange={(v) => patch({ managerPercent: v })}
          />
          <TextField
            label={t("pos.settings.field.managerAmount")}
            value={draft.managerAmount}
            disabled={readOnly}
            onChange={(v) => patch({ managerAmount: v })}
          />
          <NumberField
            label={t("pos.settings.field.approvalExpiry")}
            value={draft.approvalExpiryMinutes}
            min={1}
            max={60}
            disabled={readOnly}
            onChange={(v) => patch({ approvalExpiryMinutes: Number.isNaN(v) ? 1 : Math.trunc(v) })}
          />
        </SectionCard>
      </FormColumns>
    </FormPage>
  );
}
