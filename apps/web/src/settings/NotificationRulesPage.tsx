import { useMemo, useState } from "react";
import { Button, DocumentList, StatusPill, SidePanel, type DocumentListColumn, type DocumentListStatusChip } from "@mezan/ui";
import {
  DOMAIN_EVENT_CATALOG,
  PERMISSIONS,
  CONDITION_OPERATORS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_RECIPIENT_TYPES,
  type ConditionOperator,
  type NotificationChannel,
  type NotificationPriority,
  type NotificationRecipientType,
} from "@mezan/domain";
import type { NotificationRuleDTO } from "@mezan/contracts";
import { permissionLabel } from "../permission-labels";
import { MultiChipField, SelectField, TextAreaField, TextField, ToggleField } from "./form-controls";
import {
  useCreateNotificationRule,
  useDeleteNotificationRule,
  useNotificationRules,
  useRoles,
  useSetNotificationRuleActive,
  useUsers,
} from "../data/hooks";

const EVENT_LABEL = new Map(DOMAIN_EVENT_CATALOG.map((e) => [e.code, e.labelAr]));

const PRIORITY_LABEL: Record<NotificationPriority, string> = {
  low: "منخفضة",
  normal: "عادية",
  high: "عالية",
  urgent: "عاجلة",
};
const PRIORITY_TONE: Record<NotificationPriority, "neutral" | "info" | "warning" | "danger"> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
};

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: "داخل التطبيق",
  email: "بريد إلكتروني",
  push: "إشعار فوري",
};

const RECIPIENT_TYPE_LABEL: Record<NotificationRecipientType, string> = {
  permission: "حسب الصلاحية",
  role: "دور محدد",
  user: "مستخدم محدد",
};

const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  eq: "يساوي",
  neq: "لا يساوي",
  gt: "أكبر من",
  gte: "أكبر من أو يساوي",
  lt: "أصغر من",
  lte: "أصغر من أو يساوي",
  contains: "يحتوي على",
};

const EVENT_OPTIONS = DOMAIN_EVENT_CATALOG.map((e) => ({ value: e.code, label: `${e.labelAr} (${e.code})` }));
const PERMISSION_OPTIONS = PERMISSIONS.map((p) => ({ value: p.code, label: `${permissionLabel(p)} — ${p.code}` }));

interface FormState {
  name: string;
  eventCode: string;
  recipientType: NotificationRecipientType;
  recipientValue: string;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  titleAr: string;
  bodyAr: string;
  hasCondition: boolean;
  conditionField: string;
  conditionOperator: ConditionOperator;
  conditionValue: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    eventCode: DOMAIN_EVENT_CATALOG[0].code,
    recipientType: "permission",
    recipientValue: "",
    priority: "normal",
    channels: ["in_app"],
    titleAr: "",
    bodyAr: "",
    hasCondition: false,
    conditionField: "",
    conditionOperator: "gt",
    conditionValue: "",
  };
}

/**
 * قواعد الإشعارات builder (docs/catalog/09 §قواعد الإشعارات, `/notifications/rules`):
 * create/edit rules over the 39-event catalog with an optional condition,
 * recipient-by-permission/role/user, priority, channels, and an Arabic
 * title/body template editor. Real data only — list/create/toggle/delete all
 * go through `/notification-rules`.
 */
