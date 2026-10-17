import { Plus, ScanBarcode } from "lucide-react";
import { Button, Card, EmptyState, StatusPill } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import { CountZoneStatusDTO, type CountModeMineEntryDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useWarehouses } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { useCountModeMine } from "./hooks";
import { NewSessionView } from "./NewSessionView";
import { ReviewView, type ReviewPermissions } from "./ReviewView";
import { ScanView } from "./ScanView";
import { CountModeSegment } from "./segments";
import { percentOf } from "./format";

interface CountModeAccess extends ReviewPermissions {
  readonly scan: boolean;
  readonly assign: boolean;
}

function useCountModeAccess(): CountModeAccess {
  const { session } = useApi();
  const auth = createAuthContext({ userId: session?.userId ?? "anonymous", permissions: session?.permissions ?? [], branchScope: "*", warehouseScope: "*" });
  return {
    scan: can(auth, "inventory.count.scan"),
    assign: can(auth, "inventory.count.assign"),
    review: can(auth, "inventory.count.review"),
    approve: can(auth, "inventory.count.approve"),
    post: can(auth, "inventory.count.confirm"),
  };
}

function SessionCard({ entry, access, warehouseName }: { entry: CountModeMineEntryDTO; access: CountModeAccess; warehouseName: string }) {
  const { t } = useAppTranslation();
  const { openSubPage } = useNavigation();
  const seesAll = access.review || access.assign;
  return (
    <Card className="flex flex-col gap-[10px] p-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink">{entry.countNo ?? entry.id}</h2>
          <p className="text-[12px] text-ink-muted">
            {warehouseName} · {entry.date} · {entry.blind ? t("countMode.blindBadge") : t("countMode.openBadge")}
          </p>
        </div>
        {seesAll ? (
          <Button size="sm" onClick={() => openSubPage([entry.id])}>
            {t("countMode.home.manage")}
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-[8px]">
        {entry.zones.map((zone) => (
          <li key={zone.id} className="flex flex-wrap items-center justify-between gap-[8px] rounded-md border border-border bg-surface-2 px-[12px] py-[8px]">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">{zone.name}</p>
              <p className="mz-num text-[12px] text-ink-muted">
                {t("countMode.progress", { counted: zone.countedItems, total: zone.totalItems })} · {percentOf(zone.countedItems, zone.totalItems)}%
                {zone.recountItems > 0 ? ` · ${t("countMode.review.recountPending", { count: zone.recountItems })}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-[8px]">
              <StatusPill label={t(`countMode.zoneStatus.${zone.status}`)} tone={zone.status === CountZoneStatusDTO.Open ? "warning" : zone.status === CountZoneStatusDTO.Submitted ? "info" : "success"} />
              {zone.assignedToMe && access.scan ? (
                <Button size="sm" variant="primary" onClick={() => openSubPage([entry.id, zone.id])}>
                  <ScanBarcode aria-hidden className="h-[16px] w-[16px]" />
                  {zone.status === CountZoneStatusDTO.Open ? t("countMode.home.startCounting") : t("countMode.home.view")}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Home({ access }: { access: CountModeAccess }) {
  const { t } = useAppTranslation();
  const { openSubPage } = useNavigation();
  const mine = useCountModeMine();
  const warehouses = useWarehouses();
  const warehouseName = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;
  const entries = mine.data ?? [];
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-[14px]">
      <div className="flex flex-wrap items-start justify-between gap-[10px]">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t("countMode.home.title")}</h1>
          <p className="mt-[4px] max-w-[70ch] text-[12.5px] text-ink-muted">{t("countMode.home.subtitle")}</p>
        </div>
        {access.assign ? (
          <Button variant="primary" onClick={() => openSubPage([CountModeSegment.New])}>
            <Plus aria-hidden className="h-[14px] w-[14px]" />
            {t("countMode.home.newSession")}
          </Button>
        ) : null}
      </div>
      {mine.isLoading ? (
        <p role="status" className="text-[13px] text-ink-muted">
          {t("countMode.loading")}
        </p>
      ) : mine.isError ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[13px] text-danger-ink">
          {mine.error.message}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title={t("countMode.home.emptyTitle")} description={access.scan ? t("countMode.home.emptyBody") : t("countMode.home.emptyBodyManager")} />
      ) : (
        entries.map((entry) => <SessionCard key={entry.id} entry={entry} access={access} warehouseName={warehouseName(entry.warehouseId)} />)
      )}
    </div>
  );
}

export function CountModeScreen() {
  const { t } = useAppTranslation();
  const { segments } = useNavigation();
  const access = useCountModeAccess();
  const [first, second] = segments;

  if (!access.scan && !access.review && !access.assign) {
    return <EmptyState title={t("countMode.noAccessTitle")} description={t("countMode.noAccessBody")} />;
  }
  if (first && second) return <ScanView countId={first} zoneId={second} />;
  if (first === CountModeSegment.New && access.assign) return <NewSessionView />;
  if (first && (access.review || access.assign)) return <ReviewView countId={first} permissions={access} />;
  return <Home access={access} />;
}
