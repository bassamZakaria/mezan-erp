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

const TREASURY_TYPE_LABEL: Record<TreasuryAccountDTO["type"], string> = { cash: "نقدي", bank: "بنكي" };

const ASSET_STATUS_LABEL: Record<AssetStatusDTO, string> = {
  active: "نشط",
  under_maintenance: "تحت الصيانة",
  fully_depreciated: "مستهلك بالكامل",
  disposed: "مستبعد",
};

const ASSET_STATUS_TONE: Record<AssetStatusDTO, PillTone> = {
  active: "success",
  under_maintenance: "info",
  fully_depreciated: "warning",
  disposed: "neutral",
};

const EMPLOYEE_STATUS_LABEL: Record<EmployeeDTO["status"], string> = {
  active: "على رأس العمل",
  on_leave: "في إجازة",
  suspended: "موقوف",
  terminated: "منتهية خدمته",
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
  return (
    <Card className="p-[18px_20px]">
      <p className="text-[13px] font-semibold text-danger-ink">{message}</p>
      <Button size="sm" className="mt-[10px]" onClick={onRetry}>
        إعادة المحاولة
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
        label="مبيعات الفرع (فواتير سارية)"
        value={<MoneyValue value={moneyToNumber(salesTotal)} showUnit={false} />}
        sub={<span className="mz-num">{salesInvoices.length} فاتورة</span>}
      />
      <Kpi
        label="مشتريات الفرع (فواتير مؤكدة)"
        value={<MoneyValue value={moneyToNumber(purchasesTotal)} showUnit={false} />}
        sub={<span className="mz-num">{purchaseInvoices.length} فاتورة</span>}
      />
      <Kpi
        label="صافي حركة السندات"
        value={<MoneyValue value={moneyToNumber(voucherNet)} showUnit={false} />}
        sub={<span className="mz-num">{vouchers.length} سند</span>}
      />
      <Kpi
        label="قيمة المخزون"
        value={
          warehouseIds.length === 0 ? (
            <span className="text-[12.5px] font-normal text-ink-muted">لا توجد مستودعات</span>
          ) : (
            <MoneyValue value={moneyToNumber(stockValue)} showUnit={false} />
          )
        }
        sub={<span className="mz-num">{warehouseIds.length} مستودع</span>}
      />
      <Kpi
        label="حسابات الخزينة"
        value={<span className="mz-num">{treasuryAccounts.length}</span>}
        sub={<span className="mz-num">{treasuryAccounts.filter((a) => a.type === "bank").length} بنكي</span>}
      />
      <Kpi
        label="الموظفون"
        value={<span className="mz-num">{employees.length}</span>}
        sub={<span className="mz-num">{employees.filter((e) => e.status === "active").length} على رأس العمل</span>}
      />
      <Kpi
        label="الأصول الثابتة"
        value={<span className="mz-num">{assets.length}</span>}
        sub={<MoneyValue value={moneyToNumber(assetsCost)} showUnit={false} />}
      />
      <Kpi label="حالة الفرع" value={branch.active ? "نشط" : "غير نشط"} sub={branch.isMain ? "الفرع الرئيسي" : "فرع فرعي"} />
    </div>
  );
}

