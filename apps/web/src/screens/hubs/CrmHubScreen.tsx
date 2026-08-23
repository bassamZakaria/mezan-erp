import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import { useCrmActivities, useLeads, useOpportunities } from "../../data/hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";

/**
 * إدارة علاقات العملاء hub — leads, opportunities and activities over the
 * real `/crm/*` endpoints already wired in `data/hooks.ts`.
 */

const ACTIVITY_TYPE_LABEL: Record<string, string> = { call: "مكالمة", meeting: "اجتماع", todo: "مهمة", email: "بريد" };

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

const quickActions: { label: string; screen: ScreenKey }[] = [
  { label: "عميل محتمل جديد", screen: "leads" },
  { label: "فرصة جديدة", screen: "opportunities" },
  { label: "خط المبيعات", screen: "pipeline" },
  { label: "نشاط جديد", screen: "crm-activities" },
];

export function CrmHubScreen() {
  const { navigate } = useNavigation();
  const leadsQuery = useLeads();
  const opportunitiesQuery = useOpportunities();
  const activitiesQuery = useCrmActivities();

  const leads = leadsQuery.data ?? [];
  const opportunities = opportunitiesQuery.data ?? [];
  const activities = activitiesQuery.data ?? [];

  const newLeads = useMemo(() => leads.filter((l) => l.status === "new").length, [leads]);
  const openOpportunities = useMemo(() => opportunities.filter((o) => o.status === "open"), [opportunities]);
  const openPipelineValue = useMemo(() => openOpportunities.reduce((sum, o) => sum + num(o.expectedValue), 0), [openOpportunities]);
  const pendingActivities = useMemo(() => activities.filter((a) => a.status === "pending").length, [activities]);
  const recentActivities = useMemo(
    () => [...activities].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5),
    [activities],
  );

  const isLoading = leadsQuery.isLoading || opportunitiesQuery.isLoading || activitiesQuery.isLoading;
  const isError = leadsQuery.isError || opportunitiesQuery.isError || activitiesQuery.isError;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">CRM</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">إدارة علاقات العملاء</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">العملاء المحتملون والفرص والأنشطة</p>
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات إدارة علاقات العملاء.</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="عملاء محتملون جدد" value={isLoading ? "—" : newLeads} sub={`من ${leads.length} عميل محتمل`} />
        <StatCard label="الفرص المفتوحة" value={isLoading ? "—" : openOpportunities.length} sub="قيد المتابعة" />
        <StatCard label="القيمة المتوقعة للفرص المفتوحة" value={<Money value={openPipelineValue} />} sub="إجمالي الفرص المفتوحة" />
        <StatCard label="أنشطة قيد الانتظار" value={isLoading ? "—" : pendingActivities} sub="مكالمات واجتماعات ومهام" />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">أحدث الأنشطة</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">آخر 5 أنشطة مسجّلة</div>
        {recentActivities.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {recentActivities.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="text-[12.5px] text-ink">{a.subject}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">
                    {ACTIVITY_TYPE_LABEL[a.type] ?? a.type}
                    {a.dueDate ? <span className="mz-num"> · {a.dueDate}</span> : null}
                  </div>
                </div>
                <span className="text-[11.5px] font-semibold text-ink-faint">
                  {a.status === "pending" ? "قيد الانتظار" : a.status === "completed" ? "منجزة" : "ملغاة"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">لا توجد أنشطة بعد — ستظهر هنا فور تسجيل أول نشاط.</p>
        )}
      </Card>
    </div>
  );
}
