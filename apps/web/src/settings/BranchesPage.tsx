import { useMemo, useState, type ReactNode } from "react";
import { DocumentList, DocumentDetail, StatusPill, Button, Card, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import { Money as MoneyValue } from "@mezan/ui";
import { SALES_INVOICE_ACTIVE_STATUSES } from "@mezan/domain";
import type { AssetStatusDTO, BranchDTO, EmployeeDTO, TreasuryAccountDTO } from "@mezan/contracts";
import {
  useAssetCategories,
  useAssets,
  useBranches,
  useCreateBranch,
  useEmployees,
  useItems,
  usePurchaseInvoices,
  useSalesInvoices,
  useTreasuryAccounts,
  useVouchers,
  useWarehouses,
} from "../data/hooks";
import { moneyToNumber, parseMoney, sumMoney, useBranchStockBalance } from "../data/partner-detail-hooks";
import { branchName } from "./branch-name";
import { TextField, ToggleField, SectionCard } from "./form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * الفروع (Branches) — docs/catalog/09 §"إدارة الفروع" list +
 * §"صفحة الفرع — MAIN (Branch detail / Branch 360)" detail.
 *
 * Every Branch-360 tab is scoped by the `branchId` its source documents already
 * carry: مؤشرات الفرع and النشاط from `/sales-invoices`, `/purchases/invoices`
 * and `/vouchers`; المخزون from `/inventory/stock-balance` per warehouse of the
 * branch; الموظفون from `/hr/employees`; الأصول from `/assets`.
 *
 * النشاط lists the branch's own DOCUMENTS rather than the audit trail: an audit
 * event (`GET /audit`) carries no branch dimension, so it cannot be scoped here.
 */

const TREASURY_TYPE_KEY: Record<TreasuryAccountDTO["type"], AppTranslationKey> = { cash: "branches.treasuryCash", bank: "branches.treasuryBank" };

const ASSET_STATUS_KEY: Record<AssetStatusDTO, AppTranslationKey> = {
  active: "common.active",
  under_maintenance: "branches.assetUnderMaintenance",
  fully_depreciated: "branches.assetFullyDepreciated",
  disposed: "branches.assetDisposed",
};

const ASSET_STATUS_TONE: Record<AssetStatusDTO, PillTone> = {
  active: "success",
  under_maintenance: "info",
  fully_depreciated: "warning",
  disposed: "neutral",
};

const EMPLOYEE_STATUS_KEY: Record<EmployeeDTO["status"], AppTranslationKey> = {
  active: "branches.employeeActive",
  on_leave: "branches.employeeOnLeave",
  suspended: "branches.employeeSuspended",
  terminated: "branches.employeeTerminated",
};

const EMPLOYEE_STATUS_TONE: Record<EmployeeDTO["status"], PillTone> = {
  active: "success",
  on_leave: "info",
  suspended: "warning",
  terminated: "neutral",
};

function isoToDisplay(date: string): string {
  return date.slice(0, 10).split("-").reverse().join("/");
}

function employeeName(employee: EmployeeDTO): string {
  const arabic = [employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ").trim();
  return arabic === "" ? `${employee.firstName} ${employee.lastName}` : arabic;
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useAppTranslation();
  return (
    <Card className="p-[18px_20px]">
      <p className="text-[13px] font-semibold text-danger-ink">{message}</p>
      <Button size="sm" className="mt-[10px]" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </Card>
  );
}

function EmptyTab({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[22px_24px]">
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      <p className="mt-[8px] max-w-[70ch] text-[12.5px] leading-[1.9] text-ink-muted">{body}</p>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[14px_16px]">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[6px] text-[16px] font-bold text-ink">{value}</div>
      {sub ? <div className="mt-[4px] text-[11.5px] text-ink-muted">{sub}</div> : null}
    </div>
  );
}

/** مؤشرات الفرع — live counts and totals over every document that carries this `branchId`. */
function BranchKpis({ branch }: { branch: BranchDTO }) {
  const { t } = useAppTranslation();
  const warehousesQuery = useWarehouses();
  const treasuryQuery = useTreasuryAccounts();
  const salesQuery = useSalesInvoices();
  const purchasesQuery = usePurchaseInvoices();
  const vouchersQuery = useVouchers();
  const employeesQuery = useEmployees();
  const assetsQuery = useAssets();

  const warehouseIds = useMemo(
    () => (warehousesQuery.data ?? []).filter((w) => w.branchId === branch.id).map((w) => w.id),
    [warehousesQuery.data, branch.id],
  );
  const stockQuery = useBranchStockBalance(warehouseIds);

  const treasuryAccounts = (treasuryQuery.data ?? []).filter((a) => a.branchId === branch.id);
  const salesInvoices = (salesQuery.data ?? []).filter((i) => i.branchId === branch.id && SALES_INVOICE_ACTIVE_STATUSES.has(i.status));
  const purchaseInvoices = (purchasesQuery.data ?? []).filter((i) => i.branchId === branch.id && i.status === "confirmed");
  const vouchers = (vouchersQuery.data ?? []).filter(
    (v) => v.branchId === branch.id && (v.status === "confirmed" || v.status === "posted"),
  );
  const employees = (employeesQuery.data ?? []).filter((e) => e.branchId === branch.id);
  const assets = (assetsQuery.data ?? []).filter((a) => a.branchId === branch.id);

  const salesTotal = sumMoney(salesInvoices.map((i) => i.totals.grandTotal));
  const purchasesTotal = sumMoney(purchaseInvoices.map((i) => i.total));
  const stockValue = sumMoney((stockQuery.data ?? []).map((row) => row.totalValue));
  const assetsCost = sumMoney(assets.map((a) => a.acquisitionCost));
  const voucherNet = vouchers.reduce<bigint>(
    (total, v) => (v.direction === "receipt" ? total + parseMoney(v.amount) : v.direction === "payment" ? total - parseMoney(v.amount) : total),
    0n,
  );

  return (
    <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
      <Kpi
        label={t("branches.branchSalesLiveInvoices")}
        value={<MoneyValue value={moneyToNumber(salesTotal)} showUnit={false} />}
        sub={<span className="mz-num">{salesInvoices.length} {t("branches.invoice")}</span>}
      />
      <Kpi
        label={t("branches.branchPurchasesConfirmedInvoices")}
        value={<MoneyValue value={moneyToNumber(purchasesTotal)} showUnit={false} />}
        sub={<span className="mz-num">{purchaseInvoices.length} {t("branches.invoice")}</span>}
      />
      <Kpi
        label={t("branches.netVoucherMovement")}
        value={<MoneyValue value={moneyToNumber(voucherNet)} showUnit={false} />}
        sub={<span className="mz-num">{vouchers.length} {t("branches.voucher")}</span>}
      />
      <Kpi
        label={t("branches.stockValue")}
        value={
          warehouseIds.length === 0 ? (
            <span className="text-[12.5px] font-normal text-ink-muted">{t("branches.noWarehouses")}</span>
          ) : (
            <MoneyValue value={moneyToNumber(stockValue)} showUnit={false} />
          )
        }
        sub={<span className="mz-num">{warehouseIds.length} {t("branches.warehouse")}</span>}
      />
      <Kpi
        label={t("branches.treasuryAccounts")}
        value={<span className="mz-num">{treasuryAccounts.length}</span>}
        sub={<span className="mz-num">{treasuryAccounts.filter((a) => a.type === "bank").length} {t("branches.bank")}</span>}
      />
      <Kpi
        label={t("branches.employees")}
        value={<span className="mz-num">{employees.length}</span>}
        sub={<span className="mz-num">{employees.filter((e) => e.status === "active").length} {t("branches.employed")}</span>}
      />
      <Kpi
        label={t("branches.fixedAssets")}
        value={<span className="mz-num">{assets.length}</span>}
        sub={<MoneyValue value={moneyToNumber(assetsCost)} showUnit={false} />}
      />
      <Kpi label={t("branches.branchStatus")} value={branch.active ? t("common.active") : t("common.inactive")} sub={branch.isMain ? t("branches.headBranch") : t("branches.subBranch")} />
    </div>
  );
}

/** مخزون الفرع — the merged `/inventory/stock-balance` of every warehouse in the branch. */
function BranchInventoryTab({ branch }: { branch: BranchDTO }) {
  const { t } = useAppTranslation();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const warehouses = (warehousesQuery.data ?? []).filter((w) => w.branchId === branch.id);
  const stockQuery = useBranchStockBalance(warehouses.map((w) => w.id));

  const itemName = useMemo(() => {
    const byId = new Map((itemsQuery.data ?? []).map((item) => [item.id, item]));
    return (itemId: string) => byId.get(itemId)?.nameAr ?? itemId;
  }, [itemsQuery.data]);
  const itemCode = useMemo(() => {
    const byId = new Map((itemsQuery.data ?? []).map((item) => [item.id, item]));
    return (itemId: string) => byId.get(itemId)?.code ?? "—";
  }, [itemsQuery.data]);

  if (warehousesQuery.isError) return <TabError message={t("branches.couldNotLoadTheBranch")} onRetry={() => warehousesQuery.refetch()} />;
  if (warehouses.length === 0) {
    return (
      <EmptyTab
        title={t("branches.noWarehousesAreLinkedTo")}
        body={t("branches.stockIsCountedFromThe")}
      />
    );
  }
  if (stockQuery.isError) return <TabError message={t("branches.couldNotLoadTheBranch2")} onRetry={() => stockQuery.refetch()} />;
  if (stockQuery.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">{t("branches.loadingStock")}</p>;

  const rows = [...(stockQuery.data ?? [])].sort((a, b) => {
    const left = parseMoney(a.totalValue);
    const right = parseMoney(b.totalValue);
    return right === left ? a.itemId.localeCompare(b.itemId) : right > left ? 1 : -1;
  });
  if (rows.length === 0) {
    return (
      <EmptyTab
        title={t("branches.noStockInThisBranch")}
        body={`مستودعات الفرع (${warehouses.map((w) => w.name).join(t("branches.text"))}) لم تستلم أي بضاعة بعد، أو صُرف كل ما بها.`}
      />
    );
  }

  const totalValue = sumMoney(rows.map((row) => row.totalValue));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3">
        <Kpi label={t("branches.items")} value={<span className="mz-num">{rows.length}</span>} />
        <Kpi label={t("branches.warehouses")} value={<span className="mz-num">{warehouses.length}</span>} />
        <Kpi label={t("branches.totalStockValue")} value={<MoneyValue value={moneyToNumber(totalValue)} showUnit={false} />} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">{t("common.item")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.code")}</th>
              <th className="p-[10px] text-end font-semibold">{t("common.qty")}</th>
              <th className="p-[10px] text-end font-semibold">{t("branches.averageCost")}</th>
              <th className="p-[10px] text-end font-semibold">{t("branches.value")}</th>
              <th className="p-[10px] text-end font-semibold">{t("branches.warehouses")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.itemId} className="border-b border-border last:border-b-0">
                <td className="p-[10px] font-semibold text-ink">{itemName(row.itemId)}</td>
                <td className="mz-num p-[10px] text-ink-muted">{itemCode(row.itemId)}</td>
                <td className="mz-num p-[10px] text-end text-ink">{Number(row.onHand)}</td>
                <td className="p-[10px] text-end text-ink-muted">
                  <MoneyValue value={Number(row.averageCost)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end font-semibold text-ink">
                  <MoneyValue value={Number(row.totalValue)} showUnit={false} />
                </td>
                <td className="mz-num p-[10px] text-end text-ink-muted">{row.warehouseCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** موظفو الفرع — `GET /hr/employees` narrowed by the `branchId` every employee carries. */
function BranchEmployeesTab({ branch }: { branch: BranchDTO }) {
  const { t } = useAppTranslation();
  const query = useEmployees();
  const employees = useMemo(
    () => (query.data ?? []).filter((e) => e.branchId === branch.id).sort((a, b) => a.code.localeCompare(b.code)),
    [query.data, branch.id],
  );

  if (query.isError) return <TabError message={t("branches.couldNotLoadTheBranch3")} onRetry={() => query.refetch()} />;
  if (query.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">{t("branches.loadingEmployees")}</p>;
  if (employees.length === 0) {
    return (
      <EmptyTab
        title={t("branches.noEmployeesAreRecordedAgainst")}
        body={t("branches.everyEmployeeBelongsToOne")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3">
        <Kpi label={t("branches.totalEmployees")} value={<span className="mz-num">{employees.length}</span>} />
        <Kpi label={t("branches.employed")} value={<span className="mz-num">{employees.filter((e) => e.status === "active").length}</span>} />
        <Kpi label={t("branches.fullTime")} value={<span className="mz-num">{employees.filter((e) => e.employmentType === "full_time").length}</span>} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">{t("common.code")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.name")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.phone")}</th>
              <th className="p-[10px] text-start font-semibold">{t("branches.hiredOn")}</th>
              <th className="p-[10px] text-start font-semibold">{t("branches.employmentType")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id} className="border-b border-border last:border-b-0">
                <td className="mz-num p-[10px] text-ink-muted">{employee.code}</td>
                <td className="p-[10px] font-semibold text-ink">{employeeName(employee)}</td>
                <td className="mz-num p-[10px] text-ink-muted">{employee.phone ?? "—"}</td>
                <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(employee.hireDate)}</td>
                <td className="p-[10px] text-ink-muted">{employee.employmentType === "full_time" ? t("branches.fullTime") : t("branches.partTime")}</td>
                <td className="p-[10px]">
                  <StatusPill label={t(EMPLOYEE_STATUS_KEY[employee.status])} tone={EMPLOYEE_STATUS_TONE[employee.status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** أصول الفرع — `GET /assets` narrowed by `branchId`. */
function BranchAssetsTab({ branch }: { branch: BranchDTO }) {
  const { t } = useAppTranslation();
  const query = useAssets();
  const categoriesQuery = useAssetCategories();
  const assets = useMemo(
    () => (query.data ?? []).filter((a) => a.branchId === branch.id).sort((a, b) => a.code.localeCompare(b.code)),
    [query.data, branch.id],
  );
  const categoryName = useMemo(() => {
    const byId = new Map((categoriesQuery.data ?? []).map((cat) => [cat.id, cat.nameAr]));
    return (categoryId: string) => byId.get(categoryId) ?? categoryId;
  }, [categoriesQuery.data]);

  if (query.isError) return <TabError message={t("branches.couldNotLoadTheBranch4")} onRetry={() => query.refetch()} />;
  if (query.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">{t("branches.loadingAssets")}</p>;
  if (assets.length === 0) {
    return (
      <EmptyTab
        title={t("branches.noFixedAssetsAreRecorded")}
        body={t("branches.anAssetBelongsEitherTo")}
      />
    );
  }

  const cost = sumMoney(assets.map((a) => a.acquisitionCost));
  const accumulated = sumMoney(assets.map((a) => a.accumulatedDepreciation));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3">
        <Kpi label={t("branches.assets")} value={<span className="mz-num">{assets.length}</span>} />
        <Kpi label={t("branches.totalCost")} value={<MoneyValue value={moneyToNumber(cost)} showUnit={false} />} />
        <Kpi label={t("branches.netBookValue")} value={<MoneyValue value={moneyToNumber(cost - accumulated)} showUnit={false} />} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">{t("common.code")}</th>
              <th className="p-[10px] text-start font-semibold">{t("branches.asset")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.category")}</th>
              <th className="p-[10px] text-start font-semibold">{t("branches.acquiredOn")}</th>
              <th className="p-[10px] text-end font-semibold">{t("branches.cost")}</th>
              <th className="p-[10px] text-end font-semibold">{t("branches.accumulatedDepreciation")}</th>
              <th className="p-[10px] text-end font-semibold">{t("branches.netValue")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id} className="border-b border-border last:border-b-0">
                <td className="mz-num p-[10px] text-ink-muted">{asset.code}</td>
                <td className="p-[10px] font-semibold text-ink">{asset.nameAr}</td>
                <td className="p-[10px] text-ink-muted">{categoryName(asset.categoryId)}</td>
                <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(asset.acquisitionDate)}</td>
                <td className="p-[10px] text-end text-ink">
                  <MoneyValue value={Number(asset.acquisitionCost)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end text-ink-muted">
                  <MoneyValue value={Number(asset.accumulatedDepreciation)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end font-semibold text-ink">
                  <MoneyValue value={moneyToNumber(parseMoney(asset.acquisitionCost) - parseMoney(asset.accumulatedDepreciation))} showUnit={false} />
                </td>
                <td className="p-[10px]">
                  <StatusPill label={t(ASSET_STATUS_KEY[asset.status])} tone={ASSET_STATUS_TONE[asset.status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface BranchActivityRow {
  readonly key: string;
  readonly date: string;
  readonly kind: string;
  readonly reference: string;
  readonly detail: string;
  readonly amount: number;
}

/**
 * نشاط الفرع — the branch's own documents, newest first. `GET /audit` carries
 * no branch dimension, so the audit trail cannot be scoped to a branch here.
 */
function BranchActivityTab({ branch }: { branch: BranchDTO }) {
  const { t } = useAppTranslation();
  const salesQuery = useSalesInvoices();
  const purchasesQuery = usePurchaseInvoices();
  const vouchersQuery = useVouchers();

  const rows = useMemo<BranchActivityRow[]>(() => {
    const built: BranchActivityRow[] = [];
    for (const inv of salesQuery.data ?? []) {
      if (inv.branchId !== branch.id) continue;
      built.push({
        key: `si-${inv.id}`,
        date: inv.date,
        kind: t("branches.salesInvoice"),
        reference: inv.docNo ?? inv.id,
        detail: inv.customerNameAr,
        amount: Number(inv.totals.grandTotal),
      });
    }
    for (const inv of purchasesQuery.data ?? []) {
      if (inv.branchId !== branch.id) continue;
      built.push({
        key: `pi-${inv.id}`,
        date: inv.date,
        kind: t("branches.purchaseInvoice"),
        reference: inv.number,
        detail: inv.supplierInvoiceNumber ?? "—",
        amount: Number(inv.total),
      });
    }
    for (const voucher of vouchersQuery.data ?? []) {
      if (voucher.branchId !== branch.id) continue;
      built.push({
        key: `vc-${voucher.id}`,
        date: voucher.date,
        kind: voucher.direction === "receipt" ? t("branches.receiptVoucher") : voucher.direction === "payment" ? t("branches.paymentVoucher") : t("branches.treasuryTransfer"),
        reference: voucher.docNo ?? voucher.id,
        detail: voucher.memo === "" ? "—" : voucher.memo,
        amount: Number(voucher.amount),
      });
    }
    return built.sort((a, b) => (a.date === b.date ? b.key.localeCompare(a.key) : b.date.localeCompare(a.date)));
  }, [salesQuery.data, purchasesQuery.data, vouchersQuery.data, branch.id]);

  if (salesQuery.isError || purchasesQuery.isError || vouchersQuery.isError) {
    return (
      <TabError
        message={t("branches.couldNotLoadTheBranch5")}
        onRetry={() => {
          salesQuery.refetch();
          purchasesQuery.refetch();
          vouchersQuery.refetch();
        }}
      />
    );
  }
  if (salesQuery.isLoading || purchasesQuery.isLoading || vouchersQuery.isLoading) {
    return <p className="p-[18px] text-[12.5px] text-ink-muted">{t("branches.loadingActivity")}</p>;
  }
  if (rows.length === 0) {
    return (
      <EmptyTab
        title={t("branches.noMovementIsRecordedAgainst")}
        body={t("branches.activityIsBuiltFromThe")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">{t("common.date")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.type")}</th>
              <th className="p-[10px] text-start font-semibold">{t("branches.document")}</th>
              <th className="p-[10px] text-start font-semibold">{t("branches.description")}</th>
              <th className="p-[10px] text-end font-semibold">{t("common.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-border last:border-b-0">
                <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(row.date)}</td>
                <td className="p-[10px] text-ink">{row.kind}</td>
                <td className="mz-num p-[10px] font-semibold text-ink">{row.reference}</td>
                <td className="p-[10px] text-ink-muted">{row.detail}</td>
                <td className="p-[10px] text-end font-semibold text-ink">
                  <MoneyValue value={row.amount} showUnit={false} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-[80ch] text-[11.5px] leading-[1.9] text-ink-faint">
        {t("branches.thisTabShowsTheBranch")}
      </p>
    </div>
  );
}

function BranchDetail({ branch, onBack }: { branch: BranchDTO; onBack: () => void }) {
  const { t } = useAppTranslation();
  const warehousesQuery = useWarehouses();
  const treasuryQuery = useTreasuryAccounts();
  const warehouseCount = (warehousesQuery.data ?? []).filter((w) => w.branchId === branch.id).length;
  const treasuryAccounts = (treasuryQuery.data ?? []).filter((a) => a.branchId === branch.id);

  return (
    <DocumentDetail
      title={`${branch.name} · ${branch.code}`}
      statusLabel={branch.active ? t("common.active") : t("common.inactive")}
      statusTone={branch.active ? "success" : "neutral"}
      subtitle={branch.isMain ? t("branches.headBranch") : t("branches.subBranch")}
      actions={<Button onClick={onBack}>{t("branches.backToTheBranchList")}</Button>}
      summary={[
        { label: t("branches.branchCode"), value: branch.code },
        { label: t("common.phone"), value: branch.phone ?? t("common.none") },
        { label: t("common.email"), value: branch.email ?? t("common.none") },
        { label: t("branches.address"), value: branch.address ?? t("common.none") },
        { label: t("branches.warehouses2"), value: <span className="mz-num">{warehouseCount}</span> },
        { label: t("common.status"), value: branch.active ? t("common.active") : t("common.inactive"), valueTone: branch.active ? "success" : "default" },
      ]}
      tabs={[
        {
          key: "overview",
          label: t("common.overview"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <div>
                <h3 className="mb-[12px] font-display text-[14.5px] font-bold text-ink">{t("branches.branchFigures")}</h3>
                <BranchKpis branch={branch} />
              </div>
              <SectionCard title={t("branches.treasuryAccounts")}>
                <div className="col-span-full overflow-x-auto">
                  {treasuryAccounts.length === 0 ? (
                    <p className="p-[8px] text-[12.5px] text-ink-muted">{t("branches.noTreasuryAccountsAreLinked")}</p>
                  ) : (
                    <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
                      <thead>
                        <tr className="border-b border-border text-ink-muted">
                          <th className="p-[8px] text-start font-semibold">{t("branches.account")}</th>
                          <th className="p-[8px] text-start font-semibold">{t("common.code")}</th>
                          <th className="p-[8px] text-start font-semibold">{t("common.type")}</th>
                          <th className="p-[8px] text-end font-semibold">{t("branches.openingBalance")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {treasuryAccounts.map((acc) => (
                          <tr key={acc.id} className="border-b border-border last:border-b-0">
                            <td className="p-[8px] text-ink">{acc.name}</td>
                            <td className="mz-num p-[8px] text-ink-muted">{acc.code}</td>
                            <td className="p-[8px] text-ink-muted">{t(TREASURY_TYPE_KEY[acc.type])}</td>
                            <td className="mz-num p-[8px] text-end text-ink">{acc.openingBalance}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </SectionCard>
            </div>
          ),
        },
        { key: "inventory", label: t("branches.stock"), content: <BranchInventoryTab branch={branch} /> },
        { key: "employees", label: t("branches.employees"), content: <BranchEmployeesTab branch={branch} /> },
        { key: "assets", label: t("branches.assets2"), content: <BranchAssetsTab branch={branch} /> },
        { key: "activity", label: t("branches.activity"), content: <BranchActivityTab branch={branch} /> },
      ]}
    />
  );
}

export function BranchesPage() {
  const { t } = useAppTranslation();
  const query = useBranches();
  const createBranchMutation = useCreateBranch();
  const branches = query.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", phone: "", email: "", address: "", isMain: false });

  const selected = branches.find((b) => b.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    if (search.trim() === "") return branches;
    const q = search.trim();
    return branches.filter((b) => b.name.includes(q) || b.code.toLowerCase().includes(q.toLowerCase()));
  }, [branches, search]);

  const columns: DocumentListColumn<BranchDTO>[] = [
    { key: "name", header: t("branches.branchName"), render: (b) => <span className="font-semibold text-ink">{b.name}</span> },
    { key: "code", header: t("branches.branchCode2"), render: (b) => <span className="mz-num">{b.code}</span> },
    { key: "parent", header: t("branches.headBranch"), render: (b) => (b.isMain ? "—" : branchName(b.parentBranchId ?? "", branches)) },
    { key: "phone", header: t("common.phone"), render: (b) => b.phone ?? "—" },
    {
      key: "status",
      header: t("common.status"),
      render: (b) => <StatusPill label={b.active ? t("common.active") : t("common.inactive")} tone={(b.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  async function submitNewBranch() {
    setError(null);
    try {
      await createBranchMutation.mutateAsync({
        id: crypto.randomUUID(),
        code: form.code.toUpperCase(),
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        isMain: form.isMain,
      });
      setPanelOpen(false);
      setForm({ code: "", name: "", phone: "", email: "", address: "", isMain: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("branches.couldNotCreateTheBranch"));
    }
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("branches.couldNotLoadTheBranches")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  if (selected) {
    return <BranchDetail branch={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <>
      <DocumentList<BranchDTO>
        eyebrow="Settings · Branches"
        title={t("branches.branches")}
        description={t("branches.manageTheCompanySBranches")}
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            {t("branches.addABranch")}
          </Button>
        }
        stats={[
          { label: t("branches.totalBranches"), value: <span className="mz-num">{branches.length}</span> },
          { label: t("branches.headBranch"), value: <span className="mz-num">{branches.filter((b) => b.isMain).length}</span> },
          { label: t("common.active"), value: <span className="mz-num">{branches.filter((b) => b.active).length}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("branches.searchByBranchNameOr")}
        columns={columns}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={(b) => setSelectedId(b.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{branches.length}</span> {t("branches.branch")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("branches.noMatchingBranches")}</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t("branches.addABranch")} description={t("branches.coreBranchDetails")}>
        <div className="flex flex-col gap-[14px]">
          {error ? <StatusPill label={error} tone="danger" /> : null}
          <TextField label={t("branches.branchName")} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <TextField label={t("branches.branchCode2")} value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} placeholder="ALEX" />
          <TextField label={t("common.phone")} type="tel" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
          <TextField label={t("common.email")} type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
          <TextField label={t("branches.address")} value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
          <ToggleField label={t("branches.headBranch2")} checked={form.isMain} onChange={(v) => setForm((f) => ({ ...f, isMain: v }))} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={submitNewBranch}>
              {t("branches.saveTheBranch")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
