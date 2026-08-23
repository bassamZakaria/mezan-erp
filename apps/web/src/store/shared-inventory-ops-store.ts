import { createInventoryOpsStore } from "./inventory-ops-store";
import { demoAccounts } from "../accounts-sample-data";
import { demoAdjustmentSeeds, demoOpenPeriod, demoTransferSeeds } from "../inventory-ops-sample-data";

/**
 * ONE shared `InventoryOpsStore` instance for the 4 inventory-ops screens
 * (Stock Adjustments, Stock Transfers, Physical Counts, Stock Balance) — the
 * same "module-level singleton" shape `ROUTABLE_SCREENS` needs (its entries
 * are zero-prop components, so cross-screen shared state can't be threaded in
 * as a prop the way `useUsersRolesStore` is for the Users/Roles screens,
 * which App.tsx special-cases outside `ROUTABLE_SCREENS` for exactly this
 * reason). Each screen calls `useInventoryOpsStore(sharedInventoryOpsStore)`
 * to get its own reactive binding over this one store, so an adjustment
 * posted on the Adjustments screen is immediately visible on Stock Balance /
 * Physical Counts without any prop-drilling through App.tsx.
 */
export const sharedInventoryOpsStore = createInventoryOpsStore({
  accounts: demoAccounts,
  period: demoOpenPeriod,
  adjustmentSeeds: demoAdjustmentSeeds,
  transferSeeds: demoTransferSeeds,
});
