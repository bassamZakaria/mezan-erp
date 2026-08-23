import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type PillTone,
} from "@mezan/ui";
import { MODULES, PERMISSIONS } from "@mezan/domain";
import type {
  NotificationChannelDTO,
  NotificationConditionOperatorDTO,
  NotificationPriorityDTO,
  NotificationRecipientTypeDTO,
  NotificationRuleDTO,
  NotificationTriggerDTO,
} from "@mezan/contracts";
import { MultiChipField, SelectField, TextField } from "../settings/form-controls";
import { useRoles, useUsers } from "../data/hooks";
import {
  useCreateNotificationRule,
  useDeleteNotificationRule,
  useNotificationRules,
  useNotificationTriggers,
  useUpdateNotificationRule,
} from "../data/notification-hooks";

/**
 * قواعد الإشعارات (docs/catalog/09 §"قواعد الإشعارات", `/notifications/rules`).
 * Nothing is seeded — a tenant authors its own rules, so an empty list is the
 * real first-run state.
 */

const PRIORITY_LABELS: Record<NotificationPriorityDTO, string> = {
  low: "منخفضة",
  normal: "عادية",
  high: "مرتفعة",
  urgent: "عاجلة",
};

const PRIORITY_TONES: Record<NotificationPriorityDTO, PillTone> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
};

const CHANNEL_LABELS: Record<NotificationChannelDTO, string> = {
  in_app: "داخل التطبيق",
  email: "بريد إلكتروني",
  whatsapp: "واتساب",
};

const RECIPIENT_LABELS: Record<NotificationRecipientTypeDTO, string> = {
  permission: "حسب الصلاحية",
  role: "دور محدد",
  user: "مستخدم محدد",
};

const OPERATOR_LABELS: Record<NotificationConditionOperatorDTO, string> = {
  eq: "يساوي",
  neq: "لا يساوي",
  gt: "أكبر من",
  gte: "أكبر من أو يساوي",
  lt: "أصغر من",
  lte: "أصغر من أو يساوي",
  contains: "يحتوي على",
};

const MODULE_LABELS = new Map(MODULES.map((m) => [m.id, m.labelAr]));

interface RuleDraft {
  name: string;
  eventCode: string;
  recipientType: NotificationRecipientTypeDTO;
  recipientValue: string;
  priority: NotificationPriorityDTO;
  channels: NotificationChannelDTO[];
  titleTemplate: string;
  bodyTemplate: string;
  conditionField: string;
  conditionOperator: NotificationConditionOperatorDTO;
  conditionValue: string;
}

function blankDraft(): RuleDraft {
  return {
    name: "",
    eventCode: "",
    recipientType: "permission",
    recipientValue: "",
    priority: "normal",
    channels: ["in_app"],
    titleTemplate: "",
    bodyTemplate: "",
    conditionField: "",
    conditionOperator: "eq",
    conditionValue: "",
  };
}

function draftOf(rule: NotificationRuleDTO): RuleDraft {
  return {
    name: rule.name,
    eventCode: rule.eventCode,
    recipientType: rule.recipientType,
    recipientValue: rule.recipientValue,
    priority: rule.priority,
    channels: [...rule.channels],
    titleTemplate: rule.titleTemplate ?? "",
    bodyTemplate: rule.bodyTemplate ?? "",
    conditionField: rule.condition?.field ?? "",
    conditionOperator: rule.condition?.operator ?? "eq",
    conditionValue: rule.condition?.value ?? "",
  };
}

function validateDraft(draft: RuleDraft): string | null {
  if (draft.name.trim() === "") return "اسم القاعدة مطلوب.";
  if (draft.eventCode === "") return "الحدث مطلوب.";
  if (draft.recipientValue.trim() === "") return "قيمة المستلم مطلوبة.";
  if (draft.channels.length === 0) return "اختر قناة إرسال واحدة على الأقل.";
  if (draft.conditionField !== "" && draft.conditionValue.trim() === "") {
    return "قيمة الشرط مطلوبة عند اختيار حقل شرط.";
  }
  return null;
}

type StatusFilter = "all" | "enabled" | "disabled";

