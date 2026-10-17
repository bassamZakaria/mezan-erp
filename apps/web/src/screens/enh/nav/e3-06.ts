import { ChartNoAxesCombined } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../crm-pipeline/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "crm", itemKeys: ["crm-forecast"] }],
  access: { "crm-forecast": { permission: "crm.pipeline.view", module: "crm" } },
};

export const screens = {
  "crm-forecast": () => import("../crm-pipeline/CrmForecastScreen").then((m) => ({ Component: m.CrmForecastScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { "crm-forecast": ChartNoAxesCombined },
};
