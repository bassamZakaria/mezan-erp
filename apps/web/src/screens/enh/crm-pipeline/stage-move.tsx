import { useState, type FormEvent, type ReactNode } from "react";
import { Button, SidePanel } from "@mezan/ui";
import type { OpportunityDTO, OpportunityLostReasonDTO, PipelineStageDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../../../settings/form-controls";
import { useMoveOpportunityStage } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { useCrmLostReasons } from "./hooks";
import { lostReasonLabel } from "./parts";

interface LossRequest {
  readonly opportunity: OpportunityDTO;
  readonly stage: PipelineStageDTO;
}

export interface StageMove {
  readonly request: (opportunity: OpportunityDTO, stageId: string) => void;
  readonly pendingId: string | null;
  readonly error: string | null;
  readonly dialog: ReactNode;
}

const NO_REASON = "";

/**
 * One path for moving a deal between stages, shared by the board and the list.
 * A move into a loss stage is held until the rep names why — the server refuses
 * it without — and the loss panel is the only place that reason is captured.
 */
export function useStageMove(stages: readonly PipelineStageDTO[]): StageMove {
  const { t, locale } = useAppTranslation();
  const mutation = useMoveOpportunityStage();
  const reasons = useCrmLostReasons().data ?? [];
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loss, setLoss] = useState<LossRequest | null>(null);
  const [reason, setReason] = useState<string>(NO_REASON);
  const [note, setNote] = useState("");
  const [panelError, setPanelError] = useState<string | null>(null);

  async function run(opportunity: OpportunityDTO, stageId: string, lost?: { reason: OpportunityLostReasonDTO; note: string }): Promise<boolean> {
    if (pendingId) return false;
    setPendingId(opportunity.id);
    setError(null);
    try {
      await mutation.mutateAsync({
        id: opportunity.id,
        body: { stageId, ...(lost ? { lostReason: lost.reason, lostNote: lost.note.trim() === "" ? null : lost.note.trim() } : {}) },
      });
      return true;
    } catch (err) {
      const message = errorMessage(err, t("pipeline.theOpportunityCouldNotBe"));
      if (lost) setPanelError(message);
      else setError(message);
      return false;
    } finally {
      setPendingId(null);
    }
  }

  function request(opportunity: OpportunityDTO, stageId: string): void {
    if (stageId === opportunity.stageId || pendingId) return;
    const stage = stages.find((s) => s.id === stageId);
    if (stage?.isLossStage) {
      setReason(NO_REASON);
      setNote("");
      setPanelError(null);
      setLoss({ opportunity, stage });
      return;
    }
    void run(opportunity, stageId);
  }

  async function confirmLoss(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!loss) return;
    if (reason === NO_REASON) {
      setPanelError(t("crmPipeline.lost.required"));
      return;
    }
    if (await run(loss.opportunity, loss.stage.id, { reason: reason as OpportunityLostReasonDTO, note })) setLoss(null);
  }

  const dialog = (
    <SidePanel open={loss !== null} onClose={() => setLoss(null)} title={t("crmPipeline.lost.title")} description={loss?.opportunity.title}>
      <form onSubmit={confirmLoss} className="flex flex-col gap-[14px]">
        {panelError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {panelError}
          </div>
        ) : null}
        <SelectField
          label={t("crmPipeline.lost.reason")}
          value={reason}
          onChange={setReason}
          options={[{ value: NO_REASON, label: t("crmPipeline.lost.choose") }, ...reasons.map((r) => ({ value: r.code, label: lostReasonLabel(r, locale) }))]}
        />
        <TextField label={t("crmPipeline.lost.note")} value={note} onChange={setNote} maxLength={500} />
        <div className="mt-[6px] flex justify-end gap-[9px]">
          <Button type="button" onClick={() => setLoss(null)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={pendingId !== null}>
            {t("crmPipeline.lost.confirm")}
          </Button>
        </div>
      </form>
    </SidePanel>
  );

  return { request, pendingId, error, dialog };
}
