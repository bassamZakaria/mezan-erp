import { PackagePlus } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../reorder/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "stock", itemKeys: ["reorder"] }],
  access: { reorder: { permission: "inventory.reorder.view", module: "inventory" } },
};

export const screens = {
  reorder: () => import("../reorder/ReorderScreen").then((m) => ({ Component: m.ReorderScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { reorder: PackagePlus },
};
