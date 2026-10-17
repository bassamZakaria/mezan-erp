import { Smartphone } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../glance/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "money", section: "reports", itemKeys: ["glance"] }],
  access: { glance: { permission: "dashboard.glance.view" } },
};

export const screens = {
  glance: () => import("../glance/GlanceScreen").then((m) => ({ Component: m.GlanceScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { glance: Smartphone },
};
