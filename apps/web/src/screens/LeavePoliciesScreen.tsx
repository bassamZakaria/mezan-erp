import { useState, type FormEvent } from "react";
import { Card, Button, SidePanel, StatusPill } from "@mezan/ui";
import type { LeaveAccrualFrequencyDTO, LeaveCarryoverPolicyDTO, LeavePolicySourceDTO, LeaveTypeCodeDTO, SetLeavePolicyDTO } from "@mezan/contracts";
import {
  ApiError,
  useApplyLeavePolicyPreset,
  useLeavePolicies,
  useLeavePolicyPresets,
  useSetLeavePolicy,
} from "../data/hooks";
import { NumberField, SelectField, ToggleField } from "../settings/form-controls";

/** سياسات الإجازات — Leave Policies (docs/catalog/06-crm-hr.md §"سياسات الإجازات"). Type matrix + preset apply + per-row manual edit. */

const LEAVE_TYPE_LABEL: Record<LeaveTypeCodeDTO, string> = {
  ANNUAL: "إجازة سنوية",
  SICK: "إجازة مرضية",
  PERSONAL: "إجازة شخصية",
  CASUAL: "إجازة عارضة",
  MATERNITY: "إجازة أمومة",
  PATERNITY: "إجازة أبوة",
  UNPAID: "إجازة بدون أجر",
  EMERGENCY: "إجازة طارئة",
};
const LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABEL) as LeaveTypeCodeDTO[];

const FREQUENCY_LABEL: Record<LeaveAccrualFrequencyDTO, string> = { MONTHLY: "شهرية", ANNUAL: "سنوية", NONE: "بدون" };
const CARRYOVER_LABEL: Record<LeaveCarryoverPolicyDTO, string> = { NONE: "بدون ترحيل", LIMITED: "محدود", UNLIMITED: "غير محدود" };

interface Draft {
  leaveTypeCode: LeaveTypeCodeDTO;
  effectiveDate: string;
  baseBalanceDays: number;
  accrualFrequency: LeaveAccrualFrequencyDTO;
  carryover: LeaveCarryoverPolicyDTO;
  carryoverMaxDays: number;
  payoutOnTermination: boolean;
  legallyMandatory: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankDraft(leaveTypeCode: LeaveTypeCodeDTO): Draft {
  return {
    leaveTypeCode,
    effectiveDate: today(),
    baseBalanceDays: 0,
    accrualFrequency: "ANNUAL",
    carryover: "NONE",
    carryoverMaxDays: 0,
    payoutOnTermination: false,
    legallyMandatory: false,
  };
}

export function LeavePoliciesScreen() {
  const query = useLeavePolicies();
  const presetsQuery = useLeavePolicyPresets();
  const applyPreset = useApplyLeavePolicyPreset();
  const setPolicy = useSetLeavePolicy();

  const versions = query.data ?? [];
  const presets = presetsQuery.data ?? [];

  const [presetSource, setPresetSource] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft("ANNUAL"));
  const [formError, setFormError] = useState<string | null>(null);

  function versionFor(code: LeaveTypeCodeDTO) {
    return versions.find((v) => v.leaveTypeCode === code) ?? null;
  }

  function openEdit(code: LeaveTypeCodeDTO) {
    const existing = versionFor(code);
    setDraft(
      existing
        ? {
            leaveTypeCode: code,
            effectiveDate: today(),
            baseBalanceDays: existing.baseBalanceDays,
            accrualFrequency: existing.accrualFrequency,
            carryover: existing.carryover,
            carryoverMaxDays: existing.carryoverMaxDays ?? 0,
            payoutOnTermination: existing.payoutOnTermination,
            legallyMandatory: existing.legallyMandatory,
          }
        : blankDraft(code),
    );
    setFormError(null);
    setEditOpen(true);
  }

