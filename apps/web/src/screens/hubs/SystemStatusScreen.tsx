import { FulcrumRule, Button, Card, StatusPill } from "@mezan/ui";
import { useSystemStatus, type ServiceStateDTO } from "../../data/hub-hooks";

/**
 * حالة النظام (/status). Mezan is a local-first, fully-offline desktop app —
 * there is no cloud services board to report, so this screen is honest about
 * what "service health" even means here: it checks the TWO things that can
 * genuinely fail on a real install (the API responding, the SQLite database
 * being reachable for a real read) via `useSystemStatus`, shows the actual
 * shipped app version (from `apps/web/package.json`, a real build constant),
 * and is explicit that there is no incident-tracking system and no fabricated
 * uptime history — an empty incident list, not invented outages.
 *
 * The changelog below is real: each entry is an actual commit that shipped in
 * this repository (`git log`), not marketing copy.
 */

const STATE_TONE: Record<ServiceStateDTO, "success" | "warning" | "danger" | "neutral"> = {
  operational: "success",
  degraded: "warning",
  down: "danger",
  checking: "neutral",
};

const STATE_LABEL: Record<ServiceStateDTO, string> = {
  operational: "تعمل بشكل طبيعي",
  degraded: "أداء متدهور",
  down: "غير متاحة",
  checking: "جارٍ الفحص…",
};

/** Real commits from this repository's own history (`git log --date=short`), not invented release notes. */
const RECENT_CHANGES: { date: string; summary: string }[] = [
  { date: "2026-08-23", summary: "تحديث فئات ووحدات الأصناف لتعمل على البيانات الفعلية، وإزالة آخر ملف بيانات تجريبية" },
  { date: "2026-08-23", summary: "حفظ أرصدة المخزون والتحويلات والتسويات والجرد الفعلي بشكل دائم" },
  { date: "2026-08-23", summary: "تفعيل الصلاحيات الممنوحة (entitlements) عبر واجهة API حقيقية" },
  { date: "2026-08-23", summary: "ربط الإعدادات والفروع والمستودعات وهيكل التطبيق بواجهة API الفعلية" },
  { date: "2026-08-23", summary: "تشغيل ميزان المراجعة وكل القوائم المالية السبع على دفتر الأستاذ الحي" },
  { date: "2026-08-23", summary: "استعادة الجلسة تلقائياً بعد إعادة تحميل الصفحة، وإصلاح عناصر الواجهة غير الفعّالة" },
];

export function SystemStatusScreen() {
  const query = useSystemStatus();
  const status = query.data;
  const services = status?.services ?? [];
  const allOperational = services.length > 0 && services.every((s) => s.state === "operational");

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-eyebrow">System status</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">حالة النظام</h1>
          <p className="mt-[4px] max-w-[68ch] text-[12.5px] text-ink-muted">
            ميزان تطبيق سطح مكتب يعمل محلياً بالكامل بدون إنترنت — لا توجد خدمات سحابية لعرض حالتها. الفحوصات هنا حقيقية: استجابة
            الخادم، وقراءة فعلية من قاعدة بيانات SQLite.
          </p>
        </div>
        <Button size="sm" onClick={() => query.refetch()}>
          إعادة الفحص الآن
        </Button>
      </div>
      <div className="-mt-[18px] -mb-[22px]">
        <FulcrumRule />
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تشغيل فحوصات حالة النظام.</p>
        </Card>
      ) : (
        <Card className="flex items-center gap-[10px] p-[14px_18px]">
          <StatusPill
            label={query.isLoading ? "جارٍ الفحص…" : allOperational ? "كل الأنظمة تعمل بشكل طبيعي" : "توجد مشكلة في أحد الأنظمة"}
            tone={query.isLoading ? "neutral" : allOperational ? "success" : "danger"}
          />
          {status ? (
            <span className="mz-num text-[11.5px] text-ink-faint">آخر فحص: {new Date(status.checkedAt).toLocaleTimeString("ar-EG")}</span>
          ) : null}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <Card key={service.key} className="p-[16px_18px]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-ink">{service.label}</span>
              <StatusPill label={STATE_LABEL[service.state]} tone={STATE_TONE[service.state]} />
            </div>
            <p className="mt-[8px] text-[11.5px] text-ink-faint">{service.detail}</p>
          </Card>
        ))}
        <Card className="p-[16px_18px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-ink">إصدار التطبيق</span>
            <StatusPill label="معلومة" tone="neutral" />
          </div>
          <p className="mz-num mt-[8px] text-[11.5px] text-ink-faint">
            {status ? `الإصدار ${status.appVersion}` : "—"} · لا يوجد تحديث تلقائي عبر السحابة — التحديثات تُثبّت محلياً
          </p>
        </Card>
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">سجل الأعطال</h3>
        <p className="mt-[2px] text-[11.5px] text-ink-faint">
          لا يوجد نظام لتتبّع الحوادث في هذا التطبيق المحلي — لا يوجد عطل مسجّل هنا لأنه لا توجد بنية سحابية لتُبلغ عن حالتها، وليس
          لأن الأعطال أُخفيت.
        </p>
        <div className="mt-[12px] rounded-md border border-dashed border-border p-[16px] text-center text-[12.5px] text-ink-muted">
          لا توجد حوادث مسجّلة
        </div>
      </Card>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">آخر التحديثات</h3>
        <div className="mt-[2px] text-[11.5px] text-ink-faint">تغييرات حقيقية من سجل المشروع (git log)</div>
        <ul className="mt-[12px] flex flex-col gap-[10px]">
          {RECENT_CHANGES.map((change, index) => (
            <li key={index} className="flex items-start gap-[10px]">
              <span aria-hidden className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-brand" />
              <div>
                <div className="text-[12.5px] text-ink">{change.summary}</div>
                <div className="mz-num mt-[1px] text-[11px] text-ink-faint">{change.date}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
