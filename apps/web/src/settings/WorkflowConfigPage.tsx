import { useMemo, useState } from "react";
import { Button, Card, DocumentList, SidePanel, StatusPill, type DocumentListColumn } from "@mezan/ui";
import { GATEABLE_ACTION_TYPES, type GateableActionTypeDef } from "@mezan/domain";

/** Action types whose confirm path does not yet consult the workflow engine. */
const UNENFORCED_ACTION_TYPES = new Set<string>(
  (GATEABLE_ACTION_TYPES as readonly GateableActionTypeDef[]).filter((a) => a.enforced === false).map((a) => a.code),
);
import type { GateStepDTO, WorkflowConfigDTO } from "@mezan/contracts";
import { useCreateWorkflowConfig, useDeleteWorkflowConfig, useRoles, useUpdateWorkflowConfig, useWorkflowConfigs } from "../data/hooks";
import { SelectField, TextField } from "./form-controls";
import { actionTypeLabel } from "../domain-labels";
import { useAppTranslation } from "../i18n";
import { EMPTY } from "../lib/empty";
import { useUrlSearch } from "../lib/url-state";

/**
 * إعدادات الموافقات — the workflow chain-builder (docs/archive/catalog/09 §إعدادات
 * الموافقات): pick one of the 26 gateable action types, add ordered steps,
 * each assigning an approver ROLE from the tenant's CUSTOM roles only (built-
 * in/admin roles hold `"*"` and bypass every gate — see gate.ts's
 * `hasAdminRole`), persist the chain. Consumed by the real gate engine at
 * confirm time through `createDocumentWorkflowGate` (create-backend.ts).
 */

interface StepDraft {
  /**
   * Client-only, and stripped before the config is saved. An approval step has
   * no natural key — two steps may legitimately name the same role — and the
   * row holds a role picker and a description the user is editing. Keyed by
   * index, removing a middle step shifts the ones below it onto the previous
   * indices, so React reuses those DOM nodes and the edit in progress lands on
   * the wrong step.
   */
  rowId: string;
  role: string;
  description: string;
}

const newStep = (role: string): StepDraft => ({ rowId: crypto.randomUUID(), role, description: "" });