  async function handleApplyPreset() {
    if (!presetSource) return;
    setPresetError(null);
    setApplying(true);
    try {
      await applyPreset.mutateAsync({ source: presetSource as LeavePolicySourceDTO & ("PRESET_EG_LAW_12_2003" | "PRESET_EG_LAW_14_2025") });
    } catch (err) {
      setPresetError(err instanceof ApiError ? err.message : "تعذّر تطبيق الإعداد الجاهز.");
    } finally {
      setApplying(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.baseBalanceDays < 0) {
      setFormError("الرصيد الأساسي يجب ألا يكون سالباً.");
      return;
    }
    setFormError(null);
    const body: SetLeavePolicyDTO = {
      leaveTypeCode: draft.leaveTypeCode,
      effectiveDate: draft.effectiveDate,
      baseBalanceDays: draft.baseBalanceDays,
      accrualFrequency: draft.accrualFrequency,
      carryover: draft.carryover,
      carryoverMaxDays: draft.carryover === "LIMITED" ? draft.carryoverMaxDays : null,
      payoutOnTermination: draft.payoutOnTermination,
      legallyMandatory: draft.legallyMandatory,
    };
    try {
      await setPolicy.mutateAsync(body);
      setEditOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر حفظ سياسة الإجازة.");
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[18px] flex items-center justify-between">
        <div>
          <h1 className="font-display text-[19px] font-bold text-ink">سياسات الإجازات</h1>
          <p className="mt-[4px] text-[13px] text-ink-muted">مصفوفة سياسة كل نوع إجازة: الرصيد، وتيرة الاستحقاق، الترحيل، صرف عند الإنهاء</p>
        </div>
      </div>

      <Card className="mb-[18px] flex flex-wrap items-end gap-[10px] p-[14px_16px]">
        <div className="min-w-[240px]">
          <SelectField
            label="اختر إعداداً..."
            value={presetSource}
            onChange={setPresetSource}
            options={[{ value: "", label: "اختر إعداداً..." }, ...presets.map((p) => ({ value: p.source, label: p.labelAr }))]}
          />
        </div>
        <Button variant="primary" disabled={!presetSource || applying} onClick={() => void handleApplyPreset()}>
          {applying ? "جارٍ التطبيق..." : "تطبيق إعداد جاهز"}
        </Button>
      </Card>
      {presetError ? (
        <Card className="mb-[18px] p-[14px_18px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {presetError}
          </p>
        </Card>
      ) : null}

      {versions.length === 0 ? (
        <Card className="p-[24px] text-center text-[13px] text-ink-muted">
          لا توجد سياسات إجازات معدة حالياً. استخدم "تطبيق إعداد جاهز" للبدء بسرعة، أو قم بتخصيص السياسات من خلال تعديل كل صف بشكل مستقل.
        </Card>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 text-ink-faint">
            <tr>
              <th className="p-[10px_14px] text-start font-semibold">نوع الإجازة</th>
              <th className="p-[10px_14px] text-end font-semibold">الرصيد الأساسي</th>
              <th className="p-[10px_14px] text-start font-semibold">وتيرة الاستحقاق</th>
              <th className="p-[10px_14px] text-start font-semibold">الترحيل</th>
              <th className="p-[10px_14px] text-start font-semibold">صرف عند الإنهاء</th>
              <th className="p-[10px_14px] text-start font-semibold">إجباري قانوناً</th>
              <th className="p-[10px_14px]" />
            </tr>
          </thead>
          <tbody>
            {LEAVE_TYPES.map((code) => {
              const v = versionFor(code);
              return (
                <tr key={code} className="border-t border-border">
                  <td className="p-[10px_14px] font-semibold text-ink">{LEAVE_TYPE_LABEL[code]}</td>
                  <td className="mz-num p-[10px_14px] text-end">{v ? v.baseBalanceDays : "—"}</td>
                  <td className="p-[10px_14px]">{v ? FREQUENCY_LABEL[v.accrualFrequency] : "—"}</td>
                  <td className="p-[10px_14px]">{v ? CARRYOVER_LABEL[v.carryover] : "—"}</td>
                  <td className="p-[10px_14px]">{v ? (v.payoutOnTermination ? "نعم" : "لا") : "—"}</td>
                  <td className="p-[10px_14px]">{v ? (v.legallyMandatory ? <StatusPill label="إجباري" tone="warning" /> : "لا") : "—"}</td>
                  <td className="p-[10px_14px] text-end">
                    <Button size="sm" onClick={() => openEdit(code)}>
                      تعديل
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SidePanel open={editOpen} onClose={() => setEditOpen(false)} title={`تعديل سياسة — ${LEAVE_TYPE_LABEL[draft.leaveTypeCode]}`}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <NumberField
            label="الرصيد الأساسي (بالأيام) *"
            value={draft.baseBalanceDays}
            onChange={(v) => setDraft((d) => ({ ...d, baseBalanceDays: v }))}
            min={0}
            step={0.5}
          />
          <SelectField
            label="وتيرة الاستحقاق *"
            value={draft.accrualFrequency}
            onChange={(v) => setDraft((d) => ({ ...d, accrualFrequency: v as LeaveAccrualFrequencyDTO }))}
            options={(Object.keys(FREQUENCY_LABEL) as LeaveAccrualFrequencyDTO[]).map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))}
          />
          <SelectField
            label="الترحيل *"
            value={draft.carryover}
            onChange={(v) => setDraft((d) => ({ ...d, carryover: v as LeaveCarryoverPolicyDTO }))}
            options={(Object.keys(CARRYOVER_LABEL) as LeaveCarryoverPolicyDTO[]).map((c) => ({ value: c, label: CARRYOVER_LABEL[c] }))}
          />
          {draft.carryover === "LIMITED" ? (
            <NumberField
              label="الحد الأقصى للترحيل (بالأيام)"
              value={draft.carryoverMaxDays}
              onChange={(v) => setDraft((d) => ({ ...d, carryoverMaxDays: v }))}
              min={0}
            />
          ) : null}
          <ToggleField label="صرف عند الإنهاء" checked={draft.payoutOnTermination} onChange={(v) => setDraft((d) => ({ ...d, payoutOnTermination: v }))} />
          <ToggleField label="إجباري قانوناً" checked={draft.legallyMandatory} onChange={(v) => setDraft((d) => ({ ...d, legallyMandatory: v }))} />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setEditOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              حفظ التعديلات
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
