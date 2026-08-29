import { useMemo } from "react";
import { Money, WorkspaceHub } from "@mezan/ui";
import { useCrmActivities, useLeads, useOpportunities } from "../../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";
import { EMPTY } from "../../lib/empty";

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

/**
 * Verbs only. A row of buttons that navigate to the same screens the bar one
 * pixel above already lists is a second copy of the navigation, not an action —
 * and each of these now opens the create flow rather than landing on the list.
 */
const quickActions: HubAction[] = [
  { label: "crmHub.newLead", screen: "leads" },
  { label: "crmHub.newOpportunity", screen: "opportunities" },
  { label: "crmHub.newActivity", screen: "crm-activities" },
];

export function CrmHubScreen() {
  const { t } = useAppTranslation();
  const leadsQuery = useLeads();
  const opportunitiesQuery = useOpportunities();
  const activitiesQuery = useCrmActivities();

  const leads = leadsQuery.data ?? EMPTY;
  const opportunities = opportunitiesQuery.data ?? EMPTY;
  const activities = activitiesQuery.data ?? EMPTY;

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
    <WorkspaceHub
      title={t("crmHub.customerRelationships")}
      description={t("crmHub.leadsOpportunitiesAndActivities")}
      loading={isLoading}
      error={isError ? t("crmHub.crmDataCouldNotBe") : null}
      actions={<HubActions actions={quickActions} />}
      stats={[
        { key: "leads", label: t("crmHub.newLeads"), value: newLeads, sub: t("crmHub.ofLeads", { count: leads.length }) },
        { key: "open", label: t("crmHub.openOpportunities"), value: openOpportunities.length, sub: t("crmHub.beingFollowedUp") },
        { key: "pipeline", label: t("crmHub.expectedValueOfOpenOpportunities"), value: <Money value={openPipelineValue} />, sub: t("crmHub.allOpenOpportunities") },
        { key: "activities", label: t("crmHub.activitiesPending"), value: pendingActivities, sub: t("crmHub.callsMeetingsAndTasks") },
      ]}
      list={{
        title: t("crmHub.latestActivities"),
        sub: t("crmHub.theLast5ActivitiesRecorded"),
        empty: t("crmHub.noActivitiesYetTheFirst"),
        rows: recentActivities.map((a) => ({
          key: a.id,
          primary: a.subject,
          secondary: (
            <>
              {activityTypeLabel(a.type, t) ?? a.type}
              {a.dueDate ? <span className="mz-num"> · {a.dueDate}</span> : null}
            </>
          ),
          trailing: (
            <span className="text-2xs font-semibold text-ink-faint">
              {a.status === "pending" ? t("crmHub.pending") : a.status === "completed" ? t("crmHub.done") : t("crmHub.cancelled")}
            </span>
          ),
        })),
      }}
    />
  );
}
