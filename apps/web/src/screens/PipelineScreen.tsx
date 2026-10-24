import { useMemo, useState } from "react";
import { Button, Card, Money as MoneyDisplay, SidePanel, StatCard } from "@mezan/ui";
import type { OpportunityDTO, PipelineStageDTO } from "@mezan/contracts";
import { NumberField, SelectField } from "../settings/form-controls";
import { useCustomers, useOpportunities, usePipelineStages, useBranches } from "../data/hooks";
import { useCrmAccess, useCrmOwners } from "./enh/crm-pipeline/hooks";
import { useLostReasonName, useOwnerName } from "./enh/crm-pipeline/parts";
import { useStageMove } from "./enh/crm-pipeline/stage-move";
import { useNavigation } from "../navigation";
import { CreateOpportunityForm } from "./OpportunitiesScreen";
import { useAppTranslation } from "../i18n";
import { majorOf, sumMajor } from "../lib/money";
import { useUrlParam } from "../lib/url-state";

/**
 * خط المبيعات (Sales Pipeline) — docs/archive/catalog/06 §"خط المبيعات". A kanban
 * board over the same opportunity/stage data as OpportunitiesScreen and
 * PipelineStagesScreen; no drag-and-drop (out of scope), stage moves happen
 * through a compact per-card SelectField instead.
 */

