import { ChartLine } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../cash-forecast/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "treasury", itemKeys: ["cash-forecast"] }],
  access: {
    "cash-forecast": { permission: "treasury.cash_forecast.view", module: "treasury" },
  },
};

export const screens = {
  "cash-forecast": () => import("../cash-forecast/CashForecastScreen").then((m) => ({ Component: m.CashForecastScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { "cash-forecast": ChartLine },
};
