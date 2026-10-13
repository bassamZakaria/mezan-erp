import type { ReactNode } from "react";
import { DashboardRequest } from "@mezan/domain";
import { Button, Money, StatCard, useFormat } from "@mezan/ui";
import {
  useDashboardGate,
  useLeaveRequestCounts,
  useMyLeave,
  useTreasuryAccountStats,
  useVoucherCounts,
} from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useNavigation } from "../navigation";
import type { ScreenKey } from "../router/screens";

export interface DeskTile {
  readonly key: string;
  readonly labelKey: AppTranslationKey;
  readonly value: ReactNode;
  readonly screen: ScreenKey;
  readonly actionKey: AppTranslationKey;
}

export interface Desk {
  readonly askable: boolean;
  readonly tiles: readonly DeskTile[];
}

export function useDeskTiles(): Desk {
  const format = useFormat();
  const mayAsk = useDashboardGate();
  const seesBalances =
    mayAsk(DashboardRequest.TreasuryBalances) &&
    !mayAsk(DashboardRequest.Summary);
  const seesVouchers = mayAsk(DashboardRequest.VoucherCounts);
  const seesLeaveQueue = mayAsk(DashboardRequest.LeaveRequestCounts);
  const seesOwnLeave = mayAsk(DashboardRequest.MyLeave);

  const balances = useTreasuryAccountStats({ enabled: seesBalances });
  const vouchers = useVoucherCounts({}, { enabled: seesVouchers });
  const leaveQueue = useLeaveRequestCounts({ enabled: seesLeaveQueue });
  const ownLeave = useMyLeave({ enabled: seesOwnLeave });

  const count = (value: number | undefined) => (
    <span className="mz-num">{format.number(value ?? 0)}</span>
  );
  const tiles: DeskTile[] = [];
  if (
    seesBalances &&
    balances.data?.liveCash !== undefined &&
    balances.data.liveBank !== undefined
  ) {
    tiles.push(
      {
        key: "cash",
        labelKey: "dashboard.desk.cash",
        value: <Money value={balances.data.liveCash} />,
        screen: "treasury-accounts",
        actionKey: "dashboard.desk.cash.action",
      },
      {
        key: "bank",
        labelKey: "dashboard.desk.bank",
        value: <Money value={balances.data.liveBank} />,
        screen: "treasury-accounts",
        actionKey: "dashboard.desk.cash.action",
      },
    );
  }
  if (seesVouchers && vouchers.data) {
    tiles.push({
      key: "draftVouchers",
      labelKey: "dashboard.desk.draftVouchers",
      value: count(vouchers.data["draft"]),
      screen: "treasury-vouchers",
      actionKey: "dashboard.desk.draftVouchers.action",
    });
  }
  if (seesLeaveQueue && leaveQueue.data) {
    tiles.push({
      key: "leaveQueue",
      labelKey: "dashboard.desk.leaveQueue",
      value: count(leaveQueue.data.pending),
      screen: "leave-requests",
      actionKey: "dashboard.desk.leaveQueue.action",
    });
  }
  if (seesOwnLeave && ownLeave.data) {
    tiles.push({
      key: "ownLeave",
      labelKey: "dashboard.desk.ownLeave",
      value: count(
        ownLeave.data.requests.filter((request) => request.status === "pending")
          .length,
      ),
      screen: "my-leave",
      actionKey: "dashboard.desk.ownLeave.action",
    });
  }
  return {
    askable:
      seesBalances ||
      seesVouchers ||
      seesLeaveQueue ||
      seesOwnLeave,
    tiles,
  };
}

export function DeskTiles({ tiles }: { readonly tiles: readonly DeskTile[] }) {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  if (tiles.length === 0) return null;
  return (
    <section aria-label={t("dashboard.desk")}>
      <div className="mb-[8px] mz-eyebrow">{t("dashboard.desk")}</div>
      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.key} className="flex min-w-0 flex-col gap-[8px]">
            <StatCard label={t(tile.labelKey)} value={tile.value} />
            <Button
              size="sm"
              className="self-start"
              onClick={() => navigate(tile.screen)}
            >
              {t(tile.actionKey)}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
