import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import { useCheques, useDashboardSummary, useTreasuryAccounts, useVouchers } from "../../data/hooks";
import { useNavigate } from "../../navigation";

/**
 * الخزينة hub — treasury accounts + vouchers + cheques over the real
 * `/treasury-accounts`, `/vouchers`, `/cheques` endpoints, plus the cash
 * figure reused from `/dashboard/summary` (same GL-derived value shown on
 * the main dashboard — real, not re-derived client-side).
 */

const PENDING_CHEQUE_STATUSES = new Set(["pending", "deposited"]);

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

const quickActions: { label: string; screen: string }[] = [
  { label: "سند نقدي جديد", screen: "treasury-vouchers" },
  { label: "حسابات الخزينة", screen: "treasury-accounts" },
  { label: "تسوية كشف بنك", screen: "bank-reconciliation" },
  { label: "سجل الشيكات", screen: "cheques" },
];

export function TreasuryHubScreen() {
  const navigate = useNavigate();
  const accountsQuery = useTreasuryAccounts();
  const vouchersQuery = useVouchers();
  const chequesQuery = useCheques();
  const summaryQuery = useDashboardSummary({});

  const accounts = accountsQuery.data ?? [];
  const vouchers = vouchersQuery.data ?? [];
  const cheques = chequesQuery.data ?? [];
  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === "active").length, [accounts]);
  const pendingCheques = useMemo(() => cheques.filter((c) => PENDING_CHEQUE_STATUSES.has(c.status)).length, [cheques]);
  const recentVouchers = useMemo(() => [...vouchers].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5), [vouchers]);
  const cash = num(summaryQuery.data?.gl.cash);

  const isLoading = accountsQuery.isLoading || vouchersQuery.isLoading || chequesQuery.isLoading || summaryQuery.isLoading;
  const isError = accountsQuery.isError || vouchersQuery.isError || chequesQuery.isError || summaryQuery.isError;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">Treasury</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">الخزينة</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">الصناديق والبنوك والسندات النقدية والشيكات</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات الخزينة.</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="حسابات خزينة نشطة" value={isLoading ? "—" : activeAccounts} sub={`من ${accounts.length} حساب`} />
        <StatCard label="السيولة النقدية" value={<Money value={cash} />} sub="أرصدة الصناديق والبنوك" />
        <StatCard label="السندات المسجّلة" value={isLoading ? "—" : vouchers.length} sub="إجمالي السندات" />
        <StatCard label="شيكات قيد التحصيل" value={isLoading ? "—" : pendingCheques} sub="بانتظار الإيداع أو التحصيل" />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">أحدث السندات</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">آخر 5 سندات مسجّلة</div>
        {recentVouchers.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {recentVouchers.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="text-[12.5px] text-ink">{v.memo || v.docNo || v.id}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">
                    <span className="mz-num">{v.date}</span>
                    {v.docNo ? <span className="mz-lat"> · {v.docNo}</span> : null}
                  </div>
                </div>
                <Money value={num(v.amount)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">لا توجد سندات بعد — ستظهر هنا فور تسجيل أول سند.</p>
        )}
      </Card>
    </div>
  );
}