export function PipelineScreen() {
  const { t } = useAppTranslation();
  const stagesQuery = usePipelineStages();
  const opportunitiesQuery = useOpportunities();
  const customersQuery = useCustomers();
  const branchesQuery = useBranches();
  const access = useCrmAccess();
  const owners = useCrmOwners().data ?? [];
  const ownerName = useOwnerName();
  const lostReasonName = useLostReasonName();
  const { openScreenAt } = useNavigation();

  const stages = useMemo(
    () => [...(stagesQuery.data ?? [])].filter((s) => s.active).sort((a, b) => a.order - b.order),
    [stagesQuery.data],
  );
  const allOpportunities = opportunitiesQuery.data ?? [];
  const stageMove = useStageMove(stages);

  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customersQuery.data ?? []) map.set(c.id, c.nameAr);
    return (id: string) => map.get(id) ?? id;
  }, [customersQuery.data]);

  const [view, setView] = useState<"board" | "list">("board");
  const [customerFilter, setCustomerFilter] = useUrlParam("customer");
  const [branchFilter, setBranchFilter] = useUrlParam("branch");
  const [ownerFilter, setOwnerFilter] = useUrlParam("owner");
  const [valueFrom, setValueFrom] = useState(Number.NaN);
  const [valueTo, setValueTo] = useState(Number.NaN);
  const [formOpen, setFormOpen] = useState(false);

  /**
   * The stat strip and the columns read the SAME filtered set — a board whose
   * columns narrow while the totals above them do not is the defect this
   * codebase keeps finding on lists.
   */
  const opportunities = allOpportunities.filter((opportunity) => {
    if (customerFilter && opportunity.customerId !== customerFilter) return false;
    if (branchFilter && opportunity.branchId !== branchFilter) return false;
    if (ownerFilter && opportunity.ownerUserId !== ownerFilter) return false;
    const value = majorOf(opportunity.expectedValue);
    if (!Number.isNaN(valueFrom) && value < valueFrom) return false;
    if (!Number.isNaN(valueTo) && value > valueTo) return false;
    return true;
  });

  const totalCount = opportunities.length;
  const totalExpectedValue = sumMajor(opportunities.map((o) => o.expectedValue));
  const wonOpportunities = opportunities.filter((o) => o.status === "won");
  const wonValue = sumMajor(wonOpportunities.map((o) => o.expectedValue));

  const createQuote = (opportunity: OpportunityDTO) => openScreenAt("quotes", ["new", opportunity.customerId, opportunity.id]);

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("pipeline.pipeline")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("pipeline.openOpportunitiesGroupedByPipeline")}</p>
        </div>
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          {t("pipeline.addOpportunity")}
        </Button>
      </div>

      {(stagesQuery.isError || opportunitiesQuery.isError) ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{stagesQuery.error?.message ?? opportunitiesQuery.error?.message ?? t("pipeline.pipelineDataCouldNotBe")}</p>
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

      {stageMove.error ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {stageMove.error}
        </div>
      ) : null}

      <Card className="mb-[16px] flex flex-wrap items-end gap-[12px] p-[12px_14px]">
        <div className="flex gap-[4px]">
          {(["board", "list"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`rounded-md border px-[11px] py-[4px] text-[11.5px] font-semibold transition-colors ${
                view === option
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border bg-surface text-ink-muted hover:border-brand hover:text-brand"
              }`}
            >
              {option === "board" ? t("pipeline.view.board") : t("pipeline.view.list")}
            </button>
          ))}
        </div>
        <div className={`grid flex-1 gap-2 ${access.seesEveryDeal ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
          <SelectField
            label={t("pipeline.filter.branch")}
            value={branchFilter}
            onChange={setBranchFilter}
            options={[
              { value: "", label: t("pipeline.filter.allBranches") },
              ...(branchesQuery.data ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
          />
          {access.seesEveryDeal ? (
            <SelectField
              label={t("crmPipeline.owner.filter")}
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[{ value: "", label: t("crmPipeline.owner.allOwners") }, ...owners.map((owner) => ({ value: owner.id, label: owner.name }))]}
            />
          ) : null}
          <SelectField
            label={t("pipeline.filter.customer")}
            value={customerFilter}
            onChange={setCustomerFilter}
            options={[
              { value: "", label: t("pipeline.filter.allCustomers") },
              ...(customersQuery.data ?? []).map((customer) => ({ value: customer.id, label: customer.nameAr })),
            ]}
          />
          <NumberField label={t("pipeline.filter.valueFrom")} value={valueFrom} onChange={setValueFrom} />
          <NumberField label={t("pipeline.filter.valueTo")} value={valueTo} onChange={setValueTo} />
        </div>
      </Card>

      {view === "list" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
                <tr>
                  <th className="px-[15px] py-[9px] text-start">{t("pipeline.col.stage")}</th>
                  <th className="px-[15px] py-[9px] text-start">{t("pipeline.col.title")}</th>
                  <th className="px-[15px] py-[9px] text-start">{t("common.customer")}</th>
                  <th className="px-[15px] py-[9px] text-start">{t("crmPipeline.col.owner")}</th>
                  <th className="px-[15px] py-[9px] text-end">{t("pipeline.expectedValue")}</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-[18px] text-center text-ink-muted">{t("pipeline.noMatching")}</td>
                  </tr>
                ) : (
                  opportunities.map((opportunity) => {
                    const stage = stages.find((s) => s.id === opportunity.stageId);
                    return (
                      <tr key={opportunity.id} className="border-t border-border">
                        <td className="px-[15px] py-[9px]">
                          <span className="inline-flex items-center gap-[7px] text-ink">
                            <span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: stage?.color ?? "var(--ink-faint)" }} />
                            {stage?.name ?? opportunity.stageId}
                          </span>
                        </td>
                        <td className="px-[15px] py-[9px] text-ink">{opportunity.title}</td>
                        <td className="px-[15px] py-[9px] text-ink-muted">{customerName(opportunity.customerId)}</td>
                        <td className="px-[15px] py-[9px] text-ink-muted">{ownerName(opportunity.ownerUserId)}</td>
                        <td className="px-[15px] py-[9px] text-end">
                          <MoneyDisplay value={majorOf(opportunity.expectedValue)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
      <div className="flex gap-[14px] overflow-x-auto pb-[8px]">
        {stages.map((stage) => (
          <PipelineColumn
            key={stage.id}
            stage={stage}
            stages={stages}
            opportunities={opportunities.filter((o) => o.stageId === stage.id)}
            customerName={customerName}
            ownerName={ownerName}
            lostReasonName={lostReasonName}
            movingId={stageMove.pendingId}
            onMove={stageMove.request}
            onCreateQuote={access.mayQuote ? createQuote : null}
          />
        ))}
      </div>
      )}

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("pipeline.addOpportunity")} description={t("pipeline.opportunityDetails")}>
        <CreateOpportunityForm onDone={() => setFormOpen(false)} onCancel={() => setFormOpen(false)} />
      </SidePanel>
      {stageMove.dialog}
    </div>
  );
}

interface PipelineColumnProps {
  stage: PipelineStageDTO;
  stages: PipelineStageDTO[];
  opportunities: OpportunityDTO[];
  customerName: (id: string) => string;
  ownerName: (userId: string | null) => string;
  lostReasonName: (code: string | null) => string | null;
  movingId: string | null;
  onMove: (opportunity: OpportunityDTO, stageId: string) => void;
  onCreateQuote: ((opportunity: OpportunityDTO) => void) | null;
}

function PipelineColumn({ stage, stages, opportunities, customerName, ownerName, lostReasonName, movingId, onMove, onCreateQuote }: PipelineColumnProps) {
  const { t } = useAppTranslation();
  return (
    <div className="w-[280px] flex-none">
      <Card className="flex h-full flex-col p-[14px]">
        <div className="mb-[10px] flex items-center justify-between gap-[8px]">
          <h2 className="flex items-center gap-[7px] font-display text-[13.5px] font-bold text-ink">
            {/* The stage's own colour, which the board defined and never showed. */}
            <span aria-hidden className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: stage.color }} />
            {stage.name}
          </h2>
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
                <div className="mt-[3px] text-[11px] text-ink-faint">{ownerName(opportunity.ownerUserId)}</div>
                <div className="mt-[6px] flex items-center justify-between">
                  <MoneyDisplay value={majorOf(opportunity.expectedValue)} className="text-[12px] font-bold" />
                  <span className="mz-num text-[11px] text-ink-faint">{opportunity.probability}%</span>
                </div>
                {opportunity.status === "lost" && opportunity.lostReason ? (
                  <div className="mt-[6px] text-[11px] font-semibold text-danger-ink">
                    {t("crmPipeline.lost.badge", { reason: lostReasonName(opportunity.lostReason) ?? opportunity.lostReason })}
                  </div>
                ) : null}
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
                {opportunity.status === "open" && onCreateQuote ? (
                  <Button size="sm" className="mt-[8px]" onClick={() => onCreateQuote(opportunity)}>
                    {t("crmPipeline.createQuote")}
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
