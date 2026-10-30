import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Money as MoneyDisplay, MoneyInput, QtyInput, StatusPill, VarianceBeam, type PillTone } from "@mezan/ui";
import {
  VanReconciliationStepKindDTO,
  VanReconciliationStepStateDTO,
  VanTripStatusDTO,
  type SettleVanTripDTO,
  type VanTripCashBreakdownDTO,
  type VanTripDTO,
} from "@mezan/contracts";
import { ApiError } from "../../../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { majorOf, scaledOf, toMajorNumber } from "../../../lib/money";
import { useApproveVanTrip, useVanTripExpectation } from "./hooks";
import { useMaySeeItemCost } from "../../../data/item-cost";

const STEP_KEY: Record<VanReconciliationStepKindDTO, AppTranslationKey> = {
  [VanReconciliationStepKindDTO.CashVariance]: "vanRecon.step.cash_variance",
  [VanReconciliationStepKindDTO.CashReturn]: "vanRecon.step.cash_return",
  [VanReconciliationStepKindDTO.OverageAdjustment]: "vanRecon.step.overage_adjustment",
  [VanReconciliationStepKindDTO.StockReturn]: "vanRecon.step.stock_return",
  [VanReconciliationStepKindDTO.ShortageAdjustment]: "vanRecon.step.shortage_adjustment",
};

const STEP_STATE: Record<VanReconciliationStepStateDTO, { key: AppTranslationKey; tone: PillTone }> = {
  [VanReconciliationStepStateDTO.Posted]: { key: "vanRecon.state.posted", tone: "success" },
  [VanReconciliationStepStateDTO.Held]: { key: "vanRecon.state.held", tone: "warning" },
};

function decimalOf(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  return `${negative ? "-" : ""}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0")}`;
}

function varianceTone(scaled: bigint): PillTone {
  if (scaled === 0n) return "neutral";
  return scaled > 0n ? "success" : "danger";
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <MoneyDisplay value={value} className="mt-[4px] text-[13px] font-bold" />
    </div>
  );
}

