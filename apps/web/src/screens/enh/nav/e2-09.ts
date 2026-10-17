import { HandCoins } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../collections/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "sell", section: "daily", itemKeys: ["collections"] }],
  access: { collections: { permission: "sales.collections.view", module: "sales" } },
};

export const screens = {
  collections: () => import("../collections/CollectionsScreen").then((m) => ({ Component: m.CollectionsScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { collections: HandCoins },
};
