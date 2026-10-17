import { Mail } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../owner-digest/strings";

export const navFragment: NavFragment = {
  placements: [{ group: "money", section: "reports", itemKeys: ["owner-digest"] }],
  access: { "owner-digest": { permission: "accounting.owner_digest.view", module: "accounting" } },
};

export const screens = {
  "owner-digest": () => import("../owner-digest/OwnerDigestScreen").then((m) => ({ Component: m.OwnerDigestScreen })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: { "owner-digest": Mail },
};
