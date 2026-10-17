import { ClipboardList, ScanBarcode } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../count-mode/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "stock", itemKeys: ["count-mode", "count-review"] }],
  access: {
    "count-mode": { permission: "inventory.count.scan", module: "inventory" },
    "count-review": { permission: "inventory.count.review", module: "inventory" },
  },
};

export const screens = {
  "count-mode": () => import("../count-mode/CountModeScreen").then((m) => ({ Component: m.CountModeScreen })),
  "count-review": () => import("../count-mode/CountModeScreen").then((m) => ({ Component: m.CountModeScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { "count-mode": ScanBarcode, "count-review": ClipboardList },
};
