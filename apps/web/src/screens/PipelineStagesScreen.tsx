import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, IconButton, SidePanel, StatusPill, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { PipelineStageDTO } from "@mezan/contracts";
import { NumberField, TextField, ToggleField } from "../settings/form-controls";
import { useCreatePipelineStage, useMovePipelineStage, usePipelineStages } from "../data/hooks";
import { useAppTranslation } from "../i18n";

/**
 * مراحل خط المبيعات (Pipeline Stages) — docs/catalog/06 §"مراحل خط المبيعات".
 * This MVP's API only supports create + up/down reorder (no edit/deactivate
 * endpoint), so this screen intentionally does not build an edit/deactivate UI.
 */

function stageTypeLabel(stage: PipelineStageDTO): string {
  if (stage.isWinStage) return "مرحلة فوز";
  if (stage.isLossStage) return "مرحلة خسارة";
  return "مفتوحة";
}

function stageTypeTone(stage: PipelineStageDTO): PillTone {
  if (stage.isWinStage) return "success";
  if (stage.isLossStage) return "danger";
  return "info";
}

interface StageDraft {
  name: string;
  defaultProbability: number;
  color: string;
  isWinStage: boolean;
  isLossStage: boolean;
}

function blankDraft(): StageDraft {
  return { name: "", defaultProbability: 50, color: "#3b82f6", isWinStage: false, isLossStage: false };
}

function validateDraft(draft: StageDraft): string | null {
  if (draft.name.trim() === "") return "اسم المرحلة مطلوب.";
  return null;
}

export function PipelineStagesScreen() {
  const { t } = useAppTranslation();
  const query = usePipelineStages();
  const createStage = useCreatePipelineStage();
  const moveStage = useMovePipelineStage();
  const stages = useMemo(() => [...(query.data ?? [])].sort((a, b) => a.order - b.order), [query.data]);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<StageDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const activeCount = stages.filter((s) => s.active).length;
  const winStage = stages.find((s) => s.isWinStage);
  const lossStage = stages.find((s) => s.isLossStage);

  function openCreateForm() {
    setDraft(blankDraft());
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
    try {
      await createStage.mutateAsync({
        id: crypto.randomUUID(),
        name: draft.name.trim(),
        defaultProbability: draft.defaultProbability,
        color: draft.color.trim() === "" ? undefined : draft.color.trim(),
        isWinStage: draft.isWinStage,
        isLossStage: draft.isLossStage,
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.failed"));
    }
  }

  async function move(stage: PipelineStageDTO, direction: "up" | "down") {
    if (movingId) return;
    setMovingId(stage.id);
    setMoveError(null);
    try {
      await moveStage.mutateAsync({ id: stage.id, direction });
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : t("pipelineStages.theStageCouldNotBe"));
    } finally {
      setMovingId(null);
    }
  }

  const columns: DocumentListColumn<PipelineStageDTO>[] = [
    { key: "order", header: t("pipelineStages.order"), render: (s) => <span className="mz-num font-semibold text-ink">{s.order}</span> },
    { key: "name", header: t("common.name"), render: (s) => <span className="font-semibold text-ink">{s.name}</span> },
    { key: "defaultProbability", header: t("pipelineStages.defaultProbability"), render: (s) => <span className="mz-num">{s.defaultProbability}%</span> },
    { key: "type", header: t("common.type"), render: (s) => <StatusPill label={stageTypeLabel(s)} tone={stageTypeTone(s)} /> },
    { key: "status", header: t("common.status"), render: (s) => <StatusPill label={s.active ? t("pipelineStages.active") : t("pipelineStages.inactive")} tone={s.active ? "success" : "neutral"} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (s) => {
        const index = stages.findIndex((row) => row.id === s.id);
        return (
          <div className="flex items-center justify-end gap-[6px]">
            <IconButton
              aria-label={`نقل ${s.name} للأعلى`}
              disabled={index <= 0 || movingId !== null}
              onClick={() => move(s, "up")}
            >
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
                <path d="M10 15V5M5 9l5-5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
            <IconButton
              aria-label={`نقل ${s.name} للأسفل`}
              disabled={index >= stages.length - 1 || movingId !== null}
              onClick={() => move(s, "down")}
            >
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
                <path d="M10 5v10M5 11l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
          </div>
        );
      },
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("pipelineStages.pipelineStagesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {moveError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {moveError}
        </div>
      ) : null}
      <DocumentList<PipelineStageDTO>
        eyebrow="CRM · Pipeline Stages"
        title={t("pipelineStages.pipelineStages")}
        description={t("pipelineStages.defineTheStagesOfThe")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("pipelineStages.addStage")}
          </Button>
        }
        stats={[
          { label: t("pipelineStages.totalStages"), value: <span className="mz-num">{stages.length}</span> },
          { label: t("pipelineStages.activeStages"), value: <span className="mz-num">{activeCount}</span> },
          { label: t("pipelineStages.wonStage2"), value: winStage?.name ?? "—" },
          { label: t("pipelineStages.lostStage2"), value: lossStage?.name ?? "—" },
        ]}
        columns={columns}
        rows={stages}
        rowKey={(s) => s.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{stages.length}</span> {t("common.of")} <span className="mz-num">{stages.length}</span> {t("pipelineStages.stages")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("pipelineStages.noStages")}</div>}
      />

      <SidePanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={t("pipelineStages.addStage")}
        description={t("pipelineStages.leaveBothUntickedForOpen")}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label={t("pipelineStages.name")} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <NumberField
            label={t("pipelineStages.defaultProbability2")}
            value={draft.defaultProbability}
            min={0}
            max={100}
            onChange={(v) => setDraft((d) => ({ ...d, defaultProbability: v }))}
          />
          <TextField label={t("pipelineStages.colour")} value={draft.color} onChange={(v) => setDraft((d) => ({ ...d, color: v }))} placeholder="#3b82f6" />
          <ToggleField
            label={t("pipelineStages.wonStage")}
            checked={draft.isWinStage}
            onChange={(v) => setDraft((d) => ({ ...d, isWinStage: v, isLossStage: v ? false : d.isLossStage }))}
          />
          <ToggleField
            label={t("pipelineStages.lostStage")}
            checked={draft.isLossStage}
            onChange={(v) => setDraft((d) => ({ ...d, isLossStage: v, isWinStage: v ? false : d.isWinStage }))}
          />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
