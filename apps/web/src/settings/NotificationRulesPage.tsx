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
import { eventLabel, eventLabelArByCode, eventLabelByCode } from "../domain-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useConfirmAction } from "../lib/use-confirm-action";
import { MultiChipField, SelectField, TextAreaField, TextField, ToggleField } from "./form-controls";
import {
  useCreateNotificationRule,
  useDeleteNotificationRule,
  useNotificationRules,
  useRoles,
  useNotificationTriggers,
  useSetNotificationRuleActive,
  useUsers,
} from "../data/hooks";
import { EMPTY } from "../lib/empty";
import { useUrlParam } from "../lib/url-state";

const PRIORITY_KEY: Record<NotificationPriority, AppTranslationKey> = {
  low: "notifRules.priority.low",
  normal: "notifRules.priority.normal",
  high: "notifRules.priority.high",
  urgent: "notifRules.priority.urgent",
};
const PRIORITY_TONE: Record<NotificationPriority, "neutral" | "info" | "warning" | "danger"> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
};

const CHANNEL_KEY: Record<NotificationChannel, AppTranslationKey> = {
  in_app: "notifRules.channel.in_app",
  email: "notifRules.channel.email",
  push: "notifRules.channel.push",
};

const RECIPIENT_TYPE_KEY: Record<NotificationRecipientType, AppTranslationKey> = {
  permission: "notifRules.recipient.permission",
  role: "notifRules.recipient.role",
  user: "notifRules.recipient.user",
};

const OPERATOR_KEY: Record<ConditionOperator, AppTranslationKey> = {
  eq: "notifRules.operator.eq",
  neq: "notifRules.operator.neq",
  gt: "notifRules.operator.gt",
  gte: "notifRules.operator.gte",
  lt: "notifRules.operator.lt",
  lte: "notifRules.operator.lte",
  contains: "notifRules.operator.contains",
};



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
 * قواعد الإشعارات builder (docs/archive/catalog/09 §قواعد الإشعارات, `/notifications/rules`):
 * create/edit rules over the 39-event catalog with an optional condition,
 * recipient-by-permission/role/user, priority, channels, and an Arabic
 * title/body template editor. Real data only — list/create/toggle/delete all
 * go through `/notification-rules`.
 */
