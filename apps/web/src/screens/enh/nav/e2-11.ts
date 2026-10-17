import { UserRoundPlus } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../provisioning/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "setup", section: "permissions", itemKeys: ["user-provisioning"] }],
  access: {
    "user-provisioning": { permission: "admin.users.create" },
  },
};

export const screens = {
  "user-provisioning": () => import("../provisioning/ProvisioningScreen").then((m) => ({ Component: m.ProvisioningScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { "user-provisioning": UserRoundPlus },
};
