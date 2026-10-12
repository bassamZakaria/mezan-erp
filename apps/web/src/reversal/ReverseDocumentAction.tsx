import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, type RowMenuItem } from "@mezan/ui";
import { DOCUMENT_REVERSAL_PATHS, ReversalDocumentType, reversalRoute } from "@mezan/contracts";
import { can, createAuthContext } from "@mezan/domain";
import { useApi } from "../data/ApiContext";
import { ApiError, readError } from "../data/hooks";
import { TextAreaField, TextField } from "../settings/form-controls";
import { useAppTranslation } from "../i18n";

export type ActionReversalType = Exclude<
  ReversalDocumentType,
  ReversalDocumentType.LandedCost | ReversalDocumentType.DepreciationRun | ReversalDocumentType.RecurringJournalTemplate
>;

export interface ReversalTarget {
  readonly id: string;
  readonly params: Readonly<Record<string, string>>;
  readonly subject: string;
}

export interface ReverseDocumentController {
  readonly allowed: boolean;
  readonly pendingId: string | null;
  ask(target: ReversalTarget): Promise<void>;
  menuItems(target: ReversalTarget): RowMenuItem[];
  readonly dialog: ReactNode;
}

interface ReversalVariables {
  readonly target: ReversalTarget;
  readonly reason: string;
  readonly date: string;
}

export function useReverseDocumentAction(type: ActionReversalType): ReverseDocumentController {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const queryClient = useQueryClient();
  const path = DOCUMENT_REVERSAL_PATHS[type];
  const permissions = session?.permissions;
  const allowed = useMemo(
    () => can(createAuthContext({ userId: session?.userId ?? "anonymous", permissions: permissions ?? [], branchScope: "*", warehouseScope: "*" }), path.permission),
    [permissions, session?.userId, path.permission],
  );

  const [asked, setAsked] = useState<ReversalTarget | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const settleRef = useRef<(() => void) | null>(null);

  const mutation = useMutation<void, ApiError, ReversalVariables>({
    mutationFn: async (variables) => {
      const body: { memo?: string; date?: string } = {};
      if (path.takesReason) body.memo = variables.reason;
      if (path.takesDate && variables.date !== "") body.date = variables.date;
      const res = await request(reversalRoute(type, variables.target.params), { method: path.method, body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("reversal.failed"), t));
    },
    onSuccess: async () => {
      setAsked(null);
      settleRef.current?.();
      settleRef.current = null;
      await queryClient.invalidateQueries();
    },
    onError: (err) => setError(err.message),
    onSettled: () => setPendingId(null),
  });

  const ask = useCallback(
    (target: ReversalTarget) =>
      new Promise<void>((resolve) => {
        if (pendingId !== null) return;
        settleRef.current = resolve;
        setReason("");
        setDate("");
        setError(null);
        setAsked(target);
      }),
    [pendingId],
  );

  const action = t(`reversal.${type}.action`);
  const trimmedReason = reason.trim();

  function confirm() {
    if (!asked || pendingId !== null) return;
    if (path.takesReason && trimmedReason === "") return;
    setError(null);
    setPendingId(asked.id);
    mutation.mutate({ target: asked, reason: trimmedReason, date });
  }

  function cancel() {
    if (pendingId !== null) return;
    setAsked(null);
    settleRef.current = null;
  }

  const dialog = (
    <ConfirmDialog
      open={asked !== null}
      tone="danger"
      title={t(`reversal.${type}.title`)}
      confirmLabel={action}
      confirmDisabled={pendingId !== null || (path.takesReason && trimmedReason === "")}
      onConfirm={confirm}
      onCancel={cancel}
      consequence={
        <div className="flex flex-col gap-[12px]">
          <p>{t(`reversal.${type}.consequence`, { subject: asked?.subject ?? "" })}</p>
          {path.takesReason ? <TextAreaField label={t("reversal.reason")} hint={t("reversal.reasonHint")} value={reason} onChange={setReason} rows={2} disabled={pendingId !== null} /> : null}
          {path.takesDate ? <TextField label={t("reversal.date")} hint={t("reversal.dateHint")} type="date" value={date} onChange={setDate} disabled={pendingId !== null} /> : null}
          {pendingId !== null ? <p aria-live="polite">{t("reversal.inProgress")}</p> : null}
          {error ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[10px] py-[8px] text-[12.5px] text-danger-ink">
              {error}
            </div>
          ) : null}
        </div>
      }
    />
  );

  const menuItems = (target: ReversalTarget): RowMenuItem[] =>
    allowed ? [{ key: `reverse-${type}`, label: action, disabled: pendingId === target.id, onSelect: () => ask(target) }] : [];

  return { allowed, pendingId, ask, menuItems, dialog };
}

export interface ReverseDocumentActionProps {
  readonly type: ActionReversalType;
  readonly target: ReversalTarget;
}

export function ReverseDocumentAction({ type, target }: ReverseDocumentActionProps) {
  const { t } = useAppTranslation();
  const reversal = useReverseDocumentAction(type);
  if (!reversal.allowed) return null;
  return (
    <>
      <Button variant="danger-outline" disabled={reversal.pendingId === target.id} onClick={() => void reversal.ask(target)}>
        {t(`reversal.${type}.action`)}
      </Button>
      {reversal.dialog}
    </>
  );
}
