import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, TextInput } from "@mezan/ui";
import { MODULE_CATALOG, QuotaKind, isSubModule, normaliseModules } from "@mezan/domain";
import type {
  PlanCreateRequestDTO,
  PlanDTO,
  PlanKindDTO,
  PlanQuotasDTO,
  PlanUpdateRequestDTO,
  QuotaKindDTO,
} from "@mezan/contracts";
import {
  FormColumns,
  FormError,
  FormPage,
  MultiChipField,
  NumberField,
  SectionCard,
  TextField,
  ToggleField,
} from "../settings/form-controls";
import { hrPartOptions, platformModuleOptions } from "./module-options";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";
import { PLANS_QUERY_KEY, usePlansQuery, useRetirePlan } from "./PlansPage";

/** Wire format for a plan price (`positiveDecimalString`, packages/contracts/src/platform.ts). */
const PRICE_PATTERN = /^\d+(\.\d{1,6})?$/;

/** The quotas the console can edit. Mirrors `QuotaKind`; a key left out is unlimited. */
const QUOTA_FIELDS: ReadonlyArray<{ readonly kind: QuotaKindDTO; readonly label: AppTranslationKey; readonly hint?: AppTranslationKey; readonly zeroIsUnlimited?: boolean }> = [
  { kind: "sales_invoices_per_month", label: "platform.plans.editor.field.quotaSalesInvoices" },
  { kind: QuotaKind.StorageMb, label: "platform.plans.editor.field.quotaStorageMb", hint: "platform.plans.editor.field.quotaStorageMbHint", zeroIsUnlimited: true },
];

const PLANS_PATH = "/platform/plans";

const FREE: PlanKindDTO = "free";
const PAID: PlanKindDTO = "paid";

interface Draft {
  code: string;
  nameAr: string;
  nameEn: string;
  modules: string[];
  seatsIncluded: number;
  branchesIncluded: number;
  warehousesIncluded: number;
  priceMonthly: string;
  priceYearly: string;
  trialDays: number;
  isPublic: boolean;
  soldOut: boolean;
  sortOrder: number;
  kind: PlanKindDTO;
  quotas: PlanQuotasDTO;
}

function blankDraft(): Draft {
  return {
    code: "",
    nameAr: "",
    nameEn: "",
    modules: [],
    seatsIncluded: 1,
    branchesIncluded: 1,
    warehousesIncluded: 1,
    priceMonthly: "",
    priceYearly: "",
    trialDays: 0,
    isPublic: true,
    soldOut: false,
    sortOrder: 0,
    kind: PAID,
    quotas: {},
  };
}

function draftOf(plan: PlanDTO): Draft {
  return {
    code: plan.code,
    nameAr: plan.nameAr,
    nameEn: plan.nameEn,
    modules: [...plan.modules],
    seatsIncluded: plan.seatsIncluded,
    branchesIncluded: plan.branchesIncluded,
    warehousesIncluded: plan.warehousesIncluded,
    priceMonthly: plan.priceMonthly,
    priceYearly: plan.priceYearly,
    trialDays: plan.trialDays,
    isPublic: plan.isPublic,
    soldOut: plan.soldOut ?? false,
    sortOrder: plan.sortOrder,
    kind: plan.kind,
    quotas: { ...plan.quotas },
  };
}

function validate(draft: Draft, isNew: boolean): AppTranslationKey | null {
  if (isNew && !/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(draft.code.trim())) {
    return "platform.plans.editor.codeInvalid";
  }
  if (draft.nameAr.trim() === "" || draft.nameEn.trim() === "") return "platform.plans.editor.nameRequired";
  if (draft.modules.length === 0) return "platform.plans.editor.modulesRequired";
  if (!PRICE_PATTERN.test(draft.priceMonthly) || !PRICE_PATTERN.test(draft.priceYearly)) {
    return "platform.plans.editor.priceRequired";
  }
  // The domain refuses these too; saying so here spares a round trip that
  // comes back with a reason the form cannot point at a field.
  if (draft.kind === FREE && (Number(draft.priceMonthly) !== 0 || Number(draft.priceYearly) !== 0)) {
    return "platform.plans.editor.freeMustBeZero";
  }
  if (draft.kind === FREE && draft.trialDays !== 0) return "platform.plans.editor.freeHasNoTrial";
  return null;
}

function useCreatePlan() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<PlanDTO, PlatformApiError, PlanCreateRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/plans", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.plans.editor.saveFailed"));
      }
      return res.json<PlanDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
    },
  });
}

function useUpdatePlan() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<PlanDTO, PlatformApiError, { id: string; body: PlanUpdateRequestDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/plans/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) {
        throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.plans.editor.saveFailed"));
      }
      return res.json<PlanDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PLANS_QUERY_KEY });
    },
  });
}