export function NotificationRulesScreen() {
  const rulesQuery = useNotificationRules();
  const triggersQuery = useNotificationTriggers();
  const rolesQuery = useRoles();
  const usersQuery = useUsers();
  const createRule = useCreateNotificationRule();
  const updateRule = useUpdateNotificationRule();
  const deleteRule = useDeleteNotificationRule();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const rules = rulesQuery.data ?? [];
  const triggers = triggersQuery.data?.triggers ?? [];
  const implementedChannels = triggersQuery.data?.implementedChannels ?? [];
  const roles = rolesQuery.data ?? [];
  const users = usersQuery.data ?? [];

  const triggerByCode = useMemo(
    () => new Map(triggers.map((t) => [t.code, t] as const)),
    [triggers],
  );
  const selectedTrigger: NotificationTriggerDTO | undefined = triggerByCode.get(draft.eventCode);

  const visibleRules = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rules.filter((rule) => {
      if (statusFilter === "enabled" && !rule.enabled) return false;
      if (statusFilter === "disabled" && rule.enabled) return false;
      if (needle === "") return true;
      return (
        rule.name.toLowerCase().includes(needle) || rule.eventCode.toLowerCase().includes(needle)
      );
    });
  }, [rules, statusFilter, search]);

  const enabledCount = rules.filter((r) => r.enabled).length;

  const eventOptions = useMemo(() => {
    const emitted = triggers.filter((t) => t.emitted);
    const notEmitted = triggers.filter((t) => !t.emitted);
    return [
      { value: "", label: "اختر الحدث…" },
      ...emitted.map((t) => ({ value: t.code, label: `${t.labelAr} — ${t.code}` })),
      ...notEmitted.map((t) => ({
        value: t.code,
        label: `${t.labelAr} — ${t.code} (لا يُطلَق بعد)`,
      })),
    ];
  }, [triggers]);

  const recipientOptions = useMemo(() => {
    if (draft.recipientType === "role") {
      return [
        { value: "", label: "اختر الدور…" },
        ...roles.map((r) => ({ value: r.id, label: r.name })),
      ];
    }
    if (draft.recipientType === "user") {
      return [
        { value: "", label: "اختر المستخدم…" },
        ...users.map((u) => ({ value: u.id, label: u.fullName })),
      ];
    }
    return [
      { value: "", label: "اختر الصلاحية…" },
      ...PERMISSIONS.map((p) => ({
        value: p.code,
        label: `${MODULE_LABELS.get(p.module) ?? p.module} · ${p.code}`,
      })),
    ];
  }, [draft.recipientType, roles, users]);

  const conditionFieldOptions = useMemo(
    () => [
      { value: "", label: selectedTrigger ? "بدون شرط" : "اختر الحدث أولاً" },
      ...(selectedTrigger?.conditionFields ?? []).map((f) => ({
        value: f.key,
        label: `${f.labelAr} (${f.key})`,
      })),
    ],
    [selectedTrigger],
  );

  function openCreate() {
    setEditingId(null);
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(rule: NotificationRuleDTO) {
    setEditingId(rule.id);
    setDraft(draftOf(rule));
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const body = {
      name: draft.name.trim(),
      eventCode: draft.eventCode,
      condition:
        draft.conditionField === ""
          ? null
          : {
              field: draft.conditionField,
              operator: draft.conditionOperator,
              value: draft.conditionValue.trim(),
            },
      recipientType: draft.recipientType,
      recipientValue: draft.recipientValue.trim(),
      priority: draft.priority,
      channels: draft.channels,
      titleTemplate: draft.titleTemplate.trim() === "" ? null : draft.titleTemplate.trim(),
      bodyTemplate: draft.bodyTemplate.trim() === "" ? null : draft.bodyTemplate.trim(),
    };
    try {
      if (editingId) await updateRule.mutateAsync({ id: editingId, body });
      else await createRule.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّرت العملية.");
    }
  }

  async function toggleEnabled(rule: NotificationRuleDTO) {
    if (rowPendingId) return;
    setRowPendingId(rule.id);
    setRowError(null);
    try {
      await updateRule.mutateAsync({ id: rule.id, body: { enabled: !rule.enabled } });
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "تعذّر تحديث حالة القاعدة.");
    } finally {
      setRowPendingId(null);
    }
  }

  async function removeRule(rule: NotificationRuleDTO) {
    if (rowPendingId) return;
    setRowPendingId(rule.id);
    setRowError(null);
    try {
      await deleteRule.mutateAsync(rule.id);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "تعذّر حذف القاعدة.");
    } finally {
      setRowPendingId(null);
    }
  }

  const columns: DocumentListColumn<NotificationRuleDTO>[] = [
    {
      key: "name",
      header: "اسم القاعدة",
      render: (rule) => (
        <div>
          <span className="font-semibold text-ink">{rule.name}</span>
          <span className="mz-lat block text-[11px] text-ink-faint">{rule.eventCode}</span>
        </div>
      ),
    },
    {
      key: "recipient",
      header: "المستلم",
      render: (rule) => (
        <div>
          <span className="text-ink-muted">{RECIPIENT_LABELS[rule.recipientType]}</span>
          <span className="mz-lat block text-[11px] text-ink-faint">{rule.recipientValue}</span>
        </div>
      ),
    },
    {
      key: "priority",
      header: "الأولوية",
      render: (rule) => (
        <StatusPill label={PRIORITY_LABELS[rule.priority]} tone={PRIORITY_TONES[rule.priority]} />
      ),
    },
    {
      key: "channels",
      header: "قنوات الإرسال",
      render: (rule) => (
        <div className="flex flex-wrap gap-[6px]">
          {rule.channels.map((channel) => (
            <StatusPill
              key={channel}
              label={
                implementedChannels.includes(channel)
                  ? CHANNEL_LABELS[channel]
                  : `${CHANNEL_LABELS[channel]} (غير مفعّلة)`
              }
              tone={implementedChannels.includes(channel) ? "success" : "neutral"}
            />
          ))}
        </div>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (rule) => (
        <StatusPill
          label={rule.enabled ? "نشطة" : "غير نشطة"}
          tone={rule.enabled ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (rule) => (
        <div className="flex items-center justify-end gap-[6px]">
          <Button size="sm" onClick={() => openEdit(rule)}>
            تعديل
          </Button>
          <Button size="sm" disabled={rowPendingId === rule.id} onClick={() => toggleEnabled(rule)}>
            {rule.enabled ? "تعطيل" : "تفعيل"}
          </Button>
          <Button size="sm" disabled={rowPendingId === rule.id} onClick={() => removeRule(rule)}>
            حذف
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      {rulesQuery.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل قواعد الإشعارات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => rulesQuery.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      {rowError ? (
        <div
          role="alert"
          className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
        >
          {rowError}
        </div>
      ) : null}

      <DocumentList<NotificationRuleDTO>
        eyebrow="الإعدادات · قواعد الإشعارات"
        title="قواعد الإشعارات"
        description="اربط أحداث النظام بمن يجب إشعاره، وعلى أي قناة، وبأي شرط"
        actions={
          <Button variant="primary" onClick={openCreate}>
            إضافة قاعدة
          </Button>
        }
        stats={[
          { label: "إجمالي القواعد", value: <span className="mz-num">{rules.length}</span> },
          { label: "القواعد النشطة", value: <span className="mz-num">{enabledCount}</span> },
          {
            label: "القواعد المعطلة",
            value: <span className="mz-num">{rules.length - enabledCount}</span>,
          },
          {
            label: "القنوات المفعّلة",
            value: implementedChannels.map((c) => CHANNEL_LABELS[c]).join("، ") || "—",
          },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث باسم القاعدة أو كود الحدث…"
        statusChips={[
          { key: "all", label: "الكل", count: rules.length },
          { key: "enabled", label: "نشط", count: enabledCount },
          { key: "disabled", label: "غير نشط", count: rules.length - enabledCount },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as StatusFilter)}
        columns={columns}
        rows={visibleRules}
        rowKey={(rule) => rule.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{visibleRules.length}</span> من{" "}
            <span className="mz-num">{rules.length}</span> قاعدة
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            لا توجد قواعد إشعارات — أضف قاعدة لربط حدث بمستلميه
          </div>
        }
      />

      <SidePanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? "تعديل قاعدة" : "إضافة قاعدة"}
        description="القناة المفعّلة في هذا الإصدار هي «داخل التطبيق» فقط؛ البريد والواتساب يُحفظان في القاعدة بلا إرسال."
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
            >
              {formError}
            </div>
          ) : null}

          <TextField
            label="اسم القاعدة *"
            value={draft.name}
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
          />

          <SelectField
            label="الحدث *"
            value={draft.eventCode}
            options={eventOptions}
            hint={
              selectedTrigger && !selectedTrigger.emitted
                ? "هذا الحدث موجود في كتالوج الأحداث لكن لا يُطلقه هذا الإصدار بعد، فلن تُنتج القاعدة إشعارًا."
                : undefined
            }
            onChange={(v) =>
              setDraft((d) => ({ ...d, eventCode: v, conditionField: "", conditionValue: "" }))
            }
          />

          <SelectField
            label="نوع المستلم *"
            value={draft.recipientType}
            options={[
              { value: "permission", label: RECIPIENT_LABELS.permission },
              { value: "role", label: RECIPIENT_LABELS.role },
              { value: "user", label: RECIPIENT_LABELS.user },
            ]}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                recipientType: v as NotificationRecipientTypeDTO,
                recipientValue: "",
              }))
            }
          />

          <SelectField
            label="قيمة المستلم *"
            value={draft.recipientValue}
            options={recipientOptions}
            onChange={(v) => setDraft((d) => ({ ...d, recipientValue: v }))}
          />

          <SelectField
            label="الأولوية *"
            value={draft.priority}
            options={(Object.keys(PRIORITY_LABELS) as NotificationPriorityDTO[]).map((p) => ({
              value: p,
              label: PRIORITY_LABELS[p],
            }))}
            onChange={(v) => setDraft((d) => ({ ...d, priority: v as NotificationPriorityDTO }))}
          />

          <MultiChipField
            label="قنوات الإرسال *"
            hint="«داخل التطبيق» هي القناة الوحيدة التي تُسلَّم فعليًا في هذا الإصدار."
            options={(Object.keys(CHANNEL_LABELS) as NotificationChannelDTO[]).map((c) => ({
              value: c,
              label: implementedChannels.includes(c)
                ? CHANNEL_LABELS[c]
                : `${CHANNEL_LABELS[c]} (غير مفعّلة)`,
            }))}
            value={draft.channels}
            onChange={(v) => setDraft((d) => ({ ...d, channels: v as NotificationChannelDTO[] }))}
          />

          <SelectField
            label="حقل الشرط"
            value={draft.conditionField}
            options={conditionFieldOptions}
            disabled={!selectedTrigger || conditionFieldOptions.length <= 1}
            onChange={(v) => setDraft((d) => ({ ...d, conditionField: v }))}
          />
          <SelectField
            label="العامل"
            value={draft.conditionOperator}
            options={(Object.keys(OPERATOR_LABELS) as NotificationConditionOperatorDTO[]).map(
              (op) => ({ value: op, label: OPERATOR_LABELS[op] }),
            )}
            disabled={draft.conditionField === ""}
            onChange={(v) =>
              setDraft((d) => ({ ...d, conditionOperator: v as NotificationConditionOperatorDTO }))
            }
          />
          <TextField
            label="قيمة الشرط"
            value={draft.conditionValue}
            disabled={draft.conditionField === ""}
            onChange={(v) => setDraft((d) => ({ ...d, conditionValue: v }))}
          />

          <TextField
            label="عنوان مخصص (عربي)"
            value={draft.titleTemplate}
            placeholder="فاتورة كبيرة {{docNo}}"
            hint="اتركه فارغًا لاستخدام اسم الحدث."
            onChange={(v) => setDraft((d) => ({ ...d, titleTemplate: v }))}
          />
          <TextField
            label="نص الإشعار (عربي)"
            value={draft.bodyTemplate}
            placeholder="العميل {{customerName}} — الإجمالي {{amount}}"
            hint={
              selectedTrigger && selectedTrigger.conditionFields.length > 0
                ? `المتغيرات المتاحة: ${selectedTrigger.conditionFields.map((f) => `{{${f.key}}}`).join(" ")}`
                : "اختر الحدث لعرض المتغيرات المتاحة."
            }
            onChange={(v) => setDraft((d) => ({ ...d, bodyTemplate: v }))}
          />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? "حفظ" : "إضافة"}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