export function NotificationRulesPage() {
  const { t } = useAppTranslation();
  const query = useNotificationRules();
  const triggerCatalog = useNotificationTriggers();
  const rules = query.data ?? EMPTY;
  const create = useCreateNotificationRule();
  const setActive = useSetNotificationRuleActive();
  const deleteRule = useDeleteNotificationRule();
  const rolesQuery = useRoles();
  const usersQuery = useUsers();

  const [panelOpen, setPanelOpen] = useState(false);
  const confirm = useConfirmAction();
  // WHICH row is mutating, not merely that something is. Binding a
  // mutation-wide `isPending` to every row's `disabled` made the whole list go
  // dead while one toggle was in flight.
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | "active" | "inactive",
    (next: string) => void,
  ];

  const counts = useMemo(() => {
    const active = rules.filter((r) => r.active).length;
    return { total: rules.length, active, inactive: rules.length - active };
  }, [rules]);

  // Falls back to the static catalog until (or unless) /notification-rules/triggers answers.
  const eventOptions = useMemo(() => {
    const triggers = triggerCatalog.data?.triggers;
    if (!triggers) {
      return DOMAIN_EVENT_CATALOG.map((e) => ({ value: e.code, label: `${eventLabel(e, t)} (${e.code})` }));
    }
    return triggers.map((trigger) => ({
      value: trigger.code,
      label: `${eventLabel(trigger, t)} (${trigger.code})${trigger.emitted ? "" : t("notifRules.notEmittedSuffix")}`,
    }));
  }, [triggerCatalog.data, t]);

  /**
   * Which channels this build can actually DELIVER on. Until the triggers
   * endpoint answers, nothing is marked undeliverable — labelling a working
   * channel "not enabled" is the same lie in the other direction.
   */
  const implementedChannels = triggerCatalog.data?.implementedChannels;
  const hasTransport = (c: NotificationChannel) => !implementedChannels || implementedChannels.includes(c);

  const channelLabel = (c: NotificationChannel) =>
    hasTransport(c) ? t(CHANNEL_KEY[c]) : `${t(CHANNEL_KEY[c])}${t("notifRules.channelNoTransport")}`;

  const channelOptions = useMemo(
    () =>
      NOTIFICATION_CHANNELS.map((c) => ({
        value: c,
        label: channelLabel(c),
        // Not merely labelled: a rule cannot be SAVED against a channel with no
        // transport. «قيد الإرسال» read as "on its way" and the operator went
        // back to the screen for a message that was never going to arrive.
        disabled: !hasTransport(c),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [implementedChannels, t],
  );

  const filtered = rules.filter((r) => {
    if (statusFilter === "active") return r.active;
    if (statusFilter === "inactive") return !r.active;
    return true;
  });

  function recipientValueOptions() {
    if (form.recipientType === "permission") return PERMISSIONS.map((p) => ({ value: p.code, label: `${permissionLabel(p, t)} — ${p.code}` }));
    if (form.recipientType === "role") return (rolesQuery.data ?? []).map((r) => ({ value: r.id, label: r.name }));
    return (usersQuery.data ?? []).map((u) => ({ value: u.id, label: u.nameAr }));
  }

  function resetForm() {
    setForm(emptyForm());
  }

  /**
   * Every exit from the panel discards the draft — «إلغاء», the panel's own
   * close control, and the scrim. Reopening on an abandoned draft with «حفظ»
   * already live is how the next rule saved becomes the one they threw away
   * (D134).
   */
  function closePanel() {
    setPanelOpen(false);
    resetForm();
  }

  async function submit() {
    if (!form.name.trim() || !form.recipientValue.trim() || form.channels.length === 0) return;
    // `onClick={submit}` does not await this, so a rejected mutation escapes as
    // an unhandled promise rejection. react-query still renders the server's
    // message, which is why it stays invisible until something else listens
    // for rejections. Same shape as D124.
    try {
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
    } catch {
      // The panel stays open on the draft; `create.isError` shows the message.
      return;
    }
    setPanelOpen(false);
    resetForm();
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("notifRules.tab.all"), count: counts.total },
    { key: "active", label: t("notifRules.tab.active"), count: counts.active },
    { key: "inactive", label: t("notifRules.tab.inactive"), count: counts.inactive },
  ];

  const columns: DocumentListColumn<NotificationRuleDTO>[] = [
    {
      key: "name",
      header: t("notifRules.col.name"),
      render: (r) => (
        <div>
          <div className="font-semibold text-ink">{r.name}</div>
          <div className="text-[11px] text-ink-muted">{eventLabelByCode(r.eventCode, t) ?? r.eventCode}</div>
        </div>
      ),
    },
    {
      key: "priority",
      header: t("notifRules.col.priority"),
      render: (r) => <StatusPill label={t(PRIORITY_KEY[r.priority])} tone={PRIORITY_TONE[r.priority]} />,
    },
    {
      key: "channels",
      header: t("notifRules.col.channels"),
      // The SAME caveat the form carries. The table dropped it, so a rule saved
      // on «البريد» read as working the moment the panel closed.
      render: (r) => (
        <span className="text-[12.5px] text-ink-muted">
          {r.channels.map((c, i) => (
            <span key={c} className={hasTransport(c) ? undefined : "text-warning-ink"}>
              {i > 0 ? t("notifRules.channelSeparator") : null}
              {channelLabel(c)}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "status",
      header: t("notifRules.col.status"),
      render: (r) => (
        <button
          type="button"
          onClick={() => {
            if (pendingRuleId) return;
            setPendingRuleId(r.id);
            setActive.mutate({ id: r.id, active: !r.active }, { onSettled: () => setPendingRuleId(null) });
          }}
          disabled={pendingRuleId === r.id}
        >
          <StatusPill label={r.active ? t("notifRules.tab.active") : t("notifRules.tab.inactive")} tone={r.active ? "success" : "neutral"} />
        </button>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <Button
          variant="default"
          disabled={pendingRuleId === r.id}
          onClick={() =>
            confirm.ask({
              title: t("notifRules.confirmDeleteTitle"),
              consequence: t("notifRules.confirmDeleteBody", { name: r.name }),
              confirmLabel: t("notifRules.delete"),
              onConfirm: () => {
                if (pendingRuleId) return;
                setPendingRuleId(r.id);
                deleteRule.mutate(r.id, { onSettled: () => setPendingRuleId(null) });
              },
            })
          }
        >
          {t("notifRules.delete")}
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<NotificationRuleDTO>
        title={t("notifRules.title")}
        description={t("notifRules.description")}
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            {t("notifRules.add")}
          </Button>
        }
        stats={[
          { label: t("notifRules.stat.total"), value: <span className="mz-num">{counts.total}</span> },
          { label: t("notifRules.stat.active"), value: <span className="mz-num">{counts.active}</span> },
          { label: t("notifRules.stat.inactive"), value: <span className="mz-num">{counts.inactive}</span> },
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
            {t("notifRules.showingPrefix")} <span className="mz-num">{filtered.length}</span> {t("notifRules.showingOf")} <span className="mz-num">{rules.length}</span> {t("notifRules.showingSuffix")}
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">{query.isLoading ? t("notifRules.loading") : t("notifRules.empty")}</div>
        }
      />

      <SidePanel open={panelOpen} onClose={closePanel} title={t("notifRules.panel.title")}>
        <div className="flex flex-col gap-4 p-5">
          <TextField label={t("notifRules.field.name")} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder={t("notifRules.field.namePlaceholder")} />

          <SelectField
            label={t("notifRules.field.event")}
            value={form.eventCode}
            onChange={(v) => setForm((f) => ({ ...f, eventCode: v }))}
            options={eventOptions}
            hint={triggerCatalog.data ? t("notifRules.notEmittedHint") : undefined}
          />

          <SelectField
            label={t("notifRules.field.recipientType")}
            value={form.recipientType}
            onChange={(v) => setForm((f) => ({ ...f, recipientType: v as NotificationRecipientType, recipientValue: "" }))}
            options={NOTIFICATION_RECIPIENT_TYPES.map((kind) => ({ value: kind, label: t(RECIPIENT_TYPE_KEY[kind]) }))}
          />
          <SelectField
            label={t("notifRules.field.recipientValue")}
            value={form.recipientValue}
            onChange={(v) => setForm((f) => ({ ...f, recipientValue: v }))}
            options={[{ value: "", label: t("notifRules.field.choose") }, ...recipientValueOptions()]}
          />

          <SelectField
            label={t("notifRules.field.priority")}
            value={form.priority}
            onChange={(v) => setForm((f) => ({ ...f, priority: v as NotificationPriority }))}
            options={NOTIFICATION_PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_KEY[p]) }))}
          />

          <MultiChipField
            label={t("notifRules.field.channels")}
            value={form.channels}
            onChange={(v) => setForm((f) => ({ ...f, channels: v as NotificationChannel[] }))}
            options={channelOptions}
            hint={t("notifRules.field.channelsHint")}
          />

          <TextField
            label={t("notifRules.field.titleAr")}
            value={form.titleAr}
            onChange={(v) => setForm((f) => ({ ...f, titleAr: v }))}
            placeholder={eventLabelArByCode(form.eventCode) ?? ""}
          />
          <TextAreaField
            label={t("notifRules.field.bodyAr")}
            value={form.bodyAr}
            onChange={(v) => setForm((f) => ({ ...f, bodyAr: v }))}
            placeholder={t("notifRules.field.bodyPlaceholder")}
            hint={t("notifRules.field.bodyHint")}
          />

          <ToggleField
            label={t("notifRules.field.addCondition")}
            checked={form.hasCondition}
            onChange={(checked) => setForm((f) => ({ ...f, hasCondition: checked }))}
            hint={t("notifRules.field.conditionHint")}
          />
          {form.hasCondition ? (
            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <TextField
                label={t("notifRules.field.conditionField")}
                value={form.conditionField}
                onChange={(v) => setForm((f) => ({ ...f, conditionField: v }))}
                placeholder="amount"
              />
              <SelectField
                label={t("notifRules.field.conditionOperator")}
                value={form.conditionOperator}
                onChange={(v) => setForm((f) => ({ ...f, conditionOperator: v as ConditionOperator }))}
                options={CONDITION_OPERATORS.map((op) => ({ value: op, label: t(OPERATOR_KEY[op]) }))}
              />
              <TextField
                label={t("notifRules.field.conditionValue")}
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
            <Button variant="default" onClick={closePanel}>
              {t("notifRules.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={create.isPending || !form.name.trim() || !form.recipientValue.trim() || form.channels.length === 0}
            >
              {t("notifRules.submit")}
            </Button>
          </div>
        </div>
      </SidePanel>
      {confirm.dialog}
    </div>
  );
}
