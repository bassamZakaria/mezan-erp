import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  DocumentList,
  MoneyInput,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
} from "@mezan/ui";
import type { GateStepDTO, WorkflowActionCategoryDTO, WorkflowConfigDTO } from "@mezan/contracts";
import { useRoles } from "../data/hooks";
import { useSetWorkflowConfig, useWorkflowConfig } from "../data/workflow-hooks";
import { SelectField, TextField } from "./form-controls";

/**
 * إعدادات الموافقات — the workflow/approvals config screen (docs/catalog/09
 * §إعدادات الموافقات, route `/settings/workflow`). Builds ONE editor over
 * exactly the 26 gateable action types `packages/domain/src/workflow/
 * action-types.ts` declares (read via `GET /workflow/config`, which already
 * enumerates them) — per action type: an ordered chain of approver roles
 * (only tenant-defined custom roles, matching the reference product's role
 * picker) and an optional minimum-amount threshold.
 */

const CATEGORY_LABEL: Record<WorkflowActionCategoryDTO, string> = {
  sales: "المبيعات",
  purchases: "المشتريات",
  treasury: "الخزينة",
  inventory: "المخزون",
  accounting: "المحاسبة",
  hr_payroll: "الرواتب",
  hr_leave: "الإجازات",
  manufacturing: "التصنيع",
};

function blankStep(): GateStepDTO {
  return { role: "", description: "" };
}

export function WorkflowConfigPage() {
  const query = useWorkflowConfig();
  const rolesQuery = useRoles();
  const setConfig = useSetWorkflowConfig();

  const configs = useMemo(() => query.data ?? [], [query.data]);
  const approverRoles = useMemo(() => (rolesQuery.data ?? []).filter((r) => !r.isSystem), [rolesQuery.data]);

  const [category, setCategory] = useState<WorkflowActionCategoryDTO | "all">("all");
  const [selectedActionType, setSelectedActionType] = useState<string | null>(null);
  const [draftSteps, setDraftSteps] = useState<GateStepDTO[]>([]);
  const [draftMinAmount, setDraftMinAmount] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const visible = category === "all" ? configs : configs.filter((c) => c.category === category);
  const selected = selectedActionType ? (configs.find((c) => c.actionType === selectedActionType) ?? null) : null;

  function openEditor(row: WorkflowConfigDTO) {
    setSelectedActionType(row.actionType);
    setDraftSteps(row.steps.length > 0 ? row.steps.map((s) => ({ ...s })) : []);
    setDraftMinAmount(row.minAmount ? Number(row.minAmount) : null);
    setFormError(null);
  }

  function addStep() {
    setDraftSteps((steps) => [...steps, blankStep()]);
  }

  function updateStep(index: number, patch: Partial<GateStepDTO>) {
    setDraftSteps((steps) => steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeStep(index: number) {
    setDraftSteps((steps) => steps.filter((_, i) => i !== index));
  }

  async function save() {
    if (!selected) return;
    if (draftSteps.some((s) => s.role.trim() === "")) {
      setFormError("اختر دوراً معتمِداً لكل خطوة.");
      return;
    }
    setFormError(null);
    try {
      await setConfig.mutateAsync({
        actionType: selected.actionType,
        body: {
          steps: draftSteps.map((s) => ({ role: s.role, description: s.description?.trim() || undefined })),
          minAmount: draftMinAmount === null ? null : String(draftMinAmount),
        },
      });
      setSelectedActionType(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: configs.length },
    ...(Object.keys(CATEGORY_LABEL) as WorkflowActionCategoryDTO[]).map((c) => ({
      key: c,
      label: CATEGORY_LABEL[c],
      count: configs.filter((x) => x.category === c).length,
    })),
  ];

  const columns: DocumentListColumn<WorkflowConfigDTO>[] = [
    { key: "labelAr", header: "نوع الإجراء", render: (r) => <span className="font-semibold text-ink">{r.labelAr}</span> },
    { key: "category", header: "المجموعة", render: (r) => <Chip>{CATEGORY_LABEL[r.category]}</Chip> },
    {
      key: "steps",
      header: "عدد الخطوات",
      align: "end",
      render: (r) => <span className="mz-num text-ink">{r.steps.length}</span>,
    },
    {
      key: "minAmount",
      header: "الحد الأدنى للمبلغ",
      align: "end",
      render: (r) => (r.minAmount ? <span className="mz-num text-ink">{r.minAmount}</span> : <span className="text-ink-faint">—</span>),
    },
    {
      key: "status",
      header: "الحالة",
      render: (r) =>
        r.configured ? (
          <StatusPill label="مفعّل" tone="success" />
        ) : (
          <StatusPill label="بدون موافقة" tone="neutral" />
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 p-5">
      <DocumentList
        eyebrow="الإعدادات"
        title="سير العمل والموافقات"
        description="حدّد الإجراءات التي تتطلب موافقة، ومن يعتمدها، وأي حد أدنى للمبلغ."
        statusChips={statusChips}
        activeStatusKey={category}
        onStatusChange={(key) => setCategory(key as WorkflowActionCategoryDTO | "all")}
        columns={columns}
        rows={visible}
        rowKey={(r) => r.actionType}
        onRowClick={openEditor}
        page={1}
        pageCount={1}
        emptyState={<div className="p-6 text-center text-[13px] text-ink-muted">لا توجد إعدادات موافقات.</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedActionType(null)} title={selected?.labelAr ?? "إعداد الموافقة"}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <Card className="p-3">
              <MoneyInput value={draftMinAmount} onChange={setDraftMinAmount} placeholder="بدون حد أدنى" />
              <span className="mt-1 block text-[11.5px] text-ink-faint">
                اتركه فارغاً لتطبيق الموافقة على كل عملية بغض النظر عن المبلغ.
              </span>
            </Card>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-ink">خطوات الاعتماد</span>
                <Button variant="default" onClick={addStep}>
                  إضافة خطوة
                </Button>
              </div>

              {draftSteps.length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">لا توجد خطوات — سيُعتمد الإجراء تلقائياً دون موافقة.</div>
              ) : (
                draftSteps.map((step, index) => (
                  <Card key={index} className="flex flex-col gap-2 p-3">
                    <div className="flex items-center justify-between">
                      <span className="mz-num text-[11px] font-semibold text-ink-faint">خطوة {index + 1}</span>
                      <Button variant="ghost" onClick={() => removeStep(index)}>
                        حذف
                      </Button>
                    </div>
                    <SelectField
                      label="اختر الدور"
                      value={step.role}
                      onChange={(role) => updateStep(index, { role })}
                      options={[
                        { value: "", label: "— اختر دوراً —" },
                        ...approverRoles.map((r) => ({ value: r.code, label: r.name })),
                      ]}
                    />
                    <TextField
                      label="وصف الخطوة (اختياري)"
                      value={step.description ?? ""}
                      onChange={(description) => updateStep(index, { description })}
                    />
                  </Card>
                ))
              )}
            </div>

            {approverRoles.length === 0 ? (
              <div className="text-[12px] text-ink-faint">
                لا توجد أدوار مخصَّصة في هذا المستأجر بعد — أنشئ دوراً من صفحة الأدوار والصلاحيات أولاً لتتمكن من اختياره كمعتمِد.
              </div>
            ) : null}

            {formError ? <div role="alert" className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{formError}</div> : null}

            <div className="flex gap-2">
              <Button variant="primary" disabled={setConfig.isPending} onClick={save}>
                حفظ
              </Button>
              <Button variant="default" onClick={() => setSelectedActionType(null)}>
                إلغاء
              </Button>
            </div>
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
