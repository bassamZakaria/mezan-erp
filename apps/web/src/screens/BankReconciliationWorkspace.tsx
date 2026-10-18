import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  EntityPicker,
  SidePanel,
  StatusPill,
  cn,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { bankStatementStatusLabel } from "../domain-labels";
import {
  BankRuleDirectionCode,
  BankRuleMatchTypeCode,
  MatchSourceCode,
  type BankRuleDTO,
  type BankRuleInputDTO,
  type MatchCandidateDTO,
  type MatchSuggestionDTO,
  type ReconciliationPositionDTO,
  type ReviewItemDTO,
  type StatementLineDTO,
} from "@mezan/contracts";
import { NumberField, SelectField, TextAreaField, TextField, ToggleField } from "../settings/form-controls";
import {
  useAccounts,
  useBankStatement,
  useCostCenters,
  useStatementMatchCandidates,
  useTreasuryAccounts,
  useBranches,
  useUnmatchStatementLine,
} from "../data/hooks";
import {
  useAcceptSuggestion,
  useBankRules,
  useBankStatementReview,
  useCreateBankRule,
  useCreateEntryFromLine,
  useDeleteBankRule,
  useFinalizeStatement,
  useMatchManyEntries,
  useRejectSuggestion,
  useSuggestMatches,
  useUpdateBankRule,
} from "../data/bank-rec-hooks";
import { useAppTranslation } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { errorMessage } from "../lib/error-message";
import { scaledOf, sumScaled } from "../lib/money";

const STATUS_TONE: Record<string, PillTone> = { imported: "neutral", in_progress: "warning", completed: "success" };

export function formatExactMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const padded = fraction.padEnd(6, "0");
  const significant = padded.replace(/0+$/, "");
  const shown = significant.length <= 2 ? padded.slice(0, 2) : significant;
  const grouped = (whole.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const zero = /^0*$/.test(whole) && /^0*$/.test(padded);
  return `${negative && !zero ? "-" : ""}${grouped}.${shown}`;
}

function ExactMoney({ value, className }: { value: string | null | undefined; className?: string }) {
  return (
    <span dir="ltr" className={cn("mz-num", className)}>
      {formatExactMoney(value)}
    </span>
  );
}

function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  return `${negative ? "-" : ""}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0")}`;
}

type Tab = "review" | "matched";

