import { useId, useState } from "react";
import {
  RowActionOutcome,
  Button,
  DocumentList,
  EmptyState,
  RowMenu,
  SidePanel,
  StatusPill,
  TextInput,
  useFormat,
  type DocumentListColumn,
  type RowMenuItem,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { ShiftTemplateDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { useBranches } from "../data/hooks";
import { Field, FormError, SelectField, TextField, ToggleField } from "./form-controls";
import { useAppTranslation } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { EMPTY } from "../lib/empty";
import { useCreateShiftTemplate, useShiftTemplates, useUpdateShiftTemplate } from "../screens/pos/master/hooks";
import { errorMessage } from "../lib/error-message";

interface Draft {
  nameAr: string;
  nameEn: string;
  fromTime: string;
  toTime: string;
  branchId: string;
  active: boolean;
}

const BLANK: Draft = { nameAr: "", nameEn: "", fromTime: "08:00", toTime: "16:00", branchId: "", active: true };

function bodyOf(draft: Draft) {
  return {
    nameAr: draft.nameAr.trim(),
    nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
    fromTime: draft.fromTime,
    toTime: draft.toTime,
    branchId: draft.branchId === "" ? null : draft.branchId,
    active: draft.active,
  };
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <TextInput id={id} type="time" numeric value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function ShiftTemplatesPage() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const nameOf = useEntityName();
  const { session } = useApi();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayEdit = can(auth, "admin.settings.edit");

  const query = useShiftTemplates();
  const branches = useBranches().data ?? EMPTY;
  const createTemplate = useCreateShiftTemplate();
  const updateTemplate = useUpdateShiftTemplate();
  const rows = query.data ?? (EMPTY as ShiftTemplateDTO[]);

  const [panel, setPanel] = useState<{ mode: "new" } | { mode: "edit"; template: ShiftTemplateDTO } | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const branchLabel = (id: string | null) => (id === null ? t("shiftTemplates.allBranches") : nameOf(branches.find((b) => b.id === id), id));
  const templateName = (x: ShiftTemplateDTO) => nameOf({ name: x.nameAr, nameEn: x.nameEn });

  function openNew() {
    setDraft(BLANK);
    setError(null);
    setPanel({ mode: "new" });
  }

  function openEdit(template: ShiftTemplateDTO) {
    setDraft({
      nameAr: template.nameAr,
      nameEn: template.nameEn ?? "",
      fromTime: template.fromTime,
      toTime: template.toTime,
      branchId: template.branchId ?? "",
      active: template.active,
    });
    setError(null);
    setPanel({ mode: "edit", template });
  }

  async function submit() {
    if (!panel) return;
    setError(null);
    setSaving(true);
    try {
      if (panel.mode === "new") await createTemplate.mutateAsync(bodyOf(draft));
      else await updateTemplate.mutateAsync({ id: panel.template.id, body: bodyOf(draft) });
      setPanel(null);
    } catch (err) {
      setError(errorMessage(err, t("pos.common.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(template: ShiftTemplateDTO) {
    if (pendingId !== null) return;
    setPendingId(template.id);
    setActionError(null);
    try {
      await updateTemplate.mutateAsync({
        id: template.id,
        body: bodyOf({
          nameAr: template.nameAr,
          nameEn: template.nameEn ?? "",
          fromTime: template.fromTime,
          toTime: template.toTime,
          branchId: template.branchId ?? "",
          active: !template.active,
        }),
      });
    } catch (err) {
      setActionError(errorMessage(err, t("pos.common.saveFailed")));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  const columns: DocumentListColumn<ShiftTemplateDTO>[] = [
    { key: "name", header: t("shiftTemplates.col.name"), render: (x) => <span className="font-semibold text-ink">{templateName(x)}</span> },
    {
      key: "period",
      header: t("shiftTemplates.col.period"),
      render: (x) => (
        <span className="inline-flex flex-wrap items-center gap-[6px]">
          <span className="mz-num" dir="ltr">
            {x.fromTime} – {x.toTime}
          </span>
          {x.crossesMidnight ? <StatusPill label={t("shiftTemplates.overnight")} tone="info" /> : null}
        </span>
      ),
    },
    { key: "branch", header: t("shiftTemplates.col.branch"), render: (x) => branchLabel(x.branchId) },
    {
      key: "status",
      header: t("shiftTemplates.col.status"),
      render: (x) => <StatusPill label={x.active ? t("pos.common.active") : t("pos.common.inactive")} tone={x.active ? "success" : "neutral"} />,
    },
  ];

  return (
    <>
      <FormError message={actionError} />
      <DocumentList<ShiftTemplateDTO>
        title={t("shiftTemplates.title")}
        description={t("shiftTemplates.description")}
        actions={
          mayEdit ? (
            <Button variant="primary" onClick={openNew}>
              {t("shiftTemplates.add")}
            </Button>
          ) : undefined
        }
        stats={[
          { label: t("shiftTemplates.stat.total"), value: <span className="mz-num">{format.number(rows.length)}</span> },
          { label: t("shiftTemplates.stat.active"), value: <span className="mz-num">{format.number(rows.filter((x) => x.active).length)}</span> },
        ]}
        columns={columns}
        rows={rows}
        rowKey={(x) => x.id}
        onRowClick={mayEdit ? openEdit : undefined}
        rowAction={(x) => {
          if (!mayEdit) return null;
          const items: RowMenuItem[] = [
            { key: "edit", label: t("common.edit"), onSelect: () => openEdit(x) },
            {
              key: "toggle",
              label: x.active ? t("pos.common.disable") : t("pos.common.enable"),
              disabled: pendingId === x.id,
              onSelect: () => toggle(x),
            },
          ];
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: templateName(x) })} />;
        }}
        loading={query.isLoading}
        loadFailed={query.isError}
        page={1}
        pageCount={1}
        emptyState={
          <EmptyState title={t("shiftTemplates.empty")} action={mayEdit ? { label: t("shiftTemplates.add"), onClick: openNew } : undefined} />
        }
      />

      <SidePanel
        open={panel !== null}
        onClose={() => setPanel(null)}
        title={panel?.mode === "edit" ? t("shiftTemplates.panel.edit", { name: templateName(panel.template) }) : t("shiftTemplates.panel.new")}
        description={t("shiftTemplates.panel.description")}
      >
        <div className="flex flex-col gap-[14px]">
          <FormError message={error} />
          <TextField
            label={t("shiftTemplates.field.nameAr")}
            placeholder={t("shiftTemplates.field.nameArPlaceholder")}
            value={draft.nameAr}
            onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))}
          />
          <TextField label={t("shiftTemplates.field.nameEn")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <div className="grid grid-cols-2 gap-[12px]">
            <TimeField label={t("shiftTemplates.field.from")} value={draft.fromTime} onChange={(v) => setDraft((d) => ({ ...d, fromTime: v }))} />
            <TimeField label={t("shiftTemplates.field.to")} value={draft.toTime} onChange={(v) => setDraft((d) => ({ ...d, toTime: v }))} />
          </div>
          <SelectField
            label={t("shiftTemplates.field.branch")}
            hint={t("shiftTemplates.field.branchHint")}
            value={draft.branchId}
            onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
            options={[{ value: "", label: t("shiftTemplates.allBranches") }, ...branches.map((b) => ({ value: b.id, label: nameOf(b) }))]}
          />
          <ToggleField label={t("shiftTemplates.field.active")} checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanel(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void submit()} disabled={saving}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