/** مخزون الفرع — the merged `/inventory/stock-balance` of every warehouse in the branch. */
function BranchInventoryTab({ branch }: { branch: BranchDTO }) {
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

  if (warehousesQuery.isError) return <TabError message="تعذّر تحميل مستودعات الفرع." onRetry={() => warehousesQuery.refetch()} />;
  if (warehouses.length === 0) {
    return (
      <EmptyTab
        title="لا توجد مستودعات مرتبطة بهذا الفرع"
        body="رصيد المخزون يُحتسب من مستودعات الفرع. اربط مستودعاً بهذا الفرع من شاشة «المستودعات» ليظهر رصيده هنا."
      />
    );
  }
  if (stockQuery.isError) return <TabError message="تعذّر تحميل رصيد مخزون الفرع." onRetry={() => stockQuery.refetch()} />;
  if (stockQuery.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">جارِ تحميل رصيد المخزون…</p>;

  const rows = [...(stockQuery.data ?? [])].sort((a, b) => {
    const left = parseMoney(a.totalValue);
    const right = parseMoney(b.totalValue);
    return right === left ? a.itemId.localeCompare(b.itemId) : right > left ? 1 : -1;
  });
  if (rows.length === 0) {
    return (
      <EmptyTab
        title="لا يوجد رصيد مخزون في مستودعات هذا الفرع"
        body={`مستودعات الفرع (${warehouses.map((w) => w.name).join("، ")}) لم تستلم أي بضاعة بعد، أو صُرف كل ما بها.`}
      />
    );
  }

  const totalValue = sumMoney(rows.map((row) => row.totalValue));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3">
        <Kpi label="عدد الأصناف" value={<span className="mz-num">{rows.length}</span>} />
        <Kpi label="عدد المستودعات" value={<span className="mz-num">{warehouses.length}</span>} />
        <Kpi label="إجمالي قيمة المخزون" value={<MoneyValue value={moneyToNumber(totalValue)} showUnit={false} />} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">الصنف</th>
              <th className="p-[10px] text-start font-semibold">الكود</th>
              <th className="p-[10px] text-end font-semibold">الكمية</th>
              <th className="p-[10px] text-end font-semibold">متوسط التكلفة</th>
              <th className="p-[10px] text-end font-semibold">القيمة</th>
              <th className="p-[10px] text-end font-semibold">عدد المستودعات</th>
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
  const query = useEmployees();
  const employees = useMemo(
    () => (query.data ?? []).filter((e) => e.branchId === branch.id).sort((a, b) => a.code.localeCompare(b.code)),
    [query.data, branch.id],
  );

  if (query.isError) return <TabError message="تعذّر تحميل موظفي الفرع." onRetry={() => query.refetch()} />;
  if (query.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">جارِ تحميل الموظفين…</p>;
  if (employees.length === 0) {
    return (
      <EmptyTab
        title="لا يوجد موظفون مسجّلون على هذا الفرع"
        body="كل موظف يُسجَّل على فرع واحد. أضف موظفاً واختر هذا الفرع من شاشة «الموظفون» ليظهر هنا."
      />
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3">
        <Kpi label="إجمالي الموظفين" value={<span className="mz-num">{employees.length}</span>} />
        <Kpi label="على رأس العمل" value={<span className="mz-num">{employees.filter((e) => e.status === "active").length}</span>} />
        <Kpi label="دوام كامل" value={<span className="mz-num">{employees.filter((e) => e.employmentType === "full_time").length}</span>} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">الكود</th>
              <th className="p-[10px] text-start font-semibold">الاسم</th>
              <th className="p-[10px] text-start font-semibold">الهاتف</th>
              <th className="p-[10px] text-start font-semibold">تاريخ التعيين</th>
              <th className="p-[10px] text-start font-semibold">نوع التوظيف</th>
              <th className="p-[10px] text-start font-semibold">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id} className="border-b border-border last:border-b-0">
                <td className="mz-num p-[10px] text-ink-muted">{employee.code}</td>
                <td className="p-[10px] font-semibold text-ink">{employeeName(employee)}</td>
                <td className="mz-num p-[10px] text-ink-muted">{employee.phone ?? "—"}</td>
                <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(employee.hireDate)}</td>
                <td className="p-[10px] text-ink-muted">{employee.employmentType === "full_time" ? "دوام كامل" : "دوام جزئي"}</td>
                <td className="p-[10px]">
                  <StatusPill label={EMPLOYEE_STATUS_LABEL[employee.status]} tone={EMPLOYEE_STATUS_TONE[employee.status]} />
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

  if (query.isError) return <TabError message="تعذّر تحميل أصول الفرع." onRetry={() => query.refetch()} />;
  if (query.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">جارِ تحميل الأصول…</p>;
  if (assets.length === 0) {
    return (
      <EmptyTab
        title="لا توجد أصول ثابتة مسجّلة على هذا الفرع"
        body="الأصل يُسجَّل إما على مستوى المنشأة أو على فرع بعينه. الأصول المسجّلة على مستوى المنشأة لا تظهر هنا — راجعها من شاشة «سجل الأصول»."
      />
    );
  }

  const cost = sumMoney(assets.map((a) => a.acquisitionCost));
  const accumulated = sumMoney(assets.map((a) => a.accumulatedDepreciation));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3">
        <Kpi label="عدد الأصول" value={<span className="mz-num">{assets.length}</span>} />
        <Kpi label="إجمالي التكلفة" value={<MoneyValue value={moneyToNumber(cost)} showUnit={false} />} />
        <Kpi label="صافي القيمة الدفترية" value={<MoneyValue value={moneyToNumber(cost - accumulated)} showUnit={false} />} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">الكود</th>
              <th className="p-[10px] text-start font-semibold">الأصل</th>
              <th className="p-[10px] text-start font-semibold">الفئة</th>
              <th className="p-[10px] text-start font-semibold">تاريخ الاقتناء</th>
              <th className="p-[10px] text-end font-semibold">التكلفة</th>
              <th className="p-[10px] text-end font-semibold">مجمع الإهلاك</th>
              <th className="p-[10px] text-end font-semibold">صافي القيمة</th>
              <th className="p-[10px] text-start font-semibold">الحالة</th>
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
                  <StatusPill label={ASSET_STATUS_LABEL[asset.status]} tone={ASSET_STATUS_TONE[asset.status]} />
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
        kind: "فاتورة مبيعات",
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
        kind: "فاتورة مشتريات",
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
        kind: voucher.direction === "receipt" ? "سند قبض" : voucher.direction === "payment" ? "سند صرف" : "تحويل بين الخزائن",
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
        message="تعذّر تحميل نشاط الفرع."
        onRetry={() => {
          salesQuery.refetch();
          purchasesQuery.refetch();
          vouchersQuery.refetch();
        }}
      />
    );
  }
  if (salesQuery.isLoading || purchasesQuery.isLoading || vouchersQuery.isLoading) {
    return <p className="p-[18px] text-[12.5px] text-ink-muted">جارِ تحميل النشاط…</p>;
  }
  if (rows.length === 0) {
    return (
      <EmptyTab
        title="لا توجد حركة مسجّلة على هذا الفرع"
        body="النشاط يُبنى من مستندات الفرع نفسها — فواتير المبيعات والمشتريات والسندات النقدية المسجّلة عليه. لم يُسجَّل أي منها بعد."
      />
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">التاريخ</th>
              <th className="p-[10px] text-start font-semibold">النوع</th>
              <th className="p-[10px] text-start font-semibold">المستند</th>
              <th className="p-[10px] text-start font-semibold">البيان</th>
              <th className="p-[10px] text-end font-semibold">المبلغ</th>
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
        يعرض هذا التبويب مستندات الفرع نفسها. سجل التدقيق لا يحمل بُعد الفرع، لذلك لا يمكن قصره على فرع بعينه — راجعه كاملاً من شاشة «سجل
        التدقيق».
      </p>
    </div>
  );
}

function BranchDetail({ branch, onBack }: { branch: BranchDTO; onBack: () => void }) {
  const warehousesQuery = useWarehouses();
  const treasuryQuery = useTreasuryAccounts();
  const warehouseCount = (warehousesQuery.data ?? []).filter((w) => w.branchId === branch.id).length;
  const treasuryAccounts = (treasuryQuery.data ?? []).filter((a) => a.branchId === branch.id);

  return (
    <DocumentDetail
      title={`${branch.name} · ${branch.code}`}
      statusLabel={branch.active ? "نشط" : "غير نشط"}
      statusTone={branch.active ? "success" : "neutral"}
      subtitle={branch.isMain ? "الفرع الرئيسي" : "فرع فرعي"}
      actions={<Button onClick={onBack}>رجوع لقائمة الفروع</Button>}
      summary={[
        { label: "كود الفرع", value: branch.code },
        { label: "الهاتف", value: branch.phone ?? "لا توجد" },
        { label: "البريد الإلكتروني", value: branch.email ?? "لا توجد" },
        { label: "العنوان", value: branch.address ?? "لا توجد" },
        { label: "المستودعات", value: <span className="mz-num">{warehouseCount}</span> },
        { label: "الحالة", value: branch.active ? "نشط" : "غير نشط", valueTone: branch.active ? "success" : "default" },
      ]}
      tabs={[
        {
          key: "overview",
          label: "نظرة عامة",
          content: (
            <div className="flex flex-col gap-[16px]">
              <div>
                <h3 className="mb-[12px] font-display text-[14.5px] font-bold text-ink">مؤشرات الفرع</h3>
                <BranchKpis branch={branch} />
              </div>
              <SectionCard title="حسابات الخزينة">
                <div className="col-span-full overflow-x-auto">
                  {treasuryAccounts.length === 0 ? (
                    <p className="p-[8px] text-[12.5px] text-ink-muted">لا توجد حسابات خزينة مرتبطة بهذا الفرع</p>
                  ) : (
                    <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
                      <thead>
                        <tr className="border-b border-border text-ink-muted">
                          <th className="p-[8px] text-start font-semibold">الحساب</th>
                          <th className="p-[8px] text-start font-semibold">الكود</th>
                          <th className="p-[8px] text-start font-semibold">النوع</th>
                          <th className="p-[8px] text-end font-semibold">الرصيد الافتتاحي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {treasuryAccounts.map((acc) => (
                          <tr key={acc.id} className="border-b border-border last:border-b-0">
                            <td className="p-[8px] text-ink">{acc.name}</td>
                            <td className="mz-num p-[8px] text-ink-muted">{acc.code}</td>
                            <td className="p-[8px] text-ink-muted">{TREASURY_TYPE_LABEL[acc.type]}</td>
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
        { key: "inventory", label: "المخزون", content: <BranchInventoryTab branch={branch} /> },
        { key: "employees", label: "الموظفون", content: <BranchEmployeesTab branch={branch} /> },
        { key: "assets", label: "الأصول", content: <BranchAssetsTab branch={branch} /> },
        { key: "activity", label: "النشاط", content: <BranchActivityTab branch={branch} /> },
      ]}
    />
  );
}

export function BranchesPage() {
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
    { key: "name", header: "اسم الفرع", render: (b) => <span className="font-semibold text-ink">{b.name}</span> },
    { key: "code", header: "رمز الفرع", render: (b) => <span className="mz-num">{b.code}</span> },
    { key: "parent", header: "الفرع الرئيسي", render: (b) => (b.isMain ? "—" : branchName(b.parentBranchId ?? "", branches)) },
    { key: "phone", header: "الهاتف", render: (b) => b.phone ?? "—" },
    {
      key: "status",
      header: "الحالة",
      render: (b) => <StatusPill label={b.active ? "نشط" : "غير نشط"} tone={(b.active ? "success" : "neutral") as PillTone} />,
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
      setError(err instanceof Error ? err.message : "تعذر إنشاء الفرع");
    }
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الفروع.</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          إعادة المحاولة
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
        title="الفروع"
        description="إدارة فروع المنشأة — لكل فرع مخزونه وحساباته الخزينة وموظفوه الخاصون"
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            إضافة فرع
          </Button>
        }
        stats={[
          { label: "إجمالي الفروع", value: <span className="mz-num">{branches.length}</span> },
          { label: "الفرع الرئيسي", value: <span className="mz-num">{branches.filter((b) => b.isMain).length}</span> },
          { label: "نشط", value: <span className="mz-num">{branches.filter((b) => b.active).length}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث باسم الفرع أو الرمز…"
        columns={columns}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={(b) => setSelectedId(b.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{branches.length}</span> فرع
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد فروع مطابقة</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="إضافة فرع" description="بيانات الفرع الأساسية">
        <div className="flex flex-col gap-[14px]">
          {error ? <StatusPill label={error} tone="danger" /> : null}
          <TextField label="اسم الفرع" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <TextField label="رمز الفرع" value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} placeholder="ALEX" />
          <TextField label="الهاتف" type="tel" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
          <TextField label="البريد الإلكتروني" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
          <TextField label="العنوان" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
          <ToggleField label="فرع رئيسي" checked={form.isMain} onChange={(v) => setForm((f) => ({ ...f, isMain: v }))} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
            <Button variant="primary" onClick={submitNewBranch}>
              حفظ الفرع
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