function CashBreakdown({ breakdown }: { breakdown: VanTripCashBreakdownDTO }) {
  const { t } = useAppTranslation();
  const rows: [AppTranslationKey, string][] = [
    ["vanRecon.cash.openingFloat", breakdown.openingFloat],
    ["vanRecon.cash.fieldSales", breakdown.fieldSales],
    ["vanRecon.cash.fieldCollections", breakdown.fieldCollections],
    ["vanRecon.cash.voucherCollections", breakdown.voucherCollections],
    ["vanRecon.cash.other", breakdown.other],
  ];
  return (
    <dl className="grid grid-cols-1 gap-[4px] text-[12px] sm:grid-cols-2">
      {rows.map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-[8px] rounded-md bg-surface-2 px-[8px] py-[5px]">
          <dt className="text-ink-muted">{t(key)}</dt>
          <dd>
            <MoneyDisplay value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface CountFormProps {
  readonly trip: VanTripDTO;
  readonly itemName: (id: string) => string;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (body: SettleVanTripDTO) => Promise<void>;
}

/**
 * The count sheet. Every expected figure comes from `GET /expected` — the van
 * warehouse's on-hand and the van till's own balance — never from arithmetic
 * in the browser, and the counted quantity starts at that figure.
 */
export function VanTripCountForm({ trip, itemName, pending, onCancel, onSubmit }: CountFormProps) {
  const { t } = useAppTranslation();
  const expectation = useVanTripExpectation(trip.id, true);
  const [countedCash, setCountedCash] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const data = expectation.data;

  useEffect(() => {
    if (!data || seeded) return;
    setCounts(Object.fromEntries(data.lines.map((l) => [l.itemId, majorOf(l.expectedQty)])));
    setCountedCash(majorOf(data.expectedCash));
    setSeeded(true);
  }, [data, seeded]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    setError(null);
    try {
      await onSubmit({
        countedCash: (countedCash ?? 0).toFixed(6),
        stockCounts: data.lines.map((l) => ({ itemId: l.itemId, countedQty: (counts[l.itemId] ?? 0).toFixed(6) })),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("vanTrips.couldNotSettleTheTrip"));
    }
  }

  const cashVariance = data ? scaledOf((countedCash ?? 0).toFixed(6)) - scaledOf(data.expectedCash) : 0n;

  return (
    <Card className="p-[13px_15px]">
      <h3 className="mb-[4px] font-display text-[13px] font-bold text-ink">{t("vanTrips.settleTheTrip")}</h3>
      <p className="mb-[10px] text-[11.5px] text-ink-faint">{t("vanRecon.countHint")}</p>
      {error ? (
        <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {expectation.isError ? (
        <div role="alert" className="mb-[10px] text-[12.5px] text-danger-ink">
          {expectation.error.message}
        </div>
      ) : null}
      {!data ? (
        <div className="text-[12.5px] text-ink-muted">{expectation.isLoading ? t("vanRecon.loadingExpected") : null}</div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
            <Figure label={t("vanRecon.expectedCash")} value={data.expectedCash} />
            <div>
              <div className="mb-[6px] text-[11px] font-semibold text-ink-faint">{t("vanTrips.cashCounted")}</div>
              <MoneyInput value={countedCash} onChange={setCountedCash} aria-label={t("vanTrips.cashCounted")} />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.difference")}</div>
              <StatusPill label={String(toMajorNumber(cashVariance))} tone={varianceTone(cashVariance)} className="mt-[4px]" />
            </div>
          </div>
          <CashBreakdown breakdown={data.cashBreakdown} />

          {data.lines.length === 0 ? (
            <div className="text-[12.5px] text-ink-muted">{t("vanRecon.noStockOnVan")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12.5px]">
                <thead>
                  <tr className="text-ink-faint">
                    <th className="p-[6px] text-start">{t("common.item")}</th>
                    <th className="p-[6px] text-end">{t("vanRecon.loaded")}</th>
                    <th className="p-[6px] text-end">{t("vanRecon.sold")}</th>
                    <th className="p-[6px] text-end">{t("vanRecon.returned")}</th>
                    <th className="p-[6px] text-end">{t("vanRecon.other")}</th>
                    <th className="p-[6px] text-end">{t("vanTrips.expected")}</th>
                    <th className="p-[6px] text-end">{t("vanTrips.counted")}</th>
                    <th className="p-[6px] text-end">{t("vanTrips.difference")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line) => {
                    const counted = counts[line.itemId] ?? 0;
                    const variance = scaledOf(counted.toFixed(6)) - scaledOf(line.expectedQty);
                    return (
                      <tr key={line.itemId} className="border-t border-border">
                        <td className="p-[6px] text-ink">{itemName(line.itemId)}</td>
                        <td className="mz-num p-[6px] text-end text-ink-muted">{majorOf(line.loadedQty)}</td>
                        <td className="mz-num p-[6px] text-end text-ink-muted">{majorOf(line.soldQty)}</td>
                        <td className="mz-num p-[6px] text-end text-ink-muted">{majorOf(line.returnedQty)}</td>
                        <td className="mz-num p-[6px] text-end text-ink-muted">{majorOf(line.otherQty)}</td>
                        <td className="mz-num p-[6px] text-end font-semibold text-ink">{majorOf(line.expectedQty)}</td>
                        <td className="p-[6px]">
                          <QtyInput
                            aria-label={t("vanTrips.countedQtyLabel", { item: itemName(line.itemId) })}
                            value={counted}
                            onChange={(v) => setCounts((c) => ({ ...c, [line.itemId]: v }))}
                          />
                        </td>
                        <td className="p-[6px] text-end">
                          <VarianceBeam value={toMajorNumber(variance)}>
                            <span className="mz-num">{toMajorNumber(variance)}</span>
                          </VarianceBeam>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end gap-[9px]">
            <Button type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("vanTrips.confirmTheSettlement")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

interface ReconciliationCardProps {
  readonly trip: VanTripDTO;
  readonly itemName: (id: string) => string;
  readonly userName: (id: string) => string;
  readonly mayApprove: boolean;
  readonly currentUserId: string | null;
}

/** The entered settlement, what approving it will post, and — once approved — what it did post. */
export function VanTripReconciliationCard({ trip, itemName, userName, mayApprove, currentUserId }: ReconciliationCardProps) {
  const { t } = useAppTranslation();
  const approve = useApproveVanTrip();
  const showCost = useMaySeeItemCost();
  const [message, setMessage] = useState<{ tone: "danger" | "warning"; text: string } | null>(null);
  const settlement = trip.settlement;
  if (!settlement) return null;

  const awaiting = trip.status === VanTripStatusDTO.AwaitingApproval;
  const ownCount = settlement.settledBy !== null && settlement.settledBy === currentUserId;
  const reconciliation = settlement.reconciliation;
  const cashVariance = scaledOf(settlement.cashVariance);
  const shortage = settlement.stockCounts.reduce((sum, l) => (scaledOf(l.varianceValue) < 0n ? sum - scaledOf(l.varianceValue) : sum), 0n);
  const overage = settlement.stockCounts.reduce((sum, l) => (scaledOf(l.varianceValue) > 0n ? sum + scaledOf(l.varianceValue) : sum), 0n);

  async function handleApprove() {
    setMessage(null);
    try {
      const result = await approve.mutateAsync({ id: trip.id });
      if (result.held) setMessage({ tone: "warning", text: t("vanRecon.heldNotice") });
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : t("vanRecon.approveFailed") });
    }
  }

  return (
    <Card className="p-[13px_15px]">
      <div className="mb-[10px] flex flex-wrap items-center justify-between gap-[8px]">
        <h3 className="font-display text-[13px] font-bold text-ink">{t("vanTrips.settlement")}</h3>
        {settlement.settledBy ? (
          <span className="text-[11.5px] text-ink-faint">{t("vanRecon.countedBy", { name: userName(settlement.settledBy) })}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-[10px]">
        <Figure label={t("vanTrips.expected")} value={settlement.expectedCash} />
        <Figure label={t("vanTrips.counted")} value={settlement.countedCash} />
        <div>
          <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.difference")}</div>
          <StatusPill label={String(majorOf(settlement.cashVariance))} tone={varianceTone(cashVariance)} className="mt-[4px]" />
        </div>
      </div>
      {settlement.cashBreakdown ? (
        <div className="mt-[10px]">
          <CashBreakdown breakdown={settlement.cashBreakdown} />
        </div>
      ) : null}

      {settlement.stockCounts.length > 0 ? (
        <div className="mt-[12px] overflow-x-auto">
          <table className="w-full min-w-[440px] text-[12.5px]">
            <thead>
              <tr className="text-ink-faint">
                <th className="p-[6px] text-start">{t("common.item")}</th>
                <th className="p-[6px] text-end">{t("vanTrips.expected")}</th>
                <th className="p-[6px] text-end">{t("vanTrips.counted")}</th>
                <th className="p-[6px] text-end">{t("vanTrips.difference")}</th>
                {showCost ? <th className="p-[6px] text-end">{t("vanRecon.valueAtCost")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {settlement.stockCounts.map((line) => (
                <tr key={line.itemId} className="border-t border-border">
                  <td className="p-[6px] text-ink">{itemName(line.itemId)}</td>
                  <td className="mz-num p-[6px] text-end text-ink">{majorOf(line.expectedQty)}</td>
                  <td className="mz-num p-[6px] text-end text-ink">{majorOf(line.countedQty)}</td>
                  <td className="p-[6px] text-end">
                    <VarianceBeam value={majorOf(line.varianceQty)}>
                      <span className="mz-num">{majorOf(line.varianceQty)}</span>
                    </VarianceBeam>
                  </td>
                  {showCost ? (
                    <td className="p-[6px] text-end">
                      <MoneyDisplay value={line.varianceValue} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showCost ? (
        <div className="mt-[12px] grid grid-cols-2 gap-[10px]">
          <Figure label={t("vanRecon.shortageValue")} value={decimalOf(shortage)} />
          <Figure label={t("vanRecon.overageValue")} value={decimalOf(overage)} />
        </div>
      ) : null}

      {reconciliation && reconciliation.steps.length > 0 ? (
        <div className="mt-[12px]">
          <div className="mb-[6px] text-[11px] font-semibold text-ink-faint">{t("vanRecon.postings")}</div>
          <ul className="flex flex-col gap-[6px]">
            {reconciliation.steps.map((step) => (
              <li key={step.kind} className="flex flex-wrap items-center justify-between gap-[8px] rounded-md border border-border px-[10px] py-[6px] text-[12.5px]">
                <span className="text-ink">{t(STEP_KEY[step.kind])}</span>
                <span className="flex items-center gap-[8px]">
                  {step.value !== null ? <MoneyDisplay value={step.value} /> : null}
                  <StatusPill label={t(STEP_STATE[step.state].key)} tone={STEP_STATE[step.state].tone} />
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-[6px] text-[11.5px] text-ink-faint">{t("vanRecon.approvedBy", { name: userName(reconciliation.approvedBy) })}</div>
        </div>
      ) : null}

      {message ? (
        <div
          role={message.tone === "danger" ? "alert" : "status"}
          className={
            message.tone === "danger"
              ? "mt-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
              : "mt-[10px] rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink"
          }
        >
          {message.text}
        </div>
      ) : null}

      {awaiting && mayApprove ? (
        <div className="mt-[12px] flex flex-col gap-[6px]">
          <p className="text-[11.5px] text-ink-faint">{ownCount ? t("vanRecon.ownCountNotice") : t("vanRecon.approveHint")}</p>
          <Button variant="primary" disabled={approve.isPending || ownCount} onClick={handleApprove}>
            {reconciliation && reconciliation.steps.length > 0 ? t("vanRecon.resumeApproval") : t("vanRecon.approve")}
          </Button>
        </div>
      ) : null}
      {awaiting && !mayApprove ? <p className="mt-[12px] text-[11.5px] text-ink-faint">{t("vanRecon.waitingForApprover")}</p> : null}
    </Card>
  );
}
