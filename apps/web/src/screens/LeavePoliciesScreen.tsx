import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, EmptyState, IconButton, SidePanel, StatusPill, type DocumentListColumn } from "@mezan/ui";
import type { LeaveAccrualFrequencyDTO, LeavePolicyDTO, LeaveTypeDTO } from "@mezan/contracts";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import {
  ApiError,
  useApplyLeavePolicyPreset,
  useCreateLeavePolicy,
  useDeleteLeavePolicy,
  useLeavePolicies,
  useLeavePolicyPresets,
  useUpdateLeavePolicy,
} from "../data/hooks";
import { useConfirmAction } from "../lib/use-confirm-action";
import { ACCRUAL_FREQUENCY_KEY, formatDays, LEAVE_TYPE_KEY, leaveTypeOptions } from "./hr-leave-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** سياسات الإجازات (Leave Policies) — docs/archive/catalog/06 §"سياسات الإجازات" (`/settings/leave-policies`). The matrix starts empty; the two dated Egyptian Labour Law presets fill it in one action. */

interface PolicyDraft {
  leaveType: LeaveTypeDTO;
  entitlementDays: string;
  accrualFrequency: LeaveAccrualFrequencyDTO;
  carryOver: boolean;
  maxCarryOverDays: string;
  payoutOnTermination: boolean;
  legallyMandated: boolean;
  active: boolean;
}

function blankDraft(): PolicyDraft {
  return {
    leaveType: "annual",
    entitlementDays: "0",
    accrualFrequency: "annual",
    carryOver: false,
    maxCarryOverDays: "",
    payoutOnTermination: false,
    legallyMandated: false,
    active: true,
  };
}

function frequencyOptions(t: (key: AppTranslationKey) => string) {
  return (Object.keys(ACCRUAL_FREQUENCY_KEY) as LeaveAccrualFrequencyDTO[]).map((code) => ({
    value: code,
    label: t(ACCRUAL_FREQUENCY_KEY[code]),
  }));
}

function TrashIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9a1 1 0 0 0 1 .9h5.8a1 1 0 0 0 1-.9l.6-9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
      <path d="M13.5 3.5 16 6l-8.5 8.5H5V12L13.5 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function LeavePoliciesScreen() {
  const { t } = useAppTranslation();
  const query = useLeavePolicies();
  const presetsQuery = useLeavePolicyPresets();
  const createPolicy = useCreateLeavePolicy();
  const updatePolicy = useUpdateLeavePolicy();
  const deletePolicy = useDeleteLeavePolicy();
  const applyPreset = useApplyLeavePolicyPreset();

  const policies = query.data ?? [];
  const presets = presetsQuery.data ?? [];

  const [presetCode, setPresetCode] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PolicyDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const [banner, setBanner] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const pageCount = Math.max(1, Math.ceil(policies.length / pageSize));
  const pageRows = policies.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  function openCreate() {
    setEditingId(null);
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(policy: LeavePolicyDTO) {
    setEditingId(policy.id);
    setDraft({
      leaveType: policy.leaveType,
      entitlementDays: formatDays(policy.entitlementDays),
      accrualFrequency: policy.accrualFrequency,
      carryOver: policy.carryOver,
      maxCarryOverDays: policy.maxCarryOverDays === null ? "" : formatDays(policy.maxCarryOverDays),
      payoutOnTermination: policy.payoutOnTermination,
      legallyMandated: policy.legallyMandated,
      active: policy.active,
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleApplyPreset() {
    if (presetCode === "") return;
    setRowError(null);
    try {
      await applyPreset.mutateAsync(presetCode);
      setBanner(t("leavePolicies.presetApplied", { preset: presets.find((p) => p.code === presetCode)?.labelAr ?? presetCode }));
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("leavePolicies.thePresetCouldNotBe"));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.entitlementDays.trim() === "") {
      setFormError(t("leavePolicies.aBaseEntitlementIsRequired"));
      return;
    }
    setFormError(null);
    const maxCarryOverDays = draft.carryOver && draft.maxCarryOverDays.trim() !== "" ? draft.maxCarryOverDays.trim() : null;
    try {
      if (editingId) {
        await updatePolicy.mutateAsync({
          id: editingId,
          body: {
            entitlementDays: draft.entitlementDays.trim(),
            accrualFrequency: draft.accrualFrequency,
            carryOver: draft.carryOver,
            maxCarryOverDays,
            payoutOnTermination: draft.payoutOnTermination,
            legallyMandated: draft.legallyMandated,
            active: draft.active,
          },
        });
      } else {
        await createPolicy.mutateAsync({
          leaveType: draft.leaveType,
          entitlementDays: draft.entitlementDays.trim(),
          accrualFrequency: draft.accrualFrequency,
          carryOver: draft.carryOver,
          maxCarryOverDays,
          payoutOnTermination: draft.payoutOnTermination,
          legallyMandated: draft.legallyMandated,
        });
      }
      setFormOpen(false);
      setEditingId(null);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("common.failed"));
    }
  }

  async function handleDelete(policy: LeavePolicyDTO) {
    if (deletingId) return;
    setDeletingId(policy.id);
    setRowError(null);
    try {
      await deletePolicy.mutateAsync(policy.id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("leavePolicies.thePolicyCouldNotBe"));
    } finally {
      setDeletingId(null);
    }
  }

  const columns: DocumentListColumn<LeavePolicyDTO>[] = [
    { key: "leaveType", header: t("leavePolicies.leaveType"), render: (p) => <span className="font-semibold text-ink">{t(LEAVE_TYPE_KEY[p.leaveType])}</span> },
    { key: "entitlement", header: t("leavePolicies.baseEntitlement"), align: "end", render: (p) => <span className="mz-num text-ink">{formatDays(p.entitlementDays)}</span> },
    { key: "accrual", header: t("leavePolicies.accrualFrequency"), render: (p) => <span className="text-ink">{t(ACCRUAL_FREQUENCY_KEY[p.accrualFrequency])}</span> },
    {
      key: "carryOver",
      header: t("leavePolicies.carryOver"),
      render: (p) => (
        <span className="text-ink">
          {p.carryOver ? (p.maxCarryOverDays === null ? t("leavePolicies.yes") : t("leavePolicies.carryOverUpTo", { days: formatDays(p.maxCarryOverDays) })) : t("leavePolicies.no")}
        </span>
      ),
    },
    { key: "payout", header: t("leavePolicies.paidOutOnTermination"), render: (p) => <span className="text-ink">{p.payoutOnTermination ? t("leavePolicies.yes") : t("leavePolicies.no")}</span> },
    {
      key: "mandated",
      header: t("leavePolicies.requiredByLaw"),
      render: (p) => <StatusPill label={p.legallyMandated ? t("leavePolicies.mandatory") : t("leavePolicies.optional")} tone={p.legallyMandated ? "info" : "neutral"} />,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (p) => (
        <div className="flex items-center justify-end gap-[6px]">
          <IconButton aria-label={t("leavePolicies.editLabel", { name: t(LEAVE_TYPE_KEY[p.leaveType]) })} onClick={() => openEdit(p)}>
            <EditIcon />
          </IconButton>
          <IconButton
            aria-label={t("leavePolicies.deleteLabel", { name: t(LEAVE_TYPE_KEY[p.leaveType]) })}
            disabled={deletingId === p.id}
            onClick={() =>
              confirm.ask({
                title: t("leavePolicies.confirmDeleteTitle"),
                consequence: t("leavePolicies.confirmDeleteBody", { name: t(LEAVE_TYPE_KEY[p.leaveType]) }),
                confirmLabel: t("common.delete"),
                onConfirm: () => handleDelete(p),
              })
            }
          >
            <TrashIcon />
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("leavePolicies.leavePoliciesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {rowError ? (
        <div role="alert" className="mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}
      {banner ? (
        <div role="status" className="mb-[14px] rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
          {banner}
        </div>
      ) : null}

      <Card className="mb-[18px] p-[16px_18px]">
        <p className="text-[13px] font-semibold text-ink">{t("leavePolicies.applyAPreset")}</p>
        <p className="mt-[4px] text-[12.5px] text-ink-muted">
          {t("leavePolicies.thePresetsReflectEgyptianLabour")}
        </p>
        <div className="mt-[10px] flex flex-wrap items-end gap-[10px]">
          <div className="min-w-[240px]">
            <SelectField
              label={t("leavePolicies.preset")}
              value={presetCode}
              onChange={setPresetCode}
              options={[{ value: "", label: t("leavePolicies.chooseAPreset") }, ...presets.map((p) => ({ value: p.code, label: p.labelAr }))]}
            />
          </div>
          <Button variant="primary" disabled={presetCode === ""} onClick={handleApplyPreset}>
            {t("leavePolicies.applyAPreset")}
          </Button>
        </div>
      </Card>

      <DocumentList<LeavePolicyDTO>
        title={t("leavePolicies.leavePolicies")}
        description={t("leavePolicies.theLeaveTypeMatrixBase")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("leavePolicies.addPolicy")}
          </Button>
        }
        listKey="leave-policies"
        statsCollapsible
        stats={[
          { label: t("leavePolicies.policies"), value: <span className="mz-num">{policies.length}</span> },
          { label: t("leavePolicies.requiredByLaw"), value: <span className="mz-num">{policies.filter((p) => p.legallyMandated).length}</span> },
          { label: t("leavePolicies.canCarryOver"), value: <span className="mz-num">{policies.filter((p) => p.carryOver).length}</span> },
        ]}
        columns={columns}
        rows={pageRows}
        loading={presetsQuery.isLoading}
        rowKey={(p) => p.id}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{policies.length}</span> {t("leavePolicies.policies2")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("leavePolicies.noLeavePoliciesAreSet")}
            description={t("leavePolicies.emptyBody")}
            action={{ label: t("leavePolicies.addPolicy"), onClick: openCreate }}
          />
        }
      />

      <SidePanel
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingId(null);
        }}
        title={editingId ? t("leavePolicies.editLeavePolicy") : t("leavePolicies.addLeavePolicy")}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <SelectField
            label={t("leavePolicies.leaveType2")}
            value={draft.leaveType}
            onChange={(v) => setDraft((d) => ({ ...d, leaveType: v as LeaveTypeDTO }))}
            options={leaveTypeOptions(t)}
            disabled={editingId !== null}
          />
          <TextField
            label={t("leavePolicies.baseEntitlementDaysYear")}
            value={draft.entitlementDays}
            onChange={(v) => setDraft((d) => ({ ...d, entitlementDays: v }))}
            placeholder="21"
          />
          <SelectField
            label={t("leavePolicies.accrualFrequency2")}
            value={draft.accrualFrequency}
            onChange={(v) => setDraft((d) => ({ ...d, accrualFrequency: v as LeaveAccrualFrequencyDTO }))}
            options={frequencyOptions(t)}
          />
          <ToggleField label={t("leavePolicies.carryTheBalanceIntoNext")} checked={draft.carryOver} onChange={(v) => setDraft((d) => ({ ...d, carryOver: v }))} />
          {draft.carryOver ? (
            <TextField
              label={t("leavePolicies.carryOverCapDays")}
              value={draft.maxCarryOverDays}
              onChange={(v) => setDraft((d) => ({ ...d, maxCarryOverDays: v }))}
              hint={t("leavePolicies.leaveEmptyToCarryOver")}
            />
          ) : null}
          <ToggleField
            label={t("leavePolicies.payTheBalanceOutOn")}
            checked={draft.payoutOnTermination}
            onChange={(v) => setDraft((d) => ({ ...d, payoutOnTermination: v }))}
          />
          <ToggleField label={t("leavePolicies.requiredByLaw")} checked={draft.legallyMandated} onChange={(v) => setDraft((d) => ({ ...d, legallyMandated: v }))} />
          {editingId ? <ToggleField label={t("leavePolicies.enabled")} checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} /> : null}
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? t("leavePolicies.saveChanges") : t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
      {confirm.dialog}
    </div>
  );
}