export function StatementWorkspace({
  statementId,
  onClose,
  accountName,
}: {
  statementId: string | null;
  onClose: () => void;
  accountName: (id: string) => string;
}) {
  const { t } = useAppTranslation();
  const detail = useBankStatement(statementId);
  const review = useBankStatementReview(statementId);
  const candidates = useStatementMatchCandidates(statementId);
  const suggest = useSuggestMatches();
  const finalize = useFinalizeStatement();

  const [tab, setTab] = useState<Tab>("review");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [finalizeAsked, setFinalizeAsked] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const statement = detail.data ?? null;
  const position = review.data?.position ?? null;
  const locked = statement?.status === "completed";
  const itemsByLine = useMemo(() => new Map((review.data?.items ?? []).map((item) => [item.lineId, item])), [review.data]);
  const openLines = (statement?.lines ?? []).filter((l) => l.status !== "matched");
  const matchedLines = (statement?.lines ?? []).filter((l) => l.status === "matched");

  async function runLine(lineId: string, fn: () => Promise<string | null | void>) {
    if (pendingLineId) return;
    setPendingLineId(lineId);
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      if (message) setNotice(message);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    } finally {
      setPendingLineId(null);
    }
  }

  async function runStatement(fn: () => Promise<string | null | void>) {
    setError(null);
    setNotice(null);
    try {
      const message = await fn();
      if (message) setNotice(message);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    }
  }

  const needsOverride = position !== null && (position.unmatchedLines.count > 0 || scaledOf(position.difference) !== 0n);

  return (
    <>
    <SidePanel
      open={statementId !== null}
      onClose={onClose}
      className="w-[820px]"
      title={statement ? t("bankRec.reconcileNamed", { account: accountName(statement.treasuryAccountId) }) : t("bankRec.reconcileABankStatement")}
    >
      {detail.isLoading ? <div className="text-[12.5px] text-ink-muted">{t("common.loading")}</div> : null}
      {detail.isError ? <div role="alert" className="text-[12.5px] text-danger">{detail.error?.message}</div> : null}
      {statement ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-[10px]">
            <StatusPill label={bankStatementStatusLabel(statement.status, t)} tone={STATUS_TONE[statement.status] ?? "neutral"} />
            <span className="mz-num text-[12px] text-ink-muted">
              {statement.periodStart} — {statement.periodEnd}
            </span>
            {statement.statementNumber ? <span className="mz-num text-[12px] text-ink-faint">{statement.statementNumber}</span> : null}
          </div>

          {locked && statement.finalizeOverrideReason ? (
            <div className="rounded-[8px] border border-warning bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">
              {t("bankRecX.finalizedOverride", { reason: statement.finalizeOverrideReason })}
            </div>
          ) : null}

          {position ? <PositionCard position={position} /> : review.isError ? (
            <div role="alert" className="text-[12.5px] text-danger">{review.error?.message}</div>
          ) : null}

          {error ? <div role="alert" className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
          {notice ? <div role="status" className="rounded-[8px] bg-info-soft px-3 py-2 text-[12.5px] text-info-ink">{notice}</div> : null}

          <div className="flex flex-wrap gap-2">
            {locked ? null : (
              <Button
                variant="primary"
                disabled={suggest.isPending}
                onClick={() =>
                  runStatement(async () => {
                    const result = await suggest.mutateAsync(statement.id);
                    return t("bankRecX.suggestDone", { matched: String(result.matchedCount), suggested: String(result.suggestedCount) });
                  })
                }
              >
                {t("bankRecX.suggest")}
              </Button>
            )}
            <Button onClick={() => setRulesOpen(true)}>{t("bankRecX.rules")}</Button>
            {locked ? null : (
              <Button
                disabled={finalize.isPending || position === null}
                onClick={() => {
                  if (needsOverride) {
                    setOverrideReason("");
                    setOverrideOpen(true);
                    return;
                  }
                  setFinalizeAsked(true);
                }}
              >
                {t("bankRec.finishReconciliation")}
              </Button>
            )}
          </div>

          <div role="tablist" className="flex gap-2 border-b border-border">
            {(["review", "matched"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold",
                  tab === key ? "border-brand text-brand" : "border-transparent text-ink-muted",
                )}
              >
                {key === "review" ? t("bankRecX.forReview") : t("bankRecX.matchedTab")}{" "}
                <span className="mz-num">({key === "review" ? openLines.length : matchedLines.length})</span>
              </button>
            ))}
          </div>

          {tab === "review" ? (
            openLines.length === 0 ? (
              <EmptyState title={t("bankRecX.nothingToReview")} />
            ) : (
              <div className="flex flex-col gap-3">
                {openLines.map((line) => (
                  <ReviewLineCard
                    key={line.id}
                    statementId={statement.id}
                    treasuryAccountId={statement.treasuryAccountId}
                    companyLevel={statement.branchId === null}
                    line={line}
                    item={itemsByLine.get(line.id)}
                    candidates={candidates.data ?? []}
                    locked={locked}
                    pending={pendingLineId === line.id}
                    run={(fn) => runLine(line.id, fn)}
                  />
                ))}
              </div>
            )
          ) : matchedLines.length === 0 ? (
            <EmptyState title={t("bankRecX.noMatchedYet")} />
          ) : (
            <div className="flex flex-col gap-2">
              {matchedLines.map((line) => (
                <MatchedLineCard
                  key={line.id}
                  statementId={statement.id}
                  line={line}
                  locked={locked}
                  pending={pendingLineId === line.id}
                  run={(fn) => runLine(line.id, fn)}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </SidePanel>

      <ConfirmDialog
        open={overrideOpen}
        title={t("bankRecX.finalizeOverrideTitle")}
        tone="danger"
        consequence={
          <div className="flex flex-col gap-3">
            <p>
              {t("bankRecX.finalizeOverrideBody", {
                count: String(position?.unmatchedLines.count ?? 0),
                difference: formatExactMoney(position?.difference),
              })}
            </p>
            <TextAreaField label={t("bankRecX.overrideReason")} value={overrideReason} onChange={setOverrideReason} rows={3} />
          </div>
        }
        confirmLabel={t("bankRecX.finalizeAnyway")}
        confirmDisabled={overrideReason.trim() === "" || finalize.isPending}
        onCancel={() => setOverrideOpen(false)}
        onConfirm={() => {
          if (!statement) return;
          setOverrideOpen(false);
          void runStatement(async () => {
            await finalize.mutateAsync({ statementId: statement.id, force: true, reason: overrideReason.trim() });
          });
        }}
      />

      <ConfirmDialog
        open={finalizeAsked}
        title={t("bankRecX.finalizeConfirmTitle")}
        tone="danger"
        consequence={<p>{t("bankRecX.finalizeConfirmBody")}</p>}
        confirmLabel={t("bankRecX.finalizeConfirm")}
        confirmDisabled={finalize.isPending}
        onCancel={() => setFinalizeAsked(false)}
        onConfirm={() => {
          if (!statement) return;
          setFinalizeAsked(false);
          void runStatement(async () => {
            await finalize.mutateAsync({ statementId: statement.id });
          });
        }}
      />

      <BankRulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  );
}

function PositionCard({ position }: { position: ReconciliationPositionDTO }) {
  const { t } = useAppTranslation();
  const balanced = scaledOf(position.difference) === 0n;
  const gap = scaledOf(position.statementArithmeticGap);
  const rows: { label: string; value: string | null; hint?: string }[] = [
    { label: t("bankRecX.statementClosing"), value: position.closingBalance },
    { label: t("bankRecX.clearedBalance"), value: position.clearedBalance },
    { label: t("bankRecX.bookBalance"), value: position.bookBalance },
    { label: t("bankRecX.bookDifference"), value: position.bookDifference },
    {
      label: t("bankRecX.unmatchedLines"),
      value: position.unmatchedLines.total,
      hint: String(position.unmatchedLines.count),
    },
    {
      label: t("bankRecX.outstandingBook"),
      value: position.outstandingBook.total,
      hint: String(position.outstandingBook.count),
    },
    { label: t("bankRecX.unexplained"), value: position.unexplainedBookDifference },
  ];
  return (
    <Card className="flex flex-col gap-3 p-[14px]">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-[10px] border px-3 py-2",
          balanced ? "border-success bg-success-soft" : "border-danger bg-danger-soft",
        )}
      >
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-ink">{t("bankRecX.difference")}</div>
          <div className="text-[11px] text-ink-muted">{t("bankRecX.differenceHint")}</div>
        </div>
        <div className="flex items-center gap-2">
          <ExactMoney value={position.difference} className={cn("text-[18px] font-bold", balanced ? "text-success-ink" : "text-danger-ink")} />
          {balanced ? <StatusPill label={t("bankRecX.reconciled")} tone="success" /> : null}
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-[12.5px] sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 rounded-[8px] border border-border px-3 py-2">
            <dt className="text-ink-muted">
              {row.label}
              {row.hint ? <span className="mz-num text-ink-faint"> ({row.hint})</span> : null}
            </dt>
            <dd>
              <ExactMoney value={row.value} className="text-ink" />
            </dd>
          </div>
        ))}
      </dl>
      {gap !== 0n ? (
        <div role="alert" className="rounded-[8px] border border-warning bg-warning-soft px-3 py-2 text-[12px] text-warning-ink">
          {t("bankRecX.arithmeticGap", { amount: formatExactMoney(position.statementArithmeticGap) })}
        </div>
      ) : null}
    </Card>
  );
}

