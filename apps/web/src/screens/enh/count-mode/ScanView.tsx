import { ArabicCase, CountedNoun } from "@mezan/domain";
import { useCountPhrase } from "../../../lib/count-phrase";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, CircleSlash, Keyboard, Loader2, Undo2, Volume2, VolumeX, WifiOff } from "lucide-react";
import { Button, Card, EmptyState, IconButton, StatusPill, TextInput, type PillTone } from "@mezan/ui";
import { CountScanModeDTO, CountScanOutcomeDTO, CountZoneStatusDTO, type CountModeItemDTO, type CountModeScanInputDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { ApiError } from "../../../data/hooks";
import { COUNT_MODE_KEY, useCountModeSession, useSendScan, useSubmitZone, useVoidScan, useZeroFillZone } from "./hooks";
import { Keypad } from "./Keypad";
import { appendKeypadDigit, isPositive, parseScanInput, ScanCommandKind } from "./scan-command";
import { ScanEntryStatus, useScanQueue, type ScanEntry } from "./scan-queue";
import { playTone, prefersReducedMotion, readMuted, ScanTone, storeMuted } from "./feedback";
import { trimQty, signedQty, varianceDirection, VarianceDirection, percentOf } from "./format";

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

enum Confirming {
  None = "none",
  ZeroFill = "zero-fill",
  Submit = "submit",
}

enum InputKeyboard {
  Hidden = "none",
  Shown = "text",
}

const CARD_TONE: Record<ScanEntryStatus, string> = {
  [ScanEntryStatus.Pending]: "border-border-strong bg-surface-2 text-ink",
  [ScanEntryStatus.Counted]: "border-success bg-success-soft text-success-ink",
  [ScanEntryStatus.Rejected]: "border-danger bg-danger-soft text-danger-ink",
  [ScanEntryStatus.Failed]: "border-warning bg-warning-soft text-warning-ink",
};

function sortedForCounting(items: readonly CountModeItemDTO[]): CountModeItemDTO[] {
  const rank = (item: CountModeItemDTO) => (item.recount ? 0 : item.countedQty === null ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
}

function VarianceText({ item }: { item: CountModeItemDTO }) {
  const { t } = useAppTranslation();
  const direction = varianceDirection(item.varianceQty);
  if (direction === VarianceDirection.Unknown) return null;
  const label = direction === VarianceDirection.Matched ? t("countMode.variance.matched") : direction === VarianceDirection.Over ? t("countMode.variance.over") : t("countMode.variance.short");
  const tone = direction === VarianceDirection.Matched ? "text-success-ink" : direction === VarianceDirection.Over ? "text-info-ink" : "text-danger-ink";
  return (
    <span className={`mz-num text-[12px] font-semibold ${tone}`}>
      {label} {direction === VarianceDirection.Matched ? "" : signedQty(item.varianceQty)}
    </span>
  );
}

export function ScanView({ countId, zoneId }: { countId: string; zoneId: string }) {
  const { t, locale } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const { openSubPage } = useNavigation();
  const queryClient = useQueryClient();
  const sessionQuery = useCountModeSession(countId, true);
  const send = useSendScan(countId, zoneId);
  const voidScan = useVoidScan();
  const zeroFill = useZeroFillZone();
  const submitZone = useSubmitZone();
  const inputRef = useRef<HTMLInputElement>(null);
  const [muted, setMuted] = useState(readMuted);
  const [keyboard, setKeyboard] = useState(InputKeyboard.Hidden);
  const [text, setText] = useState("");
  const [keypadQty, setKeypadQty] = useState("");
  const [unitCode, setUnitCode] = useState<string | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(Confirming.None);
  const [busyUndo, setBusyUndo] = useState<string | null>(null);

  const session = sessionQuery.data;
  const zone = session?.zones.find((z) => z.id === zoneId);
  const items = useMemo(() => (session?.items ?? []).filter((i) => i.zoneId === zoneId), [session, zoneId]);
  const current = items.find((i) => i.itemId === currentItemId) ?? null;
  const open = zone?.status === CountZoneStatusDTO.Open && session?.status === "IN_PROGRESS";
  const recountItems = items.filter((i) => i.recount);

  const focusInput = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (open) focusInput();
  }, [open, focusInput]);

  const announce = useCallback(
    (entry: ScanEntry) => {
      const tone = entry.status === ScanEntryStatus.Counted ? ScanTone.Counted : entry.status === ScanEntryStatus.Rejected ? ScanTone.Rejected : ScanTone.Failed;
      if (!muted) playTone(tone);
      const scanned = entry.result?.item?.itemId;
      if (scanned) setCurrentItemId(scanned);
    },
    [muted],
  );

  const queue = useScanQueue({
    send,
    onSettled: announce,
    onIdle: () => {
      void queryClient.invalidateQueries({ queryKey: [COUNT_MODE_KEY, "session", countId] });
      focusInput();
    },
  });

  const latest = queue.entries[0] ?? null;

  useEffect(() => {
    if (!current && latest?.result?.item) setCurrentItemId(latest.result.item.itemId);
  }, [current, latest]);

  const itemUnits = current?.units ?? [];

  function enqueue(body: CountModeScanInputDTO, label: string) {
    setMessage(null);
    queue.enqueue(body, label);
  }

  function commitInput() {
    const command = parseScanInput(text);
    setText("");
    if (command.kind === ScanCommandKind.Empty) return;
    if (command.kind === ScanCommandKind.Invalid) {
      if (!muted) playTone(ScanTone.Rejected);
      setMessage(t("countMode.invalidCommand"));
      return;
    }
    if (command.kind === ScanCommandKind.Multiplier) {
      setKeypadQty(command.qty);
      setMessage(null);
      return;
    }
    if (command.kind === ScanCommandKind.SetTotal) {
      if (!current) {
        if (!muted) playTone(ScanTone.Rejected);
        setMessage(t("countMode.noCurrentItem"));
        return;
      }
      enqueue({ itemId: current.itemId, mode: CountScanModeDTO.Set, qty: command.qty }, current.code);
      return;
    }
    const withQty = keypadQty !== "" && isPositive(keypadQty);
    enqueue(
      { barcode: command.barcode, mode: CountScanModeDTO.Add, ...(withQty ? { qty: keypadQty } : {}), ...(unitCode ? { unitCode } : {}) },
      command.barcode,
    );
    setKeypadQty("");
    setUnitCode(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitInput();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setText("");
      setKeypadQty("");
      setUnitCode(null);
      setMessage(null);
    }
  }

  function applyToCurrent(mode: CountScanModeDTO) {
    if (!current || keypadQty === "" || (mode === CountScanModeDTO.Add && !isPositive(keypadQty))) return;
    enqueue({ itemId: current.itemId, mode, qty: keypadQty, ...(unitCode ? { unitCode } : {}) }, current.code);
    setKeypadQty("");
    setUnitCode(null);
    focusInput();
  }

  async function undo(entry: ScanEntry) {
    const scanId = entry.result?.scan.id;
    if (!scanId) return;
    setBusyUndo(scanId);
    setMessage(null);
    try {
      await voidScan.mutateAsync({ countId, scanId });
      if (!muted) playTone(ScanTone.Rejected);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : t("countMode.voidFailed"));
    } finally {
      setBusyUndo(null);
      focusInput();
    }
  }

  async function run(action: Confirming) {
    setConfirming(Confirming.None);
    setMessage(null);
    try {
      if (action === Confirming.ZeroFill) await zeroFill.mutateAsync({ countId, zoneId });
      else await submitZone.mutateAsync({ countId, zoneId });
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : t("countMode.submitFailed"));
    } finally {
      focusInput();
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    storeMuted(next);
    focusInput();
  }

  if (sessionQuery.isLoading) {
    return (
      <div role="status" className="flex items-center gap-[8px] p-[16px] text-[13px] text-ink-muted">
        <Loader2 aria-hidden className="h-[16px] w-[16px] motion-safe:animate-spin" />
        {t("countMode.loading")}
      </div>
    );
  }
  if (sessionQuery.isError || !session || !zone) {
    return <EmptyState title={t("countMode.zoneUnavailableTitle")} description={sessionQuery.error?.message ?? t("countMode.zoneUnavailableBody")} action={{ label: t("countMode.back"), onClick: () => openSubPage([]) }} />;
  }

  const progressPercent = percentOf(zone.countedItems, zone.totalItems);
  const uncounted = zone.totalItems - zone.countedItems;
  const lastItem = latest?.result?.item ?? null;
  const reducedMotion = prefersReducedMotion();

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-[12px] pb-[24px]">
      <header className="flex items-center gap-[8px]">
        <IconButton aria-label={t("countMode.back")} onClick={() => openSubPage([])}>
          <ArrowLeft aria-hidden className="h-[20px] w-[20px] rtl:-scale-x-100" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[18px] font-bold text-ink">{zone.name}</h1>
          <p className="truncate text-[12px] text-ink-muted">
            {session.countNo ?? session.id} · {session.blind ? t("countMode.blindBadge") : t("countMode.openBadge")}
          </p>
        </div>
        <IconButton aria-label={muted ? t("countMode.unmute") : t("countMode.mute")} aria-pressed={muted} onClick={toggleMute} onMouseDown={keepFocus}>
          {muted ? <VolumeX aria-hidden className="h-[20px] w-[20px]" /> : <Volume2 aria-hidden className="h-[20px] w-[20px]" />}
        </IconButton>
      </header>

      <div>
        <div className="mb-[4px] flex items-center justify-between text-[12px] text-ink-muted">
          <span className="mz-num">{t("countMode.progress", { counted: zone.countedItems, total: zone.totalItems })}</span>
          <StatusPill label={t(`countMode.zoneStatus.${zone.status}`)} tone={zone.status === CountZoneStatusDTO.Open ? "warning" : zone.status === CountZoneStatusDTO.Submitted ? "info" : "success"} />
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label={t("countMode.progressLabel")} className="h-[8px] overflow-hidden rounded-pill bg-surface-3">
          <div className="h-full bg-brand" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {recountItems.length > 0 ? (
        <div role="alert" className="flex items-start gap-[8px] rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[13px] text-warning-ink">
          <AlertTriangle aria-hidden className="mt-[2px] h-[16px] w-[16px] flex-none" />
          <span>{t("countMode.recountBanner", { count: countPhrase(recountItems.length, CountedNoun.Item, ArabicCase.Oblique) })}</span>
        </div>
      ) : null}

      {!open ? (
        <div role="status" className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[13px] text-ink">
          {zone.status === CountZoneStatusDTO.Open ? t("countMode.sessionClosed") : t("countMode.zoneLocked")}
        </div>
      ) : (
        <Card className="flex flex-col gap-[10px] p-[12px]">
          <label htmlFor="count-mode-scan-input" className="text-[13px] font-semibold text-ink">
            {t("countMode.scanLabel")}
          </label>
          <TextInput
            id="count-mode-scan-input"
            ref={inputRef}
            size="md"
            numeric
            dir="ltr"
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            inputMode={keyboard === InputKeyboard.Hidden ? "none" : "text"}
            className="min-h-[56px] text-[22px]"
            value={text}
            aria-describedby="count-mode-scan-hint"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={(event) => {
              if (event.relatedTarget === null && open) window.setTimeout(focusInput, 0);
            }}
          />
          <p id="count-mode-scan-hint" className="text-[12px] text-ink-muted">
            {t("countMode.scanHint")}
          </p>
          <div className="flex items-center justify-between gap-[8px]">
            <Button size="sm" onMouseDown={keepFocus} onClick={() => setKeyboard((k) => (k === InputKeyboard.Hidden ? InputKeyboard.Shown : InputKeyboard.Hidden))} aria-pressed={keyboard === InputKeyboard.Shown}>
              <Keyboard aria-hidden className="h-[16px] w-[16px]" />
              {t("countMode.typeBarcode")}
            </Button>
            {queue.pending > 0 ? (
              <span role="status" className="flex items-center gap-[6px] text-[12px] text-ink-muted">
                <Loader2 aria-hidden className="h-[14px] w-[14px] motion-safe:animate-spin" />
                {t("countMode.sending", { count: queue.pending })}
              </span>
            ) : null}
          </div>
        </Card>
      )}

      <section aria-live="polite" aria-atomic="true" aria-label={t("countMode.lastScan")} className={`rounded-lg border-2 p-[14px] ${latest ? CARD_TONE[latest.status] : "border-border bg-surface text-ink-muted"} ${reducedMotion ? "" : "motion-safe:transition-colors"}`}>
        {latest ? (
          <div className="flex flex-col gap-[6px]">
            <div className="flex items-center gap-[8px] text-[13px] font-semibold">
              {latest.status === ScanEntryStatus.Counted ? <Check aria-hidden className="h-[18px] w-[18px]" /> : null}
              {latest.status === ScanEntryStatus.Rejected ? <CircleSlash aria-hidden className="h-[18px] w-[18px]" /> : null}
              {latest.status === ScanEntryStatus.Failed ? <WifiOff aria-hidden className="h-[18px] w-[18px]" /> : null}
              {latest.status === ScanEntryStatus.Pending ? <Loader2 aria-hidden className="h-[18px] w-[18px] motion-safe:animate-spin" /> : null}
              <span>{statusLabel(latest, t)}</span>
            </div>
            {lastItem ? (
              <>
                <p className="text-[20px] font-bold leading-tight">{locale === "en" && lastItem.nameEn ? lastItem.nameEn : lastItem.nameAr}</p>
                <p className="mz-num text-[12px]">{lastItem.code}</p>
                <p className="mz-num text-[28px] font-bold leading-none">
                  {trimQty(lastItem.countedQty)} <span className="text-[14px] font-medium">{lastItem.unitCode}</span>
                </p>
                {latest.result?.addedQty && latest.result.outcome === CountScanOutcomeDTO.Counted ? <p className="mz-num text-[13px]">{t("countMode.added", { qty: trimQty(latest.result.addedQty) })}</p> : null}
                {lastItem.systemQty !== null ? (
                  <p className="mz-num text-[13px]">
                    {t("countMode.expected", { qty: trimQty(lastItem.systemQty) })} · <VarianceText item={lastItem} />
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mz-num text-[16px] font-semibold">{latest.label}</p>
            )}
            {latest.error ? <p className="text-[13px]">{latest.error}</p> : null}
            <div className="flex flex-wrap gap-[8px]">
              {latest.status === ScanEntryStatus.Counted && latest.result?.scan.id ? (
                <Button size="sm" disabled={busyUndo === latest.result.scan.id || !open} onMouseDown={keepFocus} onClick={() => void undo(latest)}>
                  <Undo2 aria-hidden className="h-[16px] w-[16px]" />
                  {t("countMode.undo")}
                </Button>
              ) : null}
              {latest.status === ScanEntryStatus.Failed ? (
                <Button size="sm" onMouseDown={keepFocus} onClick={() => queue.retry(latest.key)}>
                  {t("countMode.retry")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-[13px]">{t("countMode.waitingForScan")}</p>
        )}
      </section>

      {message ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[13px] text-danger-ink">
          {message}
        </div>
      ) : null}

      {queue.failed > 0 ? (
        <div role="alert" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[13px] text-warning-ink">
          {t("countMode.failedWarning", { count: queue.failed })}
        </div>
      ) : null}

      {open ? (
        <Card className="flex flex-col gap-[10px] p-[12px]">
          <div className="flex items-center justify-between gap-[8px]">
            <p className="text-[13px] font-semibold text-ink">{t("countMode.quantity")}</p>
            <p className="mz-num min-h-[32px] min-w-[96px] rounded-md border border-border bg-surface-2 px-[10px] py-[4px] text-end text-[20px] font-bold text-ink" aria-live="polite" aria-label={t("countMode.pendingQuantity")}>
              {keypadQty === "" ? "—" : keypadQty}
            </p>
          </div>
          {itemUnits.length > 0 ? (
            <div role="radiogroup" aria-label={t("countMode.unit")} className="flex flex-wrap gap-[6px]">
              <UnitChip label={current?.unitCode ?? ""} active={unitCode === null} onPick={() => setUnitCode(null)} />
              {itemUnits.map((unit) => (
                <UnitChip key={unit.code} label={`${unit.name} ×${unit.factor}`} active={unitCode === unit.code} onPick={() => setUnitCode(unit.code)} />
              ))}
            </div>
          ) : null}
          <Keypad onDigit={(key) => setKeypadQty((q) => appendKeypadDigit(q, key))} onBackspace={() => setKeypadQty((q) => q.slice(0, -1))} onClear={() => setKeypadQty("")} />
          <div className="grid grid-cols-2 gap-[8px]">
            <Button variant="primary" className="min-h-[52px] justify-center text-[15px]" disabled={!current || !isPositive(keypadQty || "0")} onMouseDown={keepFocus} onClick={() => applyToCurrent(CountScanModeDTO.Add)}>
              {t("countMode.addToItem")}
            </Button>
            <Button className="min-h-[52px] justify-center text-[15px]" disabled={!current || keypadQty === ""} onMouseDown={keepFocus} onClick={() => applyToCurrent(CountScanModeDTO.Set)}>
              {t("countMode.setTotal")}
            </Button>
          </div>
          <p className="text-[12px] text-ink-muted">{current ? t("countMode.currentItem", { name: current.nameAr }) : t("countMode.noCurrentItem")}</p>
        </Card>
      ) : null}

      <details className="rounded-lg border border-border bg-surface" open={recountItems.length > 0}>
        <summary className="flex min-h-[44px] cursor-pointer items-center justify-between px-[12px] text-[13px] font-semibold text-ink">
          <span>{t("countMode.itemsHeading", { count: items.length })}</span>
          <span className="mz-num text-[12px] font-normal text-ink-muted">{t("countMode.uncountedCount", { count: uncounted })}</span>
        </summary>
        <ul className="divide-y divide-border">
          {sortedForCounting(items).map((item) => (
            <li key={item.itemId}>
              <button
                type="button"
                onMouseDown={keepFocus}
                onClick={() => {
                  setCurrentItemId(item.itemId);
                  focusInput();
                }}
                aria-pressed={item.itemId === currentItemId}
                className={`flex min-h-[52px] w-full items-center justify-between gap-[8px] px-[12px] py-[8px] text-start ${item.itemId === currentItemId ? "bg-surface-2" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink">{locale === "en" && item.nameEn ? item.nameEn : item.nameAr}</span>
                  <span className="mz-num block text-[11.5px] text-ink-muted">
                    {item.code}
                    {item.recount ? ` · ${t("countMode.recountBadge")}` : ""}
                  </span>
                </span>
                <span className="flex flex-none flex-col items-end">
                  <span className="mz-num text-[16px] font-bold text-ink">{trimQty(item.countedQty)}</span>
                  <VarianceText item={item} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>

      {queue.entries.length > 1 ? (
        <details className="rounded-lg border border-border bg-surface">
          <summary className="flex min-h-[44px] cursor-pointer items-center px-[12px] text-[13px] font-semibold text-ink">{t("countMode.recentScans")}</summary>
          <ul className="divide-y divide-border">
            {queue.entries.slice(1, 11).map((entry) => (
              <li key={entry.key} className="flex items-center justify-between gap-[8px] px-[12px] py-[8px] text-[13px]">
                <span className="mz-num min-w-0 truncate" dir="ltr">
                  {entry.result?.item?.code ?? entry.label}
                </span>
                <StatusPill label={statusLabel(entry, t)} tone={pillToneOf(entry.status)} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {open ? (
        confirming === Confirming.None ? (
          <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
            <Button className="min-h-[48px] justify-center" disabled={uncounted === 0 || zeroFill.isPending} onMouseDown={keepFocus} onClick={() => setConfirming(Confirming.ZeroFill)}>
              {t("countMode.zeroFill")}
            </Button>
            <Button variant="primary" className="min-h-[48px] justify-center" disabled={uncounted > 0 || submitZone.isPending || queue.pending > 0} onMouseDown={keepFocus} onClick={() => setConfirming(Confirming.Submit)}>
              {t("countMode.submitZone")}
            </Button>
            {uncounted > 0 ? <p className="text-[12px] text-ink-muted sm:col-span-2">{t("countMode.submitNeedsAll", { count: countPhrase(uncounted, CountedNoun.Item) })}</p> : null}
          </div>
        ) : (
          <div role="alertdialog" aria-labelledby="count-mode-confirm-title" className="flex flex-col gap-[10px] rounded-lg border-2 border-brand bg-surface p-[14px]">
            <p id="count-mode-confirm-title" className="text-[14px] font-semibold text-ink">
              {confirming === Confirming.ZeroFill ? t("countMode.zeroFillConfirm", { count: countPhrase(uncounted, CountedNoun.Item, ArabicCase.Oblique) }) : t("countMode.submitConfirm")}
            </p>
            <div className="flex gap-[8px]">
              <Button variant="primary" autoFocus onClick={() => void run(confirming)}>
                {t("countMode.confirm")}
              </Button>
              <Button
                onClick={() => {
                  setConfirming(Confirming.None);
                  focusInput();
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function UnitChip({ label, active, onPick }: { label: string; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onMouseDown={keepFocus}
      onClick={onPick}
      className={`min-h-[44px] rounded-md border px-[12px] text-[13px] font-semibold ${active ? "border-brand bg-brand text-brand-ink" : "border-border-strong bg-surface text-ink"}`}
    >
      {label}
    </button>
  );
}

function pillToneOf(status: ScanEntryStatus): PillTone {
  if (status === ScanEntryStatus.Counted) return "success";
  if (status === ScanEntryStatus.Rejected) return "danger";
  if (status === ScanEntryStatus.Failed) return "warning";
  return "neutral";
}

function statusLabel(entry: ScanEntry, t: ReturnType<typeof useAppTranslation>["t"]): string {
  if (entry.status === ScanEntryStatus.Pending) return t("countMode.status.pending");
  if (entry.status === ScanEntryStatus.Failed) return t("countMode.status.failed");
  if (entry.result?.outcome === CountScanOutcomeDTO.UnknownBarcode) return t("countMode.status.unknown");
  if (entry.result?.outcome === CountScanOutcomeDTO.NotInZone) return t("countMode.status.notInZone");
  return entry.result?.replayed ? t("countMode.status.replayed") : t("countMode.status.counted");
}
