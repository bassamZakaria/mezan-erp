import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../health/strings";

export const navFragment: NavFragment = {};
export const screens = {
  status: () => import("../health/HealthConsoleScreen").then((m) => ({ Component: m.HealthConsoleScreen })),
} satisfies ScreenLoaderFragment;
export const icons: NavIconFragment = {};
