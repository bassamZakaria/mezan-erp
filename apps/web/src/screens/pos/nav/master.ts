import { Clock4, CreditCard, MonitorSmartphone, Store, SlidersHorizontal } from "lucide-react";
import type { NavFragment, NavIconFragment, ScreenLoaderFragment } from "../../../fragments";

export { ar, en } from "../master/strings";

/**
 * نقاط البيع — its own workspace after البيع والتحصيل. It declares the three
 * shelves every POS lane fills (`daily`, `reports`, `config`); an empty shelf
 * is dropped from the rail. الورديات is a platform setting (HR uses it too),
 * so it lives on الإعداد's company shelf, not behind the POS licence.
 */
export const navFragment: NavFragment = {
  groups: [
    {
      key: "pos",
      after: "sell",
      defaultCollapsed: true,
      itemKeys: [],
      sections: [
        { key: "daily", itemKeys: [] },
        { key: "reports", itemKeys: [], defaultCollapsed: true },
        { key: "config", itemKeys: ["pos-terminals", "pos-payment-methods", "pos-settings"] },
      ],
    },
  ],
  placements: [{ group: "setup", section: "company", itemKeys: ["settings-shifts"] }],
  access: {
    "pos-terminals": { permission: "pos.terminal.view", module: "pos" },
    "pos-payment-methods": { permission: "pos.terminal.view", module: "pos" },
    "pos-settings": { permission: "pos.terminal.view", module: "pos" },
    "settings-shifts": { permission: "admin.settings.view" },
  },
  groupModules: { pos: "pos" },
};

export const screens = {
  "pos-terminals": () => import("../master/TerminalsScreen").then((m) => ({ Component: m.TerminalsScreen })),
  "pos-payment-methods": () => import("../master/PaymentMethodsScreen").then((m) => ({ Component: m.PaymentMethodsScreen })),
  "pos-settings": () => import("../master/PosSettingsScreen").then((m) => ({ Component: m.PosSettingsScreen })),
  "settings-shifts": () => import("../../../settings/ShiftTemplatesPage").then((m) => ({ Component: m.ShiftTemplatesPage })),
} satisfies ScreenLoaderFragment;

export const icons: NavIconFragment = {
  items: {
    "pos-terminals": MonitorSmartphone,
    "pos-payment-methods": CreditCard,
    "pos-settings": SlidersHorizontal,
    "settings-shifts": Clock4,
  },
  groups: { pos: Store },
};