function LineHeader({ line }: { line: StatementLineDTO }) {
  const negative = scaledOf(line.amount) < 0n;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="break-words text-[13px] text-ink">{line.description}</div>
        <div className="mz-num mt-[2px] text-[11px] text-ink-faint">
          {line.date}
          {line.reference ? ` · ${line.reference}` : ""}
          {line.counterparty ? ` · ${line.counterparty}` : ""}
        </div>
      </div>
      <ExactMoney value={line.amount} className={cn("flex-none text-[13px] font-semibold", negative ? "text-danger-ink" : "text-success-ink")} />
    </div>
  );
}

function confidenceTone(score: number): PillTone {
  if (score >= 90) return "success";
  if (score >= 70) return "warning";
  return "neutral";
}

function SuggestionRow({
  suggestion,
  disabled,
  onAccept,
  onReject,
}: {
  suggestion: MatchSuggestionDTO;
  disabled: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={t("bankRecX.confidence", { score: String(suggestion.score) })} tone={confidenceTone(suggestion.score)} />
        {suggestion.entries.length > 1 ? (
          <span className="text-[11.5px] text-ink-muted">{t("bankRecX.split", { count: String(suggestion.entries.length) })}</span>
        ) : null}
        <span className="text-[11px] text-ink-faint">
          {t("bankRecX.scoreBreakdown", {
            amount: String(suggestion.amountScore),
            date: String(suggestion.dateScore),
            reference: String(suggestion.referenceScore),
            counterparty: String(suggestion.counterpartyScore),
          })}
          {" · "}
          {t("bankRecX.daysApart", { days: String(suggestion.dateDeltaDays) })}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {suggestion.entries.map((entry) => (
          <li key={entry.entryId} className="flex items-start justify-between gap-2 text-[12px]">
            <div className="min-w-0">
              <span className="mz-num font-semibold text-ink">{entry.entryNo ?? entry.docNo ?? entry.entryId}</span>
              <span className="text-ink-muted"> · {entry.date}</span>
              {entry.description ? <span className="text-ink-muted"> · {entry.description}</span> : null}
              {entry.counterparty ? <span className="text-ink-faint"> · {entry.counterparty}</span> : null}
            </div>
            <ExactMoney value={entry.amount} className="flex-none text-ink" />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={disabled} onClick={onAccept}>
          {t("bankRecX.accept")}
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onReject}>
          {t("bankRecX.reject")}
        </Button>
      </div>
    </div>
  );
}

export function useGrantedBranchOptions(): EntityPickerOption[] {
  const branches = useBranches();
  return useMemo(() => (branches.data ?? []).filter((branch) => branch.active).map((branch) => ({ id: branch.id, label: branch.name })), [branches.data]);
}

function useCounterAccountOptions(): EntityPickerOption[] {
  const nameOf = useEntityName();
  const accounts = useAccounts();
  return useMemo(
    () =>
      (accounts.data ?? [])
        .filter((a) => !a.isHeader && a.status === "active" && (a.type === "expense" || a.type === "revenue"))
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((a) => ({ id: a.id, label: `${a.code} — ${nameOf(a)}` })),
    [accounts.data, nameOf],
  );
}

function useCostCenterOptions(): { value: string; label: string }[] {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const centers = useCostCenters();
  return useMemo(
    () => [
      { value: "", label: t("bankRecX.noCostCenter") },
      ...(centers.data ?? []).filter((c) => c.status === "active").map((c) => ({ value: c.id, label: `${c.code} — ${nameOf(c)}` })),
    ],
    [centers.data, nameOf, t],
  );
}

function ReviewLineCard({
  statementId,
  companyLevel,
  line,
  item,
  candidates,
  locked,
  pending,
  run,
}: {
  statementId: string;
  treasuryAccountId: string;
  companyLevel: boolean;
  line: StatementLineDTO;
  item: ReviewItemDTO | undefined;
  candidates: readonly MatchCandidateDTO[];
  locked: boolean;
  pending: boolean;
  run: (fn: () => Promise<string | null | void>) => void;
}) {
  const { t } = useAppTranslation();
  const accept = useAcceptSuggestion();
  const reject = useRejectSuggestion();
  const matchMany = useMatchManyEntries();
  const createEntry = useCreateEntryFromLine();
  const accountOptions = useCounterAccountOptions();
  const costCenterOptions = useCostCenterOptions();
  const branchOptions = useGrantedBranchOptions();

  const [mode, setMode] = useState<"manual" | "entry" | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const rule = item?.rule ?? null;
  const [accountId, setAccountId] = useState(rule?.accountId ?? "");
  const [costCenterId, setCostCenterId] = useState(rule?.costCenterId ?? "");
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState(line.date);
  const [memo, setMemo] = useState("");

  const lineScaled = scaledOf(line.amount);
  const sameDirection = useMemo(
    () =>
      candidates
        .filter((c) => {
          const amount = scaledOf(c.amount);
          return lineScaled > 0n ? amount > 0n : amount < 0n;
        })
        .sort((a, b) => Number(scaledOf(b.amount) === lineScaled) - Number(scaledOf(a.amount) === lineScaled) || a.date.localeCompare(b.date)),
    [candidates, lineScaled],
  );
  const selectedTotal = sumScaled(sameDirection.filter((c) => selected.has(c.entryId)).map((c) => c.amount));
  const ruleAccountLabel = rule ? (accountOptions.find((o) => o.id === rule.accountId)?.label ?? rule.accountId) : "";
  const disabled = locked || pending;

  function toggle(entryId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  function openEntryForm() {
    setAccountId(rule?.accountId ?? accountId);
    setCostCenterId(rule?.costCenterId ?? costCenterId);
    setMode(mode === "entry" ? null : "entry");
  }

  const postedMessage = (result: { held: boolean; voucherNo: string | null; voucherId: string }) =>
    result.held
      ? t("bankRecX.entryHeld", { voucher: result.voucherNo ?? result.voucherId })
      : t("bankRecX.entryPosted", { voucher: result.voucherNo ?? result.voucherId });

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border p-3">
      <LineHeader line={line} />

      {item && item.suggestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          {item.suggestions.map((suggestion) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              disabled={disabled}
              onAccept={() => run(async () => void (await accept.mutateAsync({ statementId, suggestionId: suggestion.id })))}
              onReject={() => run(async () => void (await reject.mutateAsync({ statementId, suggestionId: suggestion.id })))}
            />
          ))}
        </div>
      ) : (
        <div className="text-[11.5px] text-ink-muted">{t("bankRecX.noSuggestion")}</div>
      )}

      {rule ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-brand-soft px-3 py-2 text-[12px] text-ink">
          <span className="min-w-0 break-words">{t("bankRecX.ruleApplies", { name: rule.name, account: ruleAccountLabel })}</span>
          <Button
            size="sm"
            variant="primary"
            disabled={disabled}
            onClick={() => run(async () => postedMessage(await createEntry.mutateAsync({ statementId, lineId: line.id, body: { ruleId: rule.id } })))}
          >
            {t("bankRecX.createEntryWithRule")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} aria-expanded={mode === "manual"} onClick={() => setMode(mode === "manual" ? null : "manual")}>
          {t("bankRecX.manualMatch")}
        </Button>
        <Button size="sm" disabled={disabled} aria-expanded={mode === "entry"} onClick={openEntryForm}>
          {t("bankRecX.createEntry")}
        </Button>
      </div>

      {mode === "manual" ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-border p-3">
          {sameDirection.length === 0 ? (
            <div className="text-[12px] text-ink-muted">{t("bankRecX.noCandidates")}</div>
          ) : (
            <ul className="flex max-h-[260px] flex-col gap-1 overflow-y-auto">
              {sameDirection.map((candidate) => (
                <li key={candidate.entryId} className="flex items-start justify-between gap-2">
                  <Checkbox
                    checked={selected.has(candidate.entryId)}
                    onChange={() => toggle(candidate.entryId)}
                    disabled={disabled}
                    label={
                      <span className="text-[12px]">
                        <span className="mz-num font-semibold">{candidate.entryNo ?? candidate.entryId}</span>
                        <span className="text-ink-muted"> · {candidate.date}</span>
                        {candidate.description ? <span className="text-ink-muted"> · {candidate.description}</span> : null}
                      </span>
                    }
                  />
                  <ExactMoney value={candidate.amount} className="flex-none text-[12px] text-ink" />
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn("text-[12px]", selectedTotal === lineScaled ? "text-success-ink" : "text-ink-muted")}>
              {t("bankRecX.selectedTotal", { selected: formatExactMoney(fromScaled(selectedTotal)), target: formatExactMoney(line.amount) })}
            </span>
            <Button
              size="sm"
              variant="primary"
              disabled={disabled || selected.size === 0 || selectedTotal !== lineScaled}
              onClick={() =>
                run(async () => {
                  await matchMany.mutateAsync({ statementId, lineId: line.id, entryIds: [...selected] });
                  setSelected(new Set());
                  setMode(null);
                })
              }
            >
              {t("bankRecX.matchSelected")}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "entry" ? (
        <div className="flex flex-col gap-3 rounded-[8px] border border-border p-3">
          <div className="text-[12px] font-semibold text-ink">
            {lineScaled < 0n ? t("bankRecX.entryKindCharge") : t("bankRecX.entryKindInterest")}
          </div>
          <EntityPicker
            label={t("bankRecX.counterAccount")}
            value={accountOptions.find((o) => o.id === accountId) ?? null}
            onChange={(o) => setAccountId(o?.id ?? "")}
            options={accountOptions}
            placeholder={t("bankRecX.chooseAccount")}
            emptyMessage={t("bankRecX.noAccounts")}
          />
          <SelectField label={t("bankRecX.costCenter")} value={costCenterId} onChange={setCostCenterId} options={costCenterOptions} />
          {companyLevel ? (
            <div>
              <EntityPicker
                label={t("bankRecX.chargeBranch")}
                value={branchOptions.find((o) => o.id === branchId) ?? null}
                onChange={(o) => setBranchId(o?.id ?? "")}
                options={branchOptions}
                placeholder={t("bankRecX.chargeBranchPlaceholder")}
                emptyMessage={t("bankRecX.noBranches")}
              />
              <p className="mt-[4px] text-[11.5px] text-ink-faint">{t("bankRecX.chargeBranchHint")}</p>
            </div>
          ) : null}
          <TextField label={t("bankRecX.entryDate")} type="date" value={date} onChange={setDate} hint={t("bankRecX.entryDateHint")} />
          <TextField label={t("bankRecX.memo")} value={memo} onChange={setMemo} placeholder={line.description} />
          <div>
            <Button
              variant="primary"
              disabled={disabled || accountId === "" || date === "" || date < line.date}
              onClick={() =>
                run(async () => {
                  const result = await createEntry.mutateAsync({
                    statementId,
                    lineId: line.id,
                    body: {
                      accountId,
                      costCenterId: costCenterId === "" ? null : costCenterId,
                      date,
                      memo: memo.trim() === "" ? null : memo.trim(),
                      ...(companyLevel ? { branchId: branchId === "" ? null : branchId } : {}),
                    },
                  });
                  setMode(null);
                  return postedMessage(result);
                })
              }
            >
              {t("bankRecX.post")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const SOURCE_LABEL: Record<MatchSourceCode, "bankRecX.sourceManual" | "bankRecX.sourceAuto" | "bankRecX.sourceSuggestion" | "bankRecX.sourceCreatedEntry"> = {
  [MatchSourceCode.Manual]: "bankRecX.sourceManual",
  [MatchSourceCode.Auto]: "bankRecX.sourceAuto",
  [MatchSourceCode.Suggestion]: "bankRecX.sourceSuggestion",
  [MatchSourceCode.CreatedEntry]: "bankRecX.sourceCreatedEntry",
};

function MatchedLineCard({
  statementId,
  line,
  locked,
  pending,
  run,
}: {
  statementId: string;
  line: StatementLineDTO;
  locked: boolean;
  pending: boolean;
  run: (fn: () => Promise<string | null | void>) => void;
}) {
  const { t } = useAppTranslation();
  const unmatch = useUnmatchStatementLine();
  const ids = line.matchedEntryIds && line.matchedEntryIds.length > 0 ? line.matchedEntryIds : line.matchedEntryId ? [line.matchedEntryId] : [];
  const numbers = ids.map((id, index) => line.matchedEntryNos?.[index] ?? (index === 0 ? line.matchedEntryNo : null) ?? id);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
      <LineHeader line={line} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-[11.5px] text-ink-muted">
          <span>
            {t("bankRecX.entries")}: <span className="mz-num">{numbers.join("، ")}</span>
          </span>
          {line.matchSource ? (
            <span>
              {" · "}
              {t("bankRecX.matchedVia")}: {t(SOURCE_LABEL[line.matchSource])}
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="danger-outline"
          disabled={locked || pending}
          onClick={() => run(async () => void (await unmatch.mutateAsync({ statementId, lineId: line.id })))}
        >
          {t("bankRec.unmatch")}
        </Button>
      </div>
    </div>
  );
}

interface RuleDraft {
  id: string | null;
  name: string;
  pattern: string;
  matchType: BankRuleMatchTypeCode;
  direction: BankRuleDirectionCode;
  treasuryAccountId: string;
  accountId: string;
  costCenterId: string;
  priority: number;
  active: boolean;
}

const BLANK_RULE: RuleDraft = {
  id: null,
  name: "",
  pattern: "",
  matchType: BankRuleMatchTypeCode.Contains,
  direction: BankRuleDirectionCode.Any,
  treasuryAccountId: "",
  accountId: "",
  costCenterId: "",
  priority: 100,
  active: true,
};

function draftOf(rule: BankRuleDTO): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    pattern: rule.pattern,
    matchType: rule.matchType,
    direction: rule.direction,
    treasuryAccountId: rule.treasuryAccountId ?? "",
    accountId: rule.accountId,
    costCenterId: rule.costCenterId ?? "",
    priority: rule.priority,
    active: rule.active,
  };
}

function BankRulesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const rules = useBankRules();
  const create = useCreateBankRule();
  const update = useUpdateBankRule();
  const remove = useDeleteBankRule();
  const treasury = useTreasuryAccounts();
  const accountOptions = useCounterAccountOptions();
  const costCenterOptions = useCostCenterOptions();
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [deleting, setDeleting] = useState<BankRuleDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const bankOptions = [
    { value: "", label: t("bankRecX.allBankAccounts") },
    ...(treasury.data ?? []).filter((a) => a.type === "bank").map((a) => ({ value: a.id, label: `${nameOf(a)} (${a.code})` })),
  ];
  const matchTypeOptions = [
    { value: BankRuleMatchTypeCode.Contains, label: t("bankRecX.matchContains") },
    { value: BankRuleMatchTypeCode.StartsWith, label: t("bankRecX.matchStartsWith") },
    { value: BankRuleMatchTypeCode.Equals, label: t("bankRecX.matchEquals") },
  ];
  const directionOptions = [
    { value: BankRuleDirectionCode.Any, label: t("bankRecX.directionAny") },
    { value: BankRuleDirectionCode.MoneyIn, label: t("bankRecX.directionIn") },
    { value: BankRuleDirectionCode.MoneyOut, label: t("bankRecX.directionOut") },
  ];
  const accountLabel = (id: string) => accountOptions.find((o) => o.id === id)?.label ?? id;
  const directionLabel = (d: BankRuleDirectionCode) => directionOptions.find((o) => o.value === d)?.label ?? d;

  async function save() {
    if (!draft || busyId) return;
    const body: BankRuleInputDTO = {
      name: draft.name.trim(),
      pattern: draft.pattern.trim(),
      matchType: draft.matchType,
      direction: draft.direction,
      treasuryAccountId: draft.treasuryAccountId === "" ? null : draft.treasuryAccountId,
      accountId: draft.accountId,
      costCenterId: draft.costCenterId === "" ? null : draft.costCenterId,
      priority: draft.priority,
      active: draft.active,
    };
    setBusyId(draft.id ?? "new");
    setError(null);
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, body });
      else await create.mutateAsync({ body });
      setDraft(null);
    } catch (err) {
      setError(errorMessage(err, t("bankRecX.ruleSaveFailed")));
    } finally {
      setBusyId(null);
    }
  }

  const canSave = draft !== null && draft.name.trim() !== "" && draft.pattern.trim() !== "" && draft.accountId !== "" && busyId === null;

  return (
    <SidePanel open={open} onClose={onClose} title={t("bankRecX.rules")}>
      <div className="flex flex-col gap-4">
        {error ? <div role="alert" className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
        {draft ? (
          <Card className="flex flex-col gap-3 p-[14px]">
            <h3 className="text-[13px] font-bold text-ink">{draft.id ? t("bankRecX.editRule") : t("bankRecX.addRule")}</h3>
            <TextField label={t("bankRecX.ruleName")} value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <TextField label={t("bankRecX.rulePattern")} value={draft.pattern} onChange={(v) => setDraft({ ...draft, pattern: v })} />
            <SelectField
              label={t("bankRecX.ruleMatchType")}
              value={draft.matchType}
              onChange={(v) => setDraft({ ...draft, matchType: matchTypeOptions.find((o) => o.value === v)?.value ?? BankRuleMatchTypeCode.Contains })}
              options={matchTypeOptions}
            />
            <SelectField
              label={t("bankRecX.ruleDirection")}
              value={draft.direction}
              onChange={(v) => setDraft({ ...draft, direction: directionOptions.find((o) => o.value === v)?.value ?? BankRuleDirectionCode.Any })}
              options={directionOptions}
            />
            <SelectField
              label={t("bankRecX.ruleBankAccount")}
              value={draft.treasuryAccountId}
              onChange={(v) => setDraft({ ...draft, treasuryAccountId: v })}
              options={bankOptions}
            />
            <EntityPicker
              label={t("bankRecX.counterAccount")}
              value={accountOptions.find((o) => o.id === draft.accountId) ?? null}
              onChange={(o) => setDraft({ ...draft, accountId: o?.id ?? "" })}
              options={accountOptions}
              placeholder={t("bankRecX.chooseAccount")}
              emptyMessage={t("bankRecX.noAccounts")}
            />
            <SelectField
              label={t("bankRecX.costCenter")}
              value={draft.costCenterId}
              onChange={(v) => setDraft({ ...draft, costCenterId: v })}
              options={costCenterOptions}
            />
            <NumberField label={t("bankRecX.priority")} value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: Number.isFinite(v) ? Math.trunc(v) : 100 })} min={0} max={9999} step={1} />
            <ToggleField label={t("bankRecX.active")} checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} />
            <div className="flex gap-2">
              <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
              <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
                {t("bankRecX.save")}
              </Button>
            </div>
          </Card>
        ) : (
          <div>
            <Button variant="primary" onClick={() => setDraft(BLANK_RULE)}>
              {t("bankRecX.addRule")}
            </Button>
          </div>
        )}

        {rules.isLoading ? <div className="text-[12.5px] text-ink-muted">{t("common.loading")}</div> : null}
        {rules.isError ? <div role="alert" className="text-[12.5px] text-danger">{rules.error?.message}</div> : null}
        {rules.data && rules.data.length === 0 ? <EmptyState title={t("bankRecX.noRules")} /> : null}
        <ul className="flex flex-col gap-2">
          {(rules.data ?? []).map((rule) => (
            <li key={rule.id} className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">{rule.name}</span>
                <StatusPill label={rule.active ? t("bankRecX.active") : t("bankRecX.inactive")} tone={rule.active ? "success" : "neutral"} />
              </div>
              <div className="break-words text-[12px] text-ink-muted">
                «{rule.pattern}» · {directionLabel(rule.direction)} → {accountLabel(rule.accountId)}
                <span className="mz-num text-ink-faint"> · {rule.priority}</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busyId !== null} onClick={() => setDraft(draftOf(rule))}>
                  {t("bankRecX.edit")}
                </Button>
                <Button size="sm" variant="danger-outline" disabled={busyId !== null} onClick={() => setDeleting(rule)}>
                  {t("bankRecX.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title={t("bankRecX.deleteRuleTitle")}
        tone="danger"
        consequence={t("bankRecX.deleteRuleBody", { name: deleting?.name ?? "" })}
        confirmLabel={t("bankRecX.delete")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (!target) return;
          setBusyId(target.id);
          setError(null);
          remove
            .mutateAsync(target.id)
            .catch((err: unknown) => setError(errorMessage(err, t("bankRecX.ruleDeleteFailed"))))
            .finally(() => setBusyId(null));
        }}
      />
    </SidePanel>
  );
}