export function NotificationRulesPage() {
  const query = useNotificationRules();
  const rules = query.data ?? [];
  const create = useCreateNotificationRule();
  const setActive = useSetNotificationRuleActive();
  const deleteRule = useDeleteNotificationRule();
  const rolesQuery = useRoles();
  const usersQuery = useUsers();

  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const counts = useMemo(() => {
    const active = rules.filter((r) => r.active).length;
    return { total: rules.length, active, inactive: rules.length - active };
  }, [rules]);

  const filtered = rules.filter((r) => {
    if (statusFilter === "active") return r.active;
    if (statusFilter === "inactive") return !r.active;
    return true;
  });

  function recipientValueOptions() {
    if (form.recipientType === "permission") return PERMISSION_OPTIONS;
    if (form.recipientType === "role") return (rolesQuery.data ?? []).map((r) => ({ value: r.id, label: r.name }));
    return (usersQuery.data ?? []).map((u) => ({ value: u.id, label: u.fullName }));
  }

  function resetForm() {
    setForm(emptyForm());
  }

  async function submit() {
    if (!form.name.trim() || !form.recipientValue.trim() || form.channels.length === 0) return;
    await create.mutateAsync({
      name: form.name.trim(),
      eventCode: form.eventCode,
      condition: form.hasCondition
        ? { field: form.conditionField.trim(), operator: form.conditionOperator, value: form.conditionValue.trim() }
        : null,
      recipientType: form.recipientType,
      recipientValue: form.recipientValue,
      priority: form.priority,
      channels: form.channels,
      titleAr: form.titleAr.trim() || null,
      bodyAr: form.bodyAr.trim() || null,
      active: true,
    });
    setPanelOpen(false);
    resetForm();
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.total },
    { key: "active", label: "نشط", count: counts.active },
    { key: "inactive", label: "غير نشط", count: counts.inactive },
  ];

  const columns: DocumentListColumn<NotificationRuleDTO>[] = [
    {
      key: "name",
      header: "اسم القاعدة",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink">{r.name}</div>
          <div className="text-[11px] text-ink-muted">{EVENT_LABEL.get(r.eventCode) ?? r.eventCode}</div>
        </div>
      ),
    },
    {
      key: "priority",
      header: "الأولوية",
      render: (r) => <StatusPill label={PRIORITY_LABEL[r.priority]} tone={PRIORITY_TONE[r.priority]} />,
    },
    {
      key: "channels",
      header: "قنوات الإرسال",
      render: (r) => <span className="text-[12.5px] text-ink-muted">{r.channels.map((c) => CHANNEL_LABEL[c]).join("، ")}</span>,
    },
    {
      key: "status",
      header: "الحالة",
      render: (r) => (
        <button
          type="button"
          onClick={() => setActive.mutate({ id: r.id, active: !r.active })}
          disabled={setActive.isPending}
        >
          <StatusPill label={r.active ? "نشط" : "غير نشط"} tone={r.active ? "success" : "neutral"} />
        </button>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <Button variant="default" onClick={() => deleteRule.mutate(r.id)} disabled={deleteRule.isPending}>
          حذف
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<NotificationRuleDTO>
        eyebrow="الإعدادات · الأتمتة والقواعد"
        title="قواعد الإشعارات"
        description="قواعد تحدد أي أحداث النظام تُرسل إشعاراً، لمن، بأي أولوية وقنوات، وبأي نص عربي — بناءً على فهرس الأحداث الـ 39."
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            إضافة قاعدة
          </Button>
        }
        stats={[
          { label: "إجمالي القواعد", value: <span className="mz-num">{counts.total}</span> },
          { label: "القواعد النشطة", value: <span className="mz-num">{counts.active}</span> },
          { label: "القواعد المعطلة", value: <span className="mz-num">{counts.inactive}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | "active" | "inactive")}
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{rules.length}</span> قاعدة
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">{query.isLoading ? "جارِ التحميل…" : "لا توجد قواعد إشعارات"}</div>
        }
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="إضافة قاعدة">
        <div className="flex flex-col gap-4 p-5">
          <TextField label="اسم القاعدة *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="فاتورة مبيعات جديدة" />

          <SelectField
            label="الحدث *"
            value={form.eventCode}
            onChange={(v) => setForm((f) => ({ ...f, eventCode: v }))}
            options={EVENT_OPTIONS}
          />

          <SelectField
            label="نوع المستلم *"
            value={form.recipientType}
            onChange={(v) => setForm((f) => ({ ...f, recipientType: v as NotificationRecipientType, recipientValue: "" }))}
            options={NOTIFICATION_RECIPIENT_TYPES.map((t) => ({ value: t, label: RECIPIENT_TYPE_LABEL[t] }))}
          />
          <SelectField
            label="قيمة المستلم *"
            value={form.recipientValue}
            onChange={(v) => setForm((f) => ({ ...f, recipientValue: v }))}
            options={[{ value: "", label: "اختر..." }, ...recipientValueOptions()]}
          />

          <SelectField
            label="الأولوية *"
            value={form.priority}
            onChange={(v) => setForm((f) => ({ ...f, priority: v as NotificationPriority }))}
            options={NOTIFICATION_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          />

          <MultiChipField
            label="قنوات الإرسال *"
            value={form.channels}
            onChange={(v) => setForm((f) => ({ ...f, channels: v as NotificationChannel[] }))}
            options={NOTIFICATION_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
            hint="داخل التطبيق يعمل دائماً بدون اتصال؛ البريد والإشعار الفوري يُسجَّلان قيد الإرسال (queued) فقط."
          />

          <TextField
            label="عنوان مخصص (عربي)"
            value={form.titleAr}
            onChange={(v) => setForm((f) => ({ ...f, titleAr: v }))}
            placeholder={EVENT_LABEL.get(form.eventCode) ?? ""}
          />
          <TextAreaField
            label="نص الإشعار (عربي)"
            value={form.bodyAr}
            onChange={(v) => setForm((f) => ({ ...f, bodyAr: v }))}
            placeholder="تم إنشاء الفاتورة {{documentNumber}} بقيمة {{amount}} للعميل {{customerName}}."
            hint="المتغيرات المتاحة: {{customerName}}، {{amount}}، {{documentNumber}}"
          />

          <ToggleField
            label="إضافة شرط"
            checked={form.hasCondition}
            onChange={(checked) => setForm((f) => ({ ...f, hasCondition: checked }))}
            hint="اختياري — يُطبَّق فقط عند تحقق الشرط على بيانات الحدث (مثال: المبلغ أكبر من 1000)."
          />
          {form.hasCondition ? (
            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <TextField
                label="حقل الشرط"
                value={form.conditionField}
                onChange={(v) => setForm((f) => ({ ...f, conditionField: v }))}
                placeholder="amount"
              />
              <SelectField
                label="العامل"
                value={form.conditionOperator}
                onChange={(v) => setForm((f) => ({ ...f, conditionOperator: v as ConditionOperator }))}
                options={CONDITION_OPERATORS.map((op) => ({ value: op, label: OPERATOR_LABEL[op] }))}
              />
              <TextField
                label="قيمة الشرط"
                value={form.conditionValue}
                onChange={(v) => setForm((f) => ({ ...f, conditionValue: v }))}
                placeholder="1000"
              />
            </div>
          ) : null}

          {create.isError ? (
            <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{create.error.message}</div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => setPanelOpen(false)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={create.isPending || !form.name.trim() || !form.recipientValue.trim() || form.channels.length === 0}
            >
              إضافة
            </Button>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}