export function WorkflowConfigPage() {
  const { t } = useAppTranslation();
  const configsQuery = useWorkflowConfigs();
  const rolesQuery = useRoles();
  const createConfig = useCreateWorkflowConfig();
  const updateConfig = useUpdateWorkflowConfig();
  const deleteConfig = useDeleteWorkflowConfig();

  const configs = configsQuery.data ?? EMPTY;
  const customRoles = useMemo(() => (rolesQuery.data ?? []).filter((r) => !r.isSystem), [rolesQuery.data]);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowConfigDTO | null>(null); // null = creating
  const [actionType, setActionType] = useState<string>("");
  const [steps, setSteps] = useState<StepDraft[]>([newStep("")]);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText, search] = useUrlSearch();

  const configuredActionTypes = useMemo(() => new Set(configs.map((c) => c.actionType)), [configs]);
  const availableActionTypes = useMemo(
    () => GATEABLE_ACTION_TYPES.filter((a) => !configuredActionTypes.has(a.code)),
    [configuredActionTypes],
  );

  const filtered = useMemo(() => {
    if (search.trim() === "") return configs;
    const q = search.trim();
    return configs.filter((c) => actionTypeLabel(c.actionType, t).includes(q));
  }, [configs, search, t]);

  function openCreate() {
    setEditing(null);
    setActionType(availableActionTypes[0]?.code ?? "");
    setSteps([newStep(customRoles[0]?.code ?? "")]);
    setError(null);
    setPanelOpen(true);
  }

  function openEdit(config: WorkflowConfigDTO) {
    setEditing(config);
    setActionType(config.actionType);
    setSteps(config.steps.map((s) => ({ rowId: crypto.randomUUID(), role: s.role, description: s.description ?? "" })));
    setError(null);
    setPanelOpen(true);
  }

  function addStep() {
    setSteps((prev) => [...prev, newStep(customRoles[0]?.code ?? "")]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function save() {
    setError(null);
    const cleanSteps: GateStepDTO[] = steps
      .filter((s) => s.role.trim() !== "")
      .map((s) => ({ role: s.role, description: s.description.trim() === "" ? undefined : s.description }));
    if (cleanSteps.length === 0) {
      setError(t("workflowConfig.error.needStep"));
      return;
    }
    try {
      if (editing) {
        await updateConfig.mutateAsync({ id: editing.id, body: { steps: cleanSteps } });
      } else {
        if (!actionType) {
          setError(t("workflowConfig.error.needActionType"));
          return;
        }
        await createConfig.mutateAsync({ actionType, steps: cleanSteps });
      }
      setPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("workflowConfig.error.saveFailed"));
    }
  }

  async function remove(config: WorkflowConfigDTO) {
    try {
      await deleteConfig.mutateAsync(config.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("workflowConfig.error.deleteFailed"));
    }
  }

  const columns: DocumentListColumn<WorkflowConfigDTO>[] = [
    {
      key: "actionType",
      header: t("workflowConfig.col.actionType"),
      render: (c) => <span className="font-semibold text-ink">{actionTypeLabel(c.actionType, t)}</span>,
    },
    { key: "steps", header: t("workflowConfig.col.steps"), align: "end", render: (c) => <span className="mz-num">{c.steps.length}</span> },
    {
      key: "status",
      header: t("workflowConfig.col.status"),
      // A chain configured for an action the code path never consults is worse
      // than no chain: the tenant believes the document is held and it is not.
      render: (c) =>
        UNENFORCED_ACTION_TYPES.has(c.actionType) ? (
          <StatusPill label={t("workflowConfig.notEnforced")} tone="warning" />
        ) : (
          <StatusPill label={t("workflowConfig.active")} tone="success" />
        ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (c) => (
        <div className="flex justify-end gap-[6px]">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(c);
            }}
          >
            {t("workflowConfig.edit")}
          </Button>
          <Button
            size="sm"
            variant="danger-outline"
            onClick={(e) => {
              e.stopPropagation();
              void remove(c);
            }}
          >
            {t("workflowConfig.delete")}
          </Button>
        </div>
      ),
    },
  ];

  if (configsQuery.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("workflowConfig.loadFailed")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => configsQuery.refetch()}>
          {t("workflowConfig.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <>
      <DocumentList<WorkflowConfigDTO>
        title={t("workflowConfig.title")}
        description={t("workflowConfig.description")}
        actions={
          <Button variant="primary" onClick={openCreate} disabled={availableActionTypes.length === 0}>
            {t("workflowConfig.add")}
          </Button>
        }
        stats={[{ label: t("workflowConfig.stat.defined"), value: <span className="mz-num">{configs.length}</span> }]}
        searchValue={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder={t("workflowConfig.searchPlaceholder")}
        columns={columns}
        rows={filtered}
        rowKey={(c) => c.id}
        onRowClick={openEdit}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("workflowConfig.showingPrefix")} <span className="mz-num">{filtered.length}</span> {t("workflowConfig.showingOf")} <span className="mz-num">{configs.length}</span>
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("workflowConfig.empty")}</div>}
      />

      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={editing ? t("workflowConfig.panel.edit") : t("workflowConfig.panel.new")}
        description={t("workflowConfig.panel.description")}
      >
        <div className="flex flex-col gap-[16px]">
          {error ? (
            <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[7px] text-[12px] text-danger-ink">{error}</div>
          ) : null}

          <SelectField
            label={t("workflowConfig.field.actionType")}
            value={actionType}
            onChange={setActionType}
            disabled={!!editing}
            options={
              editing
                ? [{ value: editing.actionType, label: actionTypeLabel(editing.actionType, t) }]
                : availableActionTypes.map((a) => ({ value: a.code, label: actionTypeLabel(a.code, t) }))
            }
          />

          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-ink">{t("workflowConfig.stepsHeading")}</span>
              <Button size="sm" onClick={addStep} disabled={customRoles.length === 0}>
                {t("workflowConfig.addStep")}
              </Button>
            </div>
            {customRoles.length === 0 ? (
              <p className="text-[11.5px] text-ink-faint">{t("workflowConfig.noRoles")}</p>
            ) : null}
            {steps.map((step, index) => (
              <div key={step.rowId} className="flex flex-col gap-[8px] rounded-lg border border-border bg-surface p-[12px_14px]">
                <div className="flex items-center justify-between">
                  <span className="mz-num rounded-pill bg-brand-soft px-[8px] py-[2px] text-[11px] font-bold text-brand">
                    {t("workflowConfig.step", { number: index + 1 })}
                  </span>
                  {steps.length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => removeStep(index)}>
                      {t("workflowConfig.removeStep")}
                    </Button>
                  ) : null}
                </div>
                <SelectField
                  label={t("workflowConfig.field.role")}
                  value={step.role}
                  onChange={(v) => updateStep(index, { role: v })}
                  options={customRoles.map((r) => ({ value: r.code, label: r.name }))}
                />
                <TextField
                  label={t("workflowConfig.field.stepDescription")}
                  value={step.description}
                  onChange={(v) => updateStep(index, { description: v })}
                  placeholder={t("workflowConfig.field.stepPlaceholder")}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>{t("workflowConfig.cancel")}</Button>
            <Button variant="primary" onClick={() => void save()}>
              {t("workflowConfig.save")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
