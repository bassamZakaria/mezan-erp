import { useState, type FormEvent } from "react";
import { Button, Card, DocumentList, IconButton, SidePanel, StatusPill, type DocumentListColumn } from "@mezan/ui";
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
import { ACCRUAL_FREQUENCY_LABEL, formatDays, LEAVE_TYPE_LABEL, LEAVE_TYPE_OPTIONS } from "./hr-leave-labels";

/** سياسات الإجازات (Leave Policies) — docs/catalog/06 §"سياسات الإجازات" (`/settings/leave-policies`). The matrix starts empty; the two dated Egyptian Labour Law presets fill it in one action. */

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

const FREQUENCY_OPTIONS = (Object.keys(ACCRUAL_FREQUENCY_LABEL) as LeaveAccrualFrequencyDTO[]).map((code) => ({
  value: code,
  label: ACCRUAL_FREQUENCY_LABEL[code],
}));

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

export function LeavePoliciesScreen() {
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
  const [banner, setBanner] = useState<string | null>(null);

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
      setBanner(`تم تطبيق الإعداد "${presets.find((p) => p.code === presetCode)?.labelAr ?? presetCode}".`);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "تعذّر تطبيق الإعداد الجاهز.");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.entitlementDays.trim() === "") {
      setFormError("الرصيد الأساسي مطلوب.");
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
      setFormError(err instanceof ApiError ? err.message : "تعذّرت العملية.");
    }
  }

  async function handleDelete(policy: LeavePolicyDTO) {
    if (deletingId) return;
    setDeletingId(policy.id);
    setRowError(null);
    try {
      await deletePolicy.mutateAsync(policy.id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "تعذّر حذف السياسة.");
    } finally {
      setDeletingId(null);
    }
  }

  const columns: DocumentListColumn<LeavePolicyDTO>[] = [
    { key: "leaveType", header: "نوع الإجازة", render: (p) => <span className="font-semibold text-ink">{LEAVE_TYPE_LABEL[p.leaveType]}</span> },
    { key: "entitlement", header: "الرصيد الأساسي", align: "end", render: (p) => <span className="mz-num text-ink">{formatDays(p.entitlementDays)}</span> },
    { key: "accrual", header: "وتيرة الاستحقاق", render: (p) => <span className="text-ink">{ACCRUAL_FREQUENCY_LABEL[p.accrualFrequency]}</span> },
    {
      key: "carryOver",
      header: "الترحيل",
      render: (p) => (
        <span className="text-ink">
          {p.carryOver ? (p.maxCarryOverDays === null ? "نعم" : `حتى ${formatDays(p.maxCarryOverDays)} يوم`) : "لا"}
        </span>
      ),
    },
    { key: "payout", header: "صرف عند الإنهاء", render: (p) => <span className="text-ink">{p.payoutOnTermination ? "نعم" : "لا"}</span> },
    {
      key: "mandated",
      header: "إجباري قانوناً",
      render: (p) => <StatusPill label={p.legallyMandated ? "إجباري" : "اختياري"} tone={p.legallyMandated ? "info" : "neutral"} />,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (p) => (
        <div className="flex items-center justify-end gap-[6px]">
          <IconButton aria-label={`تعديل ${LEAVE_TYPE_LABEL[p.leaveType]}`} onClick={() => openEdit(p)}>
            <EditIcon />
          </IconButton>
          <IconButton aria-label={`حذف ${LEAVE_TYPE_LABEL[p.leaveType]}`} disabled={deletingId !== null} onClick={() => handleDelete(p)}>
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل سياسات الإجازات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
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
        <p className="text-[13px] font-semibold text-ink">تطبيق إعداد جاهز</p>
        <p className="mt-[4px] text-[12.5px] text-ink-muted">
          الإعدادات الجاهزة تمثّل قوانين العمل المصرية بتواريخ نفاذها؛ يمكن تعديل أي صف بعد التطبيق.
        </p>
        <div className="mt-[10px] flex flex-wrap items-end gap-[10px]">
          <div className="min-w-[240px]">
            <SelectField
              label="الإعداد"
              value={presetCode}
              onChange={setPresetCode}
              options={[{ value: "", label: "اختر إعداداً..." }, ...presets.map((p) => ({ value: p.code, label: p.labelAr }))]}
            />
          </div>
          <Button variant="primary" disabled={presetCode === ""} onClick={handleApplyPreset}>
            تطبيق إعداد جاهز
          </Button>
        </div>
      </Card>

      <DocumentList<LeavePolicyDTO>
        eyebrow="HR · Leave Policies"
        title="سياسات الإجازات"
        description="مصفوفة أنواع الإجازات: الرصيد الأساسي، وتيرة الاستحقاق، الترحيل، الصرف عند الإنهاء"
        actions={
          <Button variant="primary" onClick={openCreate}>
            إضافة سياسة
          </Button>
        }
        stats={[
          { label: "عدد السياسات", value: <span className="mz-num">{policies.length}</span> },
          { label: "إجباري قانوناً", value: <span className="mz-num">{policies.filter((p) => p.legallyMandated).length}</span> },
          { label: "قابلة للترحيل", value: <span className="mz-num">{policies.filter((p) => p.carryOver).length}</span> },
        ]}
        columns={columns}
        rows={policies}
        rowKey={(p) => p.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{policies.length}</span> سياسة
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            لا توجد سياسات إجازات معدة حالياً. استخدم &quot;تطبيق إعداد جاهز&quot; للبدء بسرعة، أو أضف كل سياسة يدوياً.
          </div>
        }
      />

      <SidePanel
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingId(null);
        }}
        title={editingId ? "تعديل سياسة الإجازة" : "إضافة سياسة إجازة"}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <SelectField
            label="نوع الإجازة *"
            value={draft.leaveType}
            onChange={(v) => setDraft((d) => ({ ...d, leaveType: v as LeaveTypeDTO }))}
            options={LEAVE_TYPE_OPTIONS}
            disabled={editingId !== null}
          />
          <TextField
            label="الرصيد الأساسي (أيام/سنة) *"
            value={draft.entitlementDays}
            onChange={(v) => setDraft((d) => ({ ...d, entitlementDays: v }))}
            placeholder="21"
          />
          <SelectField
            label="وتيرة الاستحقاق *"
            value={draft.accrualFrequency}
            onChange={(v) => setDraft((d) => ({ ...d, accrualFrequency: v as LeaveAccrualFrequencyDTO }))}
            options={FREQUENCY_OPTIONS}
          />
          <ToggleField label="ترحيل الرصيد للسنة التالية" checked={draft.carryOver} onChange={(v) => setDraft((d) => ({ ...d, carryOver: v }))} />
          {draft.carryOver ? (
            <TextField
              label="حد الترحيل (أيام)"
              value={draft.maxCarryOverDays}
              onChange={(v) => setDraft((d) => ({ ...d, maxCarryOverDays: v }))}
              hint="اتركه فارغاً لترحيل بدون حد"
            />
          ) : null}
          <ToggleField
            label="صرف الرصيد عند إنهاء الخدمة"
            checked={draft.payoutOnTermination}
            onChange={(v) => setDraft((d) => ({ ...d, payoutOnTermination: v }))}
          />
          <ToggleField label="إجباري قانوناً" checked={draft.legallyMandated} onChange={(v) => setDraft((d) => ({ ...d, legallyMandated: v }))} />
          {editingId ? <ToggleField label="مفعّلة" checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} /> : null}
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? "حفظ التعديلات" : "إضافة"}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
