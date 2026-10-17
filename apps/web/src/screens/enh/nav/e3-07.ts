import { ChartNoAxesColumn, Funnel, Hourglass } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../sales-funnel/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "crm", itemKeys: ["sales-funnel", "sales-funnel-aging", "rep-leaderboard"] }],
  access: {
    "sales-funnel": { permission: "crm.funnel.view", module: "crm" },
    "sales-funnel-aging": { permission: "crm.funnel.view", module: "crm" },
    "rep-leaderboard": { permission: "crm.funnel.view", module: "crm" },
  },
};

export const screens = {
  "sales-funnel": () => import("../sales-funnel/SalesFunnelScreens").then((m) => ({ Component: m.SalesFunnelScreen })),
  "sales-funnel-aging": () => import("../sales-funnel/SalesFunnelScreens").then((m) => ({ Component: m.SalesFunnelAgingScreen })),
  "rep-leaderboard": () => import("../sales-funnel/SalesFunnelScreens").then((m) => ({ Component: m.RepLeaderboardScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { "sales-funnel": Funnel, "sales-funnel-aging": Hourglass, "rep-leaderboard": ChartNoAxesColumn },
};
