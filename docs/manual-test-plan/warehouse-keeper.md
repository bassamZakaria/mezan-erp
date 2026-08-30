# Manual Test Plan — Warehouse Keeper (أمين مخزن)

Scope: everything the person who is physically accountable for the stock count
would run to accept the inventory module. Grounded against the code actually
in this worktree — every scenario below exercises a real screen
(`apps/web/src/screens/*.tsx`) and a real route (`packages/api/src/*-routes.ts`),
not the archived catalog aspiration at `docs/archive/catalog/03-inventory.md`.
Screens/routes verified present: `GoodsReceiptsScreen.tsx` (+ `purchases-routes.ts`
`/purchases/receipts*`), `StockAdjustmentsScreen.tsx` (+ `stock-documents-routes.ts`
`/inventory/stock-adjustments*`), `StockTransfersScreen.tsx` (+
`/inventory/stock-transfers*`), `PhysicalCountsScreen.tsx` (+
`/inventory/physical-counts*`), `StockBalanceScreen.tsx` (+
`/inventory/stock-balance`), `LabelPrintingScreen.tsx`, `VanTripsScreen.tsx` (+
`field-sales` routes), `WritedownRunsScreen.tsx` (+ `inventory-writedown-routes.ts`),
`WarehousesPage.tsx` (+ `warehouses-routes.ts`), and the eight report screens in
`apps/web/src/screens/reports/InventoryReportsScreens.tsx`.

Every stock-quantity assertion below is paired with its money consequence
(weighted-average unit cost and/or the `1200 — المخزون` GL balance) per the
brief — never quantity alone.

Preconditions common to all scenarios unless stated otherwise:
- Backend seeded with `MEZAN_SEED_DEMO=1`.
- Signed in as a user holding `inventory.adjustment.*`, `inventory.transfer.*`,
  `inventory.count.*`, `purchases.receipt.*` and `admin.warehouses.*` (the demo
  seed's default admin has all of these; see the "scoping" section for a
  narrower role).
- Tenant settings (`Settings → عام` / `SettingsGeneral.tsx`) at their seeded
  defaults: «يجب وجود أمر شراء قبل استلام البضاعة» ON, «السماح بالمخزون
  السالب» OFF, «السماح بالطلبات المؤجلة» OFF, «توليد أرقام الدفعات تلقائيًا»
  OFF — scenarios that flip one of these say so explicitly and must flip it
  back afterward.
