/**
 * `demoWarehouses` is the one constant left here: `StockTransfersScreen`,
 * `StockAdjustmentsScreen` and `PhysicalCountsScreen` still run against the
 * in-memory `store/inventory-ops-store.ts` (docs/web-data-wiring.md's
 * "Domain-in-browser" gap — a separate conversion, out of this sweep's
 * scope), so it can't be removed until those three move onto the real
 * `/warehouses` + inventory API. Every other demo constant that used to live
 * here (the nav registry, users/roles/branches/employees/entitlements demo
 * data, the unused command-palette list) has moved to real API data or to
 * `navigation/registry.ts` — see App.tsx.
 */
export const demoWarehouses = [
  { id: "MAIN-WH", name: "مستودع الفرع الرئيسي", branchId: "MAIN" },
  { id: "VAN-1", name: "سياره نقل", branchId: "MAIN" },
];
