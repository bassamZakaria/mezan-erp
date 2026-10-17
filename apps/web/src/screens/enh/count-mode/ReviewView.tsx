import { useState } from "react";
import { ArrowLeft, Check, History, Loader2, RotateCcw } from "lucide-react";
import { Button, Card, Checkbox, EmptyState, StatusPill, trimMoneyString, type PillTone } from "@mezan/ui";
import { CountScanOutcomeDTO, CountZoneStatusDTO, type CountModeItemDTO, type CountModeSessionDTO, type CountModeZoneSummaryDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { ApiError } from "../../../data/hooks";
import { useGenerateAdjustmentFromCount } from "../../../data/inventory-ops-hooks";
import { TextField } from "../../../settings/form-controls";
import { useApproveZone, useCompleteCountMode, useCountModeSession, useCountModeTrail, useRecountZone } from "./hooks";
import { percentOf, signedQty, trimQty, varianceDirection, VarianceDirection } from "./format";

export interface ReviewPermissions {
  readonly review: boolean;
  readonly approve: boolean;
  readonly post: boolean;
}

const ZONE_TONE: Record<CountZoneStatusDTO, PillTone> = {
  [CountZoneStatusDTO.Open]: "warning",
  [CountZoneStatusDTO.Submitted]: "info",
  [CountZoneStatusDTO.Approved]: "success",
};

function signedMoney(value: string | null): string {
  if (value === null) return "—";
  const trimmed = trimMoneyString(value, 2);
  return trimmed.startsWith("-") ? trimmed : `+${trimmed}`;
}

function VarianceCell({ item }: { item: CountModeItemDTO }) {
  const direction = varianceDirection(item.varianceQty);
  if (direction === VarianceDirection.Unknown) return <span>—</span>;
  const tone = direction === VarianceDirection.Matched ? "text-success-ink" : direction === VarianceDirection.Over ? "text-info-ink" : "text-danger-ink";
  return <span className={`mz-num font-semibold ${tone}`}>{signedQty(item.varianceQty)}</span>;
}

function Trail({ countId, zoneId }: { countId: string; zoneId: string }) {
  const { t } = useAppTranslation();
  const trail = useCountModeTrail(countId, zoneId, true);
  if (trail.isLoading) return <p role="status" className="px-[12px] py-[10px] text-[12px] text-ink-muted">{t("countMode.loading")}</p>;
  if (trail.isError) return <p role="alert" className="px-[12px] py-[10px] text-[12px] text-danger-ink">{trail.error.message}</p>;
  const scans = trail.data ?? [];
  if (scans.length === 0) return <p className="px-[12px] py-[10px] text-[12px] text-ink-muted">{t("countMode.review.noScans")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px]">
        <caption className="sr-only">{t("countMode.review.trailCaption")}</caption>
        <thead>
          <tr className="border-b border-border text-start text-ink-muted">
            <th scope="col" className="px-[10px] py-[6px] text-start">{t("countMode.review.col.time")}</th>
            <th scope="col" className="px-[10px] py-[6px] text-start">{t("countMode.review.col.counter")}</th>
            <th scope="col" className="px-[10px] py-[6px] text-start">{t("countMode.review.col.barcode")}</th>
            <th scope="col" className="px-[10px] py-[6px] text-end">{t("countMode.review.col.qty")}</th>
            <th scope="col" className="px-[10px] py-[6px] text-start">{t("countMode.review.col.result")}</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => (
            <tr key={scan.id} className={`border-b border-border ${scan.voidedAt ? "text-ink-faint line-through" : ""}`}>
              <td className="mz-num px-[10px] py-[6px]" dir="ltr">{scan.scannedAt.replace("T", " ").slice(0, 19)}</td>
              <td className="px-[10px] py-[6px]">{scan.userName}</td>
              <td className="mz-num px-[10px] py-[6px]" dir="ltr">{scan.barcode ?? scan.itemId ?? "—"}</td>
              <td className="mz-num px-[10px] py-[6px] text-end">{trimQty(scan.qty)}</td>
              <td className="px-[10px] py-[6px] no-underline">
                {scan.outcome === CountScanOutcomeDTO.Counted ? t(`countMode.source.${scan.source}`) : t(`countMode.outcome.${scan.outcome}`)}
                {scan.voidReason ? ` · ${t(`countMode.voidReason.${scan.voidReason}`)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ZoneCard({ session, zone, permissions, counterName }: { session: CountModeSessionDTO; zone: CountModeZoneSummaryDTO; permissions: ReviewPermissions; counterName: (id: string) => string }) {
  const { t, locale } = useAppTranslation();
  const recount = useRecountZone();
  const approve = useApproveZone();
  const [showItems, setShowItems] = useState(false);
  const [showTrail, setShowTrail] = useState(false);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const items = session.items.filter((i) => i.zoneId === zone.id);
  const inProgress = session.status === "IN_PROGRESS";
  const canRecount = permissions.review && inProgress && zone.status !== CountZoneStatusDTO.Approved && session.revealsVariance;
  const canApprove = permissions.approve && inProgress && zone.status === CountZoneStatusDTO.Submitted;

  async function flagRecount() {
    setError(null);
    try {
      await recount.mutateAsync({ countId: session.id, zoneId: zone.id, body: { itemIds: [...picked], reason: reason.trim() } });
      setPicked([]);
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("countMode.recountFailed"));
    }
  }

  async function approveZone() {
    setError(null);
    try {
      await approve.mutateAsync({ countId: session.id, zoneId: zone.id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("countMode.approveFailed"));
    }
  }

  return (
    <Card className="flex flex-col gap-[10px] p-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink">{zone.name}</h2>
          <p className="text-[12px] text-ink-muted">{zone.counterUserIds.map(counterName).join("، ")}</p>
        </div>
        <StatusPill label={t(`countMode.zoneStatus.${zone.status}`)} tone={ZONE_TONE[zone.status]} />
      </div>
      <div>
        <div className="mb-[4px] flex justify-between text-[12px] text-ink-muted">
          <span className="mz-num">{t("countMode.progress", { counted: zone.countedItems, total: zone.totalItems })}</span>
          {zone.recountItems > 0 ? <span className="font-semibold text-warning-ink">{t("countMode.review.recountPending", { count: zone.recountItems })}</span> : null}
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentOf(zone.countedItems, zone.totalItems)} aria-label={t("countMode.progressLabel")} className="h-[8px] overflow-hidden rounded-pill bg-surface-3">
          <div className="h-full bg-brand" style={{ width: `${percentOf(zone.countedItems, zone.totalItems)}%` }} />
        </div>
      </div>
      {zone.netValue !== null ? (
        <p className="mz-num text-[12.5px] text-ink">
          {t("countMode.review.zoneVariance", { net: signedMoney(zone.netValue), abs: trimMoneyString(zone.absValue ?? "0", 2) })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-[8px]">
        <Button size="sm" aria-expanded={showItems} onClick={() => setShowItems((v) => !v)}>
          {showItems ? t("countMode.review.hideItems") : t("countMode.review.showItems")}
        </Button>
        {permissions.review ? (
          <Button size="sm" aria-expanded={showTrail} onClick={() => setShowTrail((v) => !v)}>
            <History aria-hidden className="h-[14px] w-[14px]" />
            {t("countMode.review.trail")}
          </Button>
        ) : null}
        {canApprove ? (
          <Button size="sm" variant="primary" disabled={approve.isPending} onClick={() => void approveZone()}>
            <Check aria-hidden className="h-[14px] w-[14px]" />
            {t("countMode.review.approveZone")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[8px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {showItems ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[420px] text-[12.5px]">
            <caption className="sr-only">{t("countMode.review.itemsCaption", { zone: zone.name })}</caption>
            <thead>
              <tr className="border-b border-border text-ink-muted">
                {canRecount ? <th scope="col" className="w-[44px] px-[8px] py-[6px]"><span className="sr-only">{t("countMode.review.col.recount")}</span></th> : null}
                <th scope="col" className="px-[10px] py-[6px] text-start">{t("countMode.review.col.item")}</th>
                <th scope="col" className="px-[10px] py-[6px] text-end">{t("countMode.review.col.expected")}</th>
                <th scope="col" className="px-[10px] py-[6px] text-end">{t("countMode.review.col.counted")}</th>
                <th scope="col" className="px-[10px] py-[6px] text-end">{t("countMode.review.col.variance")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.itemId} className="border-b border-border">
                  {canRecount ? (
                    <td className="px-[8px] py-[4px]">
                      <Checkbox
                        aria-label={t("countMode.review.pickRecount", { name: locale === "en" && item.nameEn ? item.nameEn : item.nameAr })}
                        checked={picked.includes(item.itemId)}
                        onChange={(event) => setPicked((list) => (event.target.checked ? [...list, item.itemId] : list.filter((id) => id !== item.itemId)))}
                      />
                    </td>
                  ) : null}
                  <td className="px-[10px] py-[6px]">
                    <span className="block font-semibold text-ink">{locale === "en" && item.nameEn ? item.nameEn : item.nameAr}</span>
                    <span className="mz-num text-[11.5px] text-ink-muted">
                      {item.code}
                      {item.recount ? ` · ${t("countMode.recountBadge")}` : ""}
                    </span>
                  </td>
                  <td className="mz-num px-[10px] py-[6px] text-end">{trimQty(item.systemQty)}</td>
                  <td className="mz-num px-[10px] py-[6px] text-end">{trimQty(item.countedQty)}</td>
                  <td className="px-[10px] py-[6px] text-end"><VarianceCell item={item} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {showItems && canRecount ? (
        <div className="flex flex-col gap-[8px]">
          <TextField label={t("countMode.review.recountReason")} value={reason} onChange={setReason} placeholder={t("countMode.review.recountReasonPlaceholder")} maxLength={300} />
          <div>
            <Button disabled={picked.length === 0 || reason.trim() === "" || recount.isPending} onClick={() => void flagRecount()}>
              <RotateCcw aria-hidden className="h-[14px] w-[14px]" />
              {t("countMode.review.flagRecount", { count: picked.length })}
            </Button>
          </div>
        </div>
      ) : null}
      {showTrail ? (
        <div className="rounded-md border border-border">
          <Trail countId={session.id} zoneId={zone.id} />
        </div>
      ) : null}
    </Card>
  );
}

export function ReviewView({ countId, permissions }: { countId: string; permissions: ReviewPermissions }) {
  const { t } = useAppTranslation();
  const { openSubPage } = useNavigation();
  const sessionQuery = useCountModeSession(countId, true);
  const complete = useCompleteCountMode();
  const post = useGenerateAdjustmentFromCount();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const session = sessionQuery.data;

  if (sessionQuery.isLoading) {
    return (
      <div role="status" className="flex items-center gap-[8px] p-[16px] text-[13px] text-ink-muted">
        <Loader2 aria-hidden className="h-[16px] w-[16px] motion-safe:animate-spin" />
        {t("countMode.loading")}
      </div>
    );
  }
  if (sessionQuery.isError || !session) {
    return <EmptyState title={t("countMode.sessionUnavailableTitle")} description={sessionQuery.error?.message} action={{ label: t("countMode.back"), onClick: () => openSubPage([]) }} />;
  }

  const names = new Map(session.counters.map((c) => [c.userId, c.name] as const));
  const counterName = (id: string) => names.get(id) ?? id;
  const allApproved = session.zones.length > 0 && session.zones.every((z) => z.status === CountZoneStatusDTO.Approved);

  async function finish() {
    setError(null);
    try {
      await complete.mutateAsync(countId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("countMode.completeFailed"));
    }
  }

  async function postAdjustment() {
    setError(null);
    try {
      const result = await post.mutateAsync({ id: countId, body: { adjustmentId: `ADJ-${crypto.randomUUID()}` } });
      setNotice(result.adjustment ? t("countMode.review.posted", { no: result.adjustment.docNo ?? result.adjustment.id }) : t("countMode.review.postedNothing"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("countMode.review.postFailed"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-[14px]">
      <header className="flex flex-wrap items-center gap-[10px]">
        <Button size="sm" onClick={() => openSubPage([])}>
          <ArrowLeft aria-hidden className="h-[14px] w-[14px] rtl:-scale-x-100" />
          {t("countMode.back")}
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold text-ink">{t("countMode.review.title", { no: session.countNo ?? session.id })}</h1>
          <p className="text-[12.5px] text-ink-muted">
            {session.date} · {session.blind ? t("countMode.blindBadge") : t("countMode.openBadge")}
          </p>
        </div>
        <StatusPill label={t(`countMode.sessionStatus.${session.status}`)} tone={session.status === "IN_PROGRESS" ? "warning" : session.status === "CANCELLED" ? "neutral" : "success"} />
      </header>

      {session.netValue !== null ? (
        <Card className="grid grid-cols-2 gap-[12px] p-[14px]">
          <div>
            <p className="text-[12px] text-ink-muted">{t("countMode.review.net")}</p>
            <p className="mz-num text-[20px] font-bold text-ink">{signedMoney(session.netValue)}</p>
          </div>
          <div>
            <p className="text-[12px] text-ink-muted">{t("countMode.review.atRisk")}</p>
            <p className="mz-num text-[20px] font-bold text-ink">{trimMoneyString(session.absValue ?? "0", 2)}</p>
          </div>
        </Card>
      ) : (
        <div role="note" className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[13px] text-ink">
          {t("countMode.review.hiddenVariance")}
        </div>
      )}

      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[13px] text-success-ink">
          {notice}
        </div>
      ) : null}

      {session.zones.map((zone) => (
        <ZoneCard key={zone.id} session={session} zone={zone} permissions={permissions} counterName={counterName} />
      ))}

      <div className="flex flex-wrap items-center justify-end gap-[9px]">
        {session.status === "IN_PROGRESS" && permissions.review ? (
          <Button variant="primary" disabled={!allApproved || complete.isPending} onClick={() => void finish()}>
            {t("countMode.review.complete")}
          </Button>
        ) : null}
        {session.status === "COMPLETED" && permissions.post ? (
          <Button variant="primary" disabled={post.isPending} onClick={() => void postAdjustment()}>
            {post.isPending ? t("countMode.review.posting") : t("countMode.review.post")}
          </Button>
        ) : null}
      </div>
      {session.status === "IN_PROGRESS" && !allApproved ? <p className="text-end text-[12px] text-ink-muted">{t("countMode.review.completeNeedsApproval")}</p> : null}
    </div>
  );
}
