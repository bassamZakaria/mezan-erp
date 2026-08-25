import { useMemo } from "react";
import { FulcrumRule, Button, Card, Money, StatCard } from "@mezan/ui";
import { useCrmActivities, useLeads, useOpportunities } from "../../data/hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * إدارة علاقات العملاء hub — leads, opportunities and activities over the
 * real `/crm/*` endpoints already wired in `data/hooks.ts`.
 */

/** An unknown activity type shows its own code rather than a humanized key. */
function activityTypeLabel(type: string, t: (key: AppTranslationKey) => string): string {
  const key = ACTIVITY_TYPE_KEY[type];
  return key ? t(key) : type;
}

const ACTIVITY_TYPE_KEY: Record<string, AppTranslationKey> = {
  call: "crmHub.activityType.call",
  meeting: "crmHub.activityType.meeting",
  todo: "crmHub.activityType.todo",
  email: "crmHub.activityType.email",
};

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

const quickActions: { label: AppTranslationKey; screen: ScreenKey }[] = [
  { label: "crmHub.newLead", screen: "leads" },
  { label: "crmHub.newOpportunity", screen: "opportunities" },
  { label: "crmHub.pipeline", screen: "pipeline" },
  { label: "crmHub.newActivity", screen: "crm-activities" },
];

export function CrmHubScreen() {
  const { t } = useAppTranslation();
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
          <div className="mz-eyebrow">CRM</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("crmHub.customerRelationships")}</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("crmHub.leadsOpportunitiesAndActivities")}</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {t(action.label)}
            </Button>
          ))}
        </div>
      </div>
      <div className="-mt-[18px] -mb-[22px]">
        <FulcrumRule />
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("crmHub.crmDataCouldNotBe")}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("crmHub.newLeads")} value={isLoading ? "—" : newLeads} sub={t("crmHub.ofLeads", { count: leads.length })} />
        <StatCard label={t("crmHub.openOpportunities")} value={isLoading ? "—" : openOpportunities.length} sub={t("crmHub.beingFollowedUp")} />
        <StatCard label={t("crmHub.expectedValueOfOpenOpportunities")} value={<Money value={openPipelineValue} />} sub={t("crmHub.allOpenOpportunities")} />
        <StatCard label={t("crmHub.activitiesPending")} value={isLoading ? "—" : pendingActivities} sub={t("crmHub.callsMeetingsAndTasks")} />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("crmHub.latestActivities")}</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">{t("crmHub.theLast5ActivitiesRecorded")}</div>
        {recentActivities.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {recentActivities.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="text-[12.5px] text-ink">{a.subject}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">
                    {activityTypeLabel(a.type, t) ?? a.type}
                    {a.dueDate ? <span className="mz-num"> · {a.dueDate}</span> : null}
                  </div>
                </div>
                <span className="text-[11.5px] font-semibold text-ink-faint">
                  {a.status === "pending" ? t("crmHub.pending") : a.status === "completed" ? t("crmHub.done") : t("crmHub.cancelled")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("crmHub.noActivitiesYetTheFirst")}</p>
        )}
      </Card>
    </div>
  );
}
