import { useMemo } from "react";
import { can, createAuthContext, createRepLeaderboardReport, createSalesFunnelReport, createStageAgingReport } from "@mezan/domain";
import { useApi } from "../../../data/ApiContext";
import { monthStartIso, todayIso } from "../../../lib/dates";
import { ReportScreen } from "../../reports/ReportScreen";
import { LeaderboardCard } from "./LeaderboardCard";

const API_ROOT = "/sales-funnel";
const VIEW_COST_PERMISSION = "sales.invoice.view_cost";

export function SalesFunnelScreen() {
  const definition = useMemo(() => createSalesFunnelReport(monthStartIso(), todayIso()), []);
  return (
    <>
      <LeaderboardCard />
      <ReportScreen definition={definition} apiPath="/funnel" apiRoot={API_ROOT} />
    </>
  );
}

export function SalesFunnelAgingScreen() {
  const definition = useMemo(() => createStageAgingReport(), []);
  return <ReportScreen definition={definition} apiPath="/stage-aging" apiRoot={API_ROOT} />;
}

export function RepLeaderboardScreen() {
  const { session } = useApi();
  const withCost = useMemo(
    () =>
      can(
        createAuthContext({ userId: session?.userId ?? "anonymous", permissions: session?.permissions ?? [], branchScope: "*", warehouseScope: "*" }),
        VIEW_COST_PERMISSION,
      ),
    [session],
  );
  const definition = useMemo(() => createRepLeaderboardReport(monthStartIso(), todayIso(), { withCost }), [withCost]);
  return (
    <>
      <LeaderboardCard />
      <ReportScreen definition={definition} apiPath="/rep-leaderboard" apiRoot={API_ROOT} />
    </>
  );
}
