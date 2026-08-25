import { useMemo, useState } from "react";
import { FulcrumRule, Button, Card, Money as MoneyDisplay, SidePanel, StatCard } from "@mezan/ui";
import type { OpportunityDTO, PipelineStageDTO } from "@mezan/contracts";
import { SelectField } from "../settings/form-controls";
import { useCustomers, useMoveOpportunityStage, useOpportunities, usePipelineStages } from "../data/hooks";
import { CreateOpportunityForm } from "./OpportunitiesScreen";
import { useAppTranslation } from "../i18n";

/**
 * خط المبيعات (Sales Pipeline) — docs/catalog/06 §"خط المبيعات". A kanban
 * board over the same opportunity/stage data as OpportunitiesScreen and
 * PipelineStagesScreen; no drag-and-drop (out of scope), stage moves happen
 * through a compact per-card SelectField instead.
 */

export function PipelineScreen() {
  const { t } = useAppTranslation();
  const stagesQuery = usePipelineStages();
  const opportunitiesQuery = useOpportunities();
  const customersQuery = useCustomers();
  const moveStage = useMoveOpportunityStage();

  const stages = useMemo(
    () => [...(stagesQuery.data ?? [])].filter((s) => s.active).sort((a, b) => a.order - b.order),
    [stagesQuery.data],
  );
  const opportunities = opportunitiesQuery.data ?? [];

  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customersQuery.data ?? []) map.set(c.id, c.nameAr);
    return (id: string) => map.get(id) ?? id;
  }, [customersQuery.data]);

  const [formOpen, setFormOpen] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const totalCount = opportunities.length;
  const totalExpectedValue = opportunities.reduce((sum, o) => sum + Number(o.expectedValue), 0);
  const wonOpportunities = opportunities.filter((o) => o.status === "won");
  const wonValue = wonOpportunities.reduce((sum, o) => sum + Number(o.expectedValue), 0);

  async function moveOpportunity(opportunity: OpportunityDTO, stageId: string) {
    if (stageId === opportunity.stageId || movingId) return;
    setMovingId(opportunity.id);
    setMoveError(null);
    try {
      await moveStage.mutateAsync({ id: opportunity.id, body: { stageId } });
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : t("pipeline.theOpportunityCouldNotBe"));
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="mz-eyebrow">{t("eyebrow.crm.pipeline")}</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("pipeline.pipeline")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("pipeline.openOpportunitiesGroupedByPipeline")}</p>
        </div>
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          {t("pipeline.addOpportunity")}
        </Button>
      </div>
      <FulcrumRule />

      {(stagesQuery.isError || opportunitiesQuery.isError) ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("pipeline.pipelineDataCouldNotBe")}</p>
          <Button
            size="sm"
            className="mt-[10px]"
            onClick={() => {
              stagesQuery.refetch();
              opportunitiesQuery.refetch();
            }}
          >
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <div className="mb-[18px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("pipeline.totalOpportunities")} value={<span className="mz-num">{totalCount}</span>} />
        <StatCard label={t("pipeline.expectedValue")} value={<MoneyDisplay value={totalExpectedValue} />} />
        <StatCard label={t("pipeline.wonOpportunities")} value={<span className="mz-num">{wonOpportunities.length}</span>} />
        <StatCard label={t("pipeline.valueWon")} value={<MoneyDisplay value={wonValue} />} />
      </div>

      {moveError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {moveError}
        </div>
      ) : null}

      <div className="flex gap-[14px] overflow-x-auto pb-[8px]">
        {stages.map((stage) => (
          <PipelineColumn
            key={stage.id}
            stage={stage}
            stages={stages}
            opportunities={opportunities.filter((o) => o.stageId === stage.id)}
            customerName={customerName}
            movingId={movingId}
            onMove={moveOpportunity}
          />
        ))}
      </div>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("pipeline.addOpportunity")} description={t("pipeline.opportunityDetails")}>
        <CreateOpportunityForm onDone={() => setFormOpen(false)} onCancel={() => setFormOpen(false)} />
      </SidePanel>
    </div>
  );
}

interface PipelineColumnProps {
  stage: PipelineStageDTO;
  stages: PipelineStageDTO[];
  opportunities: OpportunityDTO[];
  customerName: (id: string) => string;
  movingId: string | null;
  onMove: (opportunity: OpportunityDTO, stageId: string) => void;
}

function PipelineColumn({ stage, stages, opportunities, customerName, movingId, onMove }: PipelineColumnProps) {
  const { t } = useAppTranslation();
  return (
    <div className="w-[280px] flex-none">
      <Card className="flex h-full flex-col p-[14px]">
        <div className="mb-[10px] flex items-center justify-between gap-[8px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">{stage.name}</h2>
          <span className="mz-num rounded-pill bg-surface-3 px-[9px] py-[2px] text-[11px] font-bold text-ink-muted">{opportunities.length}</span>
        </div>
        <div className="flex flex-col gap-[10px]">
          {opportunities.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-[14px] text-center text-[11.5px] text-ink-faint">{t("pipeline.noOpportunities")}</div>
          ) : (
            opportunities.map((opportunity) => (
              <div key={opportunity.id} className="rounded-md border border-border bg-surface p-[11px]">
                <div className="text-[12.5px] font-semibold text-ink">{opportunity.title}</div>
                <div className="mt-[3px] text-[11px] text-ink-muted">{customerName(opportunity.customerId)}</div>
                <div className="mt-[6px] flex items-center justify-between">
                  <MoneyDisplay value={Number(opportunity.expectedValue)} className="text-[12px] font-bold" />
                  <span className="mz-num text-[11px] text-ink-faint">{opportunity.probability}%</span>
                </div>
                {opportunity.status === "open" ? (
                  <div className="mt-[8px]">
                    <SelectField
                      label={t("pipeline.moveTo")}
                      value={opportunity.stageId}
                      disabled={movingId === opportunity.id}
                      onChange={(stageId) => onMove(opportunity, stageId)}
                      options={stages.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
