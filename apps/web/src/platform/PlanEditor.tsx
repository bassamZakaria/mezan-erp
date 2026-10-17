import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, TextInput } from "@mezan/ui";
import { MODULE_CATALOG, MODULES, moduleName } from "@mezan/domain";
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
import { moduleLabel } from "../domain-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";
import { PLANS_QUERY_KEY, usePlansQuery, useRetirePlan } from "./PlansPage";

/** Wire format for a plan price (`positiveDecimalString`, packages/contracts/src/platform.ts). */
const PRICE_PATTERN = /^\d+(\.\d{1,6})?$/;

/** `MODULE_CATALOG` ids are entitlement ids; the permission catalog's `MODULES` keys its one differing entry as `cheques`. */
const CATALOG_MODULE_ID: Readonly<Record<string, string>> = { financial_papers: "cheques" };

function moduleOptions(t: (key: AppTranslationKey) => string) {
  return MODULE_CATALOG.map((id) => {
    const catalogId = CATALOG_MODULE_ID[id] ?? id;
    const entry = MODULES.find((m) => m.id === catalogId);
    return { value: id, label: entry ? moduleLabel(entry, t) : moduleName(id).ar };
  });
}

/** The quotas the console can edit. Mirrors `QuotaKind`; a key left out is unlimited. */
const QUOTA_FIELDS: ReadonlyArray<{ readonly kind: QuotaKindDTO; readonly label: AppTranslationKey }> = [
  { kind: "sales_invoices_per_month", label: "platform.plans.editor.field.quotaSalesInvoices" },
];

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
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";

  const plansQuery = usePlansQuery();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const retirePlan = useRetirePlan();

  const plan = editingId ? (plansQuery.data?.find((p) => p.id === editingId) ?? null) : null;
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
  }, [editingId]);

  useEffect(() => {
    if (seededRef.current) return;
    if (plan) {
      setDraft(draftOf(plan));
      seededRef.current = true;
    }
  }, [plan]);

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
      modules: draft.modules,
      seatsIncluded: draft.seatsIncluded,
      branchesIncluded: draft.branchesIncluded,
      warehousesIncluded: draft.warehousesIncluded,
      priceMonthly: draft.priceMonthly,
      priceYearly: draft.priceYearly,
      trialDays: draft.trialDays,
      isPublic: draft.isPublic,
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
      navigate("..");
    } catch (err) {
      setFormError(err instanceof PlatformApiError ? err.message : t("platform.plans.editor.saveFailed"));
    }
  }

  async function handleRetire() {
    if (!editingId) return;
    try {
      await retirePlan.mutateAsync(editingId);
      navigate("..");
    } catch (err) {
      setFormError(err instanceof PlatformApiError ? err.message : t("platform.plans.retireFailed"));
    }
  }

  if (notFound) {
    return (
      <FormPage eyebrow={t("platform.nav.plans")} title={t("platform.plans.editor.editTitle")} actions={<Button onClick={() => navigate("..")}>{t("common.cancel")}</Button>}>
        <FormError message={t("platform.plans.editor.loadFailed")} />
      </FormPage>
    );
  }

  const saving = createPlan.isPending || updatePlan.isPending;
  const readOnly = !isOwner;

  return (
    <FormPage
      eyebrow={t("platform.nav.plans")}
      title={editingId ? t("platform.plans.editor.editTitle") : t("platform.plans.editor.newTitle")}
      actions={
        <>
          <Button type="button" onClick={() => navigate("..")}>
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
              value={draft.quotas[q.kind] ?? 0}
              min={0}
              disabled={readOnly}
              onChange={(v) => setDraft((d) => ({ ...d, quotas: { ...d.quotas, [q.kind]: v } }))}
            />
          ))}
        </SectionCard>

        <SectionCard title={t("platform.plans.editor.field.modules")} columns={1}>
          <MultiChipField
            label={t("platform.plans.editor.field.modules")}
            options={moduleOptions(t)}
            value={draft.modules}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, modules: v }))}
          />
        </SectionCard>
      </FormColumns>
    </FormPage>
  );
}