export function PlanEditor() {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editingId = id && id !== "new" ? id : null;
  const [searchParams] = useSearchParams();
  const copyFromId = editingId === null ? searchParams.get("from") : null;
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";

  const plansQuery = usePlansQuery();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const retirePlan = useRetirePlan();

  const plan = editingId ? (plansQuery.data?.find((p) => p.id === editingId) ?? null) : null;
  const copySource = copyFromId ? (plansQuery.data?.find((p) => p.id === copyFromId) ?? null) : null;
  const notFound = editingId !== null && !plansQuery.isLoading && !plan;

  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const seededRef = useRef(false);
  const priceMonthlyId = useId();
  const priceYearlyId = useId();

  /** A different `editingId` (a fresh navigation between two plans' editors, or in from "new") starts a fresh, unseeded draft — otherwise the previous plan's fields would linger. */
  useEffect(() => {
    seededRef.current = false;
    setDraft(blankDraft());
  }, [editingId, copyFromId]);

  useEffect(() => {
    if (seededRef.current) return;
    if (plan) {
      setDraft(draftOf(plan));
      seededRef.current = true;
    } else if (copySource) {
      setDraft({ ...draftOf(copySource), code: "", isPublic: false });
      seededRef.current = true;
    }
  }, [plan, copySource]);

  async function handleSubmit() {
    setFormError(null);
    const error = validate(draft, editingId === null);
    if (error) {
      setFormError(t(error));
      return;
    }
    const shared = {
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim(),
      modules: normaliseModules(draft.modules),
      seatsIncluded: draft.seatsIncluded,
      branchesIncluded: draft.branchesIncluded,
      warehousesIncluded: draft.warehousesIncluded,
      priceMonthly: draft.priceMonthly,
      priceYearly: draft.priceYearly,
      trialDays: draft.trialDays,
      isPublic: draft.isPublic,
      soldOut: draft.soldOut,
      sortOrder: draft.sortOrder,
      kind: draft.kind,
      quotas: draft.quotas,
    };
    try {
      if (editingId) {
        await updatePlan.mutateAsync({ id: editingId, body: shared });
      } else {
        await createPlan.mutateAsync({ code: draft.code.trim(), ...shared });
      }
      navigate(PLANS_PATH);
    } catch (err) {
      setFormError(err instanceof PlatformApiError ? err.message : t("platform.plans.editor.saveFailed"));
    }
  }

  async function handleRetire() {
    if (!editingId) return;
    try {
      await retirePlan.mutateAsync(editingId);
      navigate(PLANS_PATH);
    } catch (err) {
      setFormError(err instanceof PlatformApiError ? err.message : t("platform.plans.retireFailed"));
    }
  }

  if (notFound) {
    return (
      <FormPage eyebrow={t("platform.nav.plans")} title={t("platform.plans.editor.editTitle")} actions={<Button onClick={() => navigate(PLANS_PATH)}>{t("common.cancel")}</Button>}>
        <FormError message={t("platform.plans.editor.loadFailed")} />
      </FormPage>
    );
  }

  const saving = createPlan.isPending || updatePlan.isPending;
  const readOnly = !isOwner || (copyFromId !== null && plansQuery.isLoading);

  return (
    <FormPage
      eyebrow={t("platform.nav.plans")}
      title={editingId ? t("platform.plans.editor.editTitle") : copySource ? t("platform.plans.editor.duplicateTitle") : t("platform.plans.editor.newTitle")}
      actions={
        <>
          <Button type="button" onClick={() => navigate(PLANS_PATH)}>
            {t("common.cancel")}
          </Button>
          {!readOnly && editingId && plan?.status === "active" ? (
            <Button type="button" variant="danger-outline" disabled={retirePlan.isPending} onClick={() => void handleRetire()}>
              {retirePlan.isPending ? t("platform.plans.retiring") : t("platform.plans.retire")}
            </Button>
          ) : null}
          {!readOnly ? (
            <Button type="button" variant="primary" disabled={saving} onClick={() => void handleSubmit()}>
              {saving ? t("platform.plans.editor.saving") : t("common.save")}
            </Button>
          ) : null}
        </>
      }
    >
      <FormError message={formError} />

      <FormColumns
        aside={
          <SectionCard title={t("platform.plans.editor.section.pricing")} columns={1}>
            <Field label={t("platform.plans.editor.field.priceMonthly")} htmlFor={priceMonthlyId}>
              <TextInput
                id={priceMonthlyId}
                dir="ltr"
                numeric
                inputMode="decimal"
                value={draft.priceMonthly}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, priceMonthly: e.target.value }))}
              />
            </Field>
            <Field label={t("platform.plans.editor.field.priceYearly")} htmlFor={priceYearlyId}>
              <TextInput
                id={priceYearlyId}
                dir="ltr"
                numeric
                inputMode="decimal"
                value={draft.priceYearly}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, priceYearly: e.target.value }))}
              />
            </Field>
            <NumberField
              label={t("platform.plans.editor.field.trialDays")}
              value={draft.trialDays}
              min={0}
              disabled={readOnly}
              onChange={(v) => setDraft((d) => ({ ...d, trialDays: v }))}
            />
            <NumberField
              label={t("platform.plans.editor.field.sortOrder")}
              value={draft.sortOrder}
              disabled={readOnly}
              onChange={(v) => setDraft((d) => ({ ...d, sortOrder: v }))}
            />
            <ToggleField
              label={t("platform.plans.editor.field.public")}
              checked={draft.isPublic}
              disabled={readOnly}
              onChange={(v) => setDraft((d) => ({ ...d, isPublic: v }))}
            />
            <ToggleField
              label={t("platform.plans.editor.field.soldOut")}
              hint={t("platform.plans.editor.field.soldOutHint")}
              checked={draft.soldOut}
              disabled={readOnly}
              onChange={(v) => setDraft((d) => ({ ...d, soldOut: v }))}
            />
            <ToggleField
              label={t("platform.plans.editor.field.free")}
              checked={draft.kind === FREE}
              disabled={readOnly}
              onChange={(v) =>
                setDraft((d) =>
                  v
                    ? { ...d, kind: FREE, priceMonthly: "0", priceYearly: "0", trialDays: 0 }
                    : { ...d, kind: PAID },
                )
              }
            />
          </SectionCard>
        }
      >
        <SectionCard title={t("platform.plans.editor.section.details")}>
          <TextField
            label={t("platform.plans.editor.field.code")}
            value={draft.code}
            hint={t("platform.plans.editor.field.codeHint")}
            disabled={readOnly || editingId !== null}
            onChange={(v) => setDraft((d) => ({ ...d, code: v.trim().toLowerCase() }))}
          />
          <TextField
            label={t("platform.plans.editor.field.nameAr")}
            value={draft.nameAr}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))}
          />
          <TextField
            label={t("platform.plans.editor.field.nameEn")}
            value={draft.nameEn}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))}
          />
        </SectionCard>

        <SectionCard title={t("platform.plans.editor.section.capacity")}>
          <NumberField
            label={t("platform.plans.editor.field.seats")}
            value={draft.seatsIncluded}
            min={1}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, seatsIncluded: v }))}
          />
          <NumberField
            label={t("platform.plans.editor.field.branches")}
            value={draft.branchesIncluded}
            min={1}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, branchesIncluded: v }))}
          />
          <NumberField
            label={t("platform.plans.editor.field.warehouses")}
            value={draft.warehousesIncluded}
            min={1}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, warehousesIncluded: v }))}
          />
        </SectionCard>

        <SectionCard title={t("platform.plans.editor.section.quotas")}>
          {QUOTA_FIELDS.map((q) => (
            <NumberField
              key={q.kind}
              label={t(q.label)}
              {...(q.hint ? { hint: t(q.hint) } : {})}
              value={draft.quotas[q.kind] ?? 0}
              min={0}
              disabled={readOnly}
              onChange={(v) =>
                setDraft((d) => {
                  const quotas = { ...d.quotas, [q.kind]: v };
                  if (q.zeroIsUnlimited && v === 0) delete quotas[q.kind];
                  return { ...d, quotas };
                })
              }
            />
          ))}
        </SectionCard>

        <SectionCard title={t("platform.plans.editor.field.modules")} columns={1}>
          <MultiChipField
            label={t("platform.plans.editor.field.modules")}
            options={platformModuleOptions(t)}
            value={draft.modules}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, modules: v }))}
          />
          {draft.modules.includes("hr") ? (
            <p className="text-[12px] text-ink-muted">{t("platform.plans.editor.hrAllParts")}</p>
          ) : (
            <MultiChipField
              label={t("platform.plans.editor.field.hrParts")}
              options={hrPartOptions()}
              value={draft.modules.filter((id) => isSubModule(id))}
              disabled={readOnly}
              onChange={(parts) => setDraft((d) => ({ ...d, modules: [...d.modules.filter((id) => !isSubModule(id)), ...parts] }))}
            />
          )}
          <p className="text-[12px] text-ink-muted">{t("platform.plans.editor.hrPeopleFree")}</p>
          {!readOnly ? (
            <div className="flex flex-wrap gap-[8px]">
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, modules: [...MODULE_CATALOG] }))}>
                {t("platform.modules.selectAll")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, modules: [] }))}>
                {t("platform.modules.clearAll")}
              </Button>
            </div>
          ) : null}
        </SectionCard>
      </FormColumns>
    </FormPage>
  );
}
