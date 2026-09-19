import type { PermissionFragment } from "../../permissions/fragment.js";

export const fragment: PermissionFragment = {
  rows: [
    ["treasury.cash_forecast.view", "treasury.account.view", "s"],
    ["treasury.cash_forecast.manage", "treasury.cash_forecast.view"],
  ],
};
