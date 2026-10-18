import { CountedNoun } from "@mezan/domain";
import { useCountPhrase } from "../../../lib/count-phrase";
import { useState } from "react";
import { Button, Card, EmptyState, Money, StatCard, StatusPill, useFormat } from "@mezan/ui";
import { CollectionItemKindDTO, type CollectionCustomerRowDTO, type DunningRunResultDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { errorMessage } from "../../../lib/error-message";
import { useBranchGate } from "../../../shell/useBranchGate";
import { PromiseForm } from "./PromiseForm";
import { useCollectionsWorklist, useRunDunning } from "./hooks";

export interface WorklistTabProps {
  readonly mayRun: boolean;
  readonly mayPromise: boolean;
}

function RunSummary({ result }: { result: DunningRunResultDTO }) {
  const { t } = useAppTranslation();
  if (result.prepared === 0 && result.voided === 0 && result.skippedHeld + result.skippedPromised + result.skippedBelowMinimum === 0) {
    return <div className="text-[12.5px] text-ink-muted">{t("collections.run.nothing")}</div>;
  }
  return (
    <div className="text-[12.5px] text-ink-muted">
      {t("collections.run.result", {
        prepared: result.prepared,
        voided: result.voided,
        held: result.skippedHeld,
        promised: result.skippedPromised,
        minimum: result.skippedBelowMinimum,
      })}
    </div>
  );
}

export function WorklistTab({ mayRun, mayPromise }: WorklistTabProps) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const query = useCollectionsWorklist();
  const run = useRunDunning();
  const { openScreenAt } = useNavigation();
  const gate = useBranchGate();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [promiseFor, setPromiseFor] = useState<string | null>(null);
  const [runningFor, setRunningFor] = useState<string | null | undefined>(undefined);
  const [result, setResult] = useState<DunningRunResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun = mayRun && !gate.restricted;

  function startRun(customerId: string | null) {
    if (runningFor !== undefined) return;
    setRunningFor(customerId);
    setError(null);
    run.mutate(customerId === null ? {} : { customerIds: [customerId] }, {
      onSuccess: setResult,
      onError: (err) => setError(errorMessage(err, t("collections.run.failed"))),
      onSettled: () => setRunningFor(undefined),
    });
  }

  function toggle(customerId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  if (query.isLoading) return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
  if (query.isError || !query.data) {
    return (
      <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
        {query.error?.message ?? t("collections.worklist.loadFailed")}
      </Card>
    );
  }
  const worklist = query.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label={t("collections.worklist.totalOverdue")} value={<Money value={worklist.totalOverdue} />} sub={t("collections.worklist.asOf", { date: fmt.date(worklist.asOfDate) })} valueTone={worklist.customerCount > 0 ? "danger" : "default"} />
        <StatCard label={t("collections.worklist.customers")} value={<span className="mz-num">{worklist.customerCount}</span>} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {mayRun ? (
          <Button variant="primary" disabled={!canRun || runningFor !== undefined} onClick={() => startRun(null)}>
            {runningFor === null ? t("collections.run.running") : t("collections.run.button")}
          </Button>
        ) : null}
        {mayRun && gate.restricted ? <span className="text-[12px] text-ink-faint">{t("collections.run.companyWideOnly")}</span> : null}
        {result ? <RunSummary result={result} /> : null}
      </div>
      {error ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}

      {worklist.rows.length === 0 ? (
        <EmptyState title={t("collections.worklist.empty")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11.5px] font-semibold text-ink-faint">
                <th className="p-3 text-start">{t("collections.worklist.customer")}</th>
                <th className="p-3 text-start">{t("collections.worklist.overdue")}</th>
                <th className="p-3 text-start">{t("collections.worklist.notYetDue")}</th>
                <th className="p-3 text-start">{t("collections.worklist.oldest")}</th>
                <th className="p-3 text-start" />
              </tr>
            </thead>
            <tbody>
              {worklist.rows.map((row: CollectionCustomerRowDTO) => {
                const open = expanded.has(row.customerId);
                return (
                  <FragmentRow
                    key={row.customerId}
                    row={row}
                    open={open}
                    onToggle={() => toggle(row.customerId)}
                    canRun={canRun}
                    runBusy={runningFor !== undefined}
                    onRun={() => startRun(row.customerId)}
                    mayPromise={mayPromise}
                    promiseOpen={promiseFor === row.customerId}
                    onPromise={() => setPromiseFor(promiseFor === row.customerId ? null : row.customerId)}
                    onOpenCustomer={() => openScreenAt("customers", [row.customerId])}
                  />
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

interface FragmentRowProps {
  readonly row: CollectionCustomerRowDTO;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly canRun: boolean;
  readonly runBusy: boolean;
  readonly onRun: () => void;
  readonly mayPromise: boolean;
  readonly promiseOpen: boolean;
  readonly onPromise: () => void;
  readonly onOpenCustomer: () => void;
}

function FragmentRow({ row, open, onToggle, canRun, runBusy, onRun, mayPromise, promiseOpen, onPromise, onOpenCustomer }: FragmentRowProps) {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const fmt = useFormat();
  return (
    <>
      <tr className="border-b border-border align-top">
        <td className="p-3">
          <button
            type="button"
            className="text-start font-semibold text-ink hover:underline"
            aria-expanded={open}
            aria-label={t(open ? "collections.worklist.collapse" : "collections.worklist.expand", { name: row.customerName })}
            onClick={onToggle}
          >
            {row.customerName}
          </button>
          <div className="mt-1 flex flex-wrap gap-2">
            {row.onHold ? <StatusPill tone="warning" label={row.onHold.until ? t("collections.worklist.onHold", { date: fmt.date(row.onHold.until) }) : t("collections.worklist.onHoldOpen")} /> : null}
            {row.pendingPromise ? <StatusPill tone="info" label={t("collections.worklist.hasPromise", { date: fmt.date(row.pendingPromise.promisedDate) })} /> : null}
          </div>
        </td>
        <td className="p-3">
          <Money value={row.overdue} />
        </td>
        <td className="p-3">
          <Money value={row.notYetDue} />
        </td>
        <td className="p-3 mz-num">{t("collections.worklist.days", { days: countPhrase(row.oldestDaysOverdue, CountedNoun.Day) })}</td>
        <td className="p-3">
          <div className="flex flex-wrap justify-end gap-2">
            {canRun ? (
              <Button size="sm" disabled={runBusy} onClick={onRun}>
                {t("collections.worklist.runForCustomer")}
              </Button>
            ) : null}
            {mayPromise ? (
              <Button size="sm" variant="ghost" onClick={onPromise}>
                {t("collections.promises.new")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onOpenCustomer}>
              {t("collections.worklist.openCustomer")}
            </Button>
          </div>
        </td>
      </tr>
      {promiseOpen ? (
        <tr className="border-b border-border">
          <td colSpan={5} className="p-3">
            <PromiseForm customerId={row.customerId} overdue={row.overdue} onDone={onPromise} />
          </td>
        </tr>
      ) : null}
      {open ? (
        <tr className="border-b border-border bg-surface-2">
          <td colSpan={5} className="p-3">
            <WorkItems row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function WorkItems({ row }: { row: CollectionCustomerRowDTO }) {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const fmt = useFormat();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
        <thead>
          <tr className="text-[11px] font-semibold text-ink-faint">
            <th className="p-2 text-start">{t("collections.worklist.document")}</th>
            <th className="p-2 text-start">{t("collections.worklist.dueDate")}</th>
            <th className="p-2 text-start">{t("collections.worklist.oldest")}</th>
            <th className="p-2 text-start">{t("collections.worklist.amount")}</th>
            <th className="p-2 text-start">{t("collections.worklist.nextStep")}</th>
            <th className="p-2 text-start">{t("collections.worklist.lastReminder")}</th>
          </tr>
        </thead>
        <tbody>
          {row.items.map((item) => (
            <tr key={item.key} className="border-t border-border">
              <td className="p-2">
                <span className="mz-num">{item.reference ?? t("collections.worklist.kind.receivable_other")}</span>{" "}
                <span className="text-ink-faint">({t(`collections.worklist.kind.${item.kind}` as AppTranslationKey)})</span>
                {item.kind === CollectionItemKindDTO.Installment && item.detail ? <div className="text-[11px] text-ink-faint">{item.detail}</div> : null}
              </td>
              <td className="p-2">{fmt.date(item.dueDate)}</td>
              <td className="p-2 mz-num">{t("collections.worklist.days", { days: countPhrase(item.daysOverdue, CountedNoun.Day) })}</td>
              <td className="p-2">
                <Money value={item.amount} />
              </td>
              <td className="p-2">
                {item.nextStepLevel === null ? t("collections.worklist.noNextStep") : t("collections.worklist.nextStepLevel", { level: item.nextStepLevel })}
              </td>
              <td className="p-2">
                {item.lastReminderStatus ? t(`collections.reminders.status.${item.lastReminderStatus}` as AppTranslationKey) : t("collections.currency.none")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
