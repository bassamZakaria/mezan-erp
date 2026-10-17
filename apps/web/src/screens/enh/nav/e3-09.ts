import { Plug } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../integrations/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "setup", section: "permissions", itemKeys: ["integrations"] }],
  access: { integrations: { permission: "admin.integrations.view", module: "integrations" } },
};

export const screens = {
  integrations: () => import("../integrations/IntegrationsScreen").then((m) => ({ Component: m.IntegrationsScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { integrations: Plug },
};
