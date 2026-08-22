import { useState } from "react";
import { BrandMark, Button, StatusPill } from "@mezan/ui";
import { useBootstrapSeed, useCreateFirstAdmin } from "../data/hooks";
import { demoTenantName, seedTasks } from "./login-sample-data";

const STEPS = [
  { key: "activate", label: "تفعيل الترخيص" },
  { key: "admin", label: "حساب المسؤول" },
  { key: "seed", label: "البيانات الأساسية" },
  { key: "import", label: "الاستيراد" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export interface FirstRunWizardProps {
  onFinish: () => void;
  onCancel: () => void;
}

function StepIndicator({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="flex items-center gap-[8px]">
      {STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isActive = index === currentIndex;
        return (
          <li key={step.key} className="flex items-center gap-[8px]">
            <span
              className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                isDone
                  ? "bg-brand text-brand-ink"
                  : isActive
                    ? "border-2 border-brand text-brand"
                    : "border border-border text-ink-faint"
              }`}
              aria-hidden
            >
              {isDone ? "✓" : index + 1}
            </span>
            <span className={`text-[12px] font-semibold ${isActive ? "text-ink" : "text-ink-faint"}`}>{step.label}</span>
            {index < STEPS.length - 1 ? <span aria-hidden className="mx-[4px] h-px w-[20px] bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function StubNote({ children }: { children: string }) {
  return (
    <div className="mt-[10px] flex items-start gap-[8px] rounded-md border border-dashed border-border bg-surface-2 p-[10px_12px] text-[11.5px] text-ink-muted">
      <StatusPill label="تجريبي" tone="info" />
      <span>{children}</span>
    </div>
  );
}

const fieldClass =
  "w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none transition-colors focus:border-brand";

/**
 * First-run wizard skeleton — docs/catalog/09-settings-dashboard-ux.md
 * (نقل البيانات wizard + Dashboard's `GET /api/dashboard/setup` onboarding
 * checklist) plus the Phase-1 task's step sequence: activate license → create
 * admin → seed COA/tax/numbering/branch/warehouse → optional import. Every
 * step action is STUBBED (marked "تجريبي") — no license service, no user
 * persistence, no seeding/import backend is wired yet; this only builds the
 * stepper UX and validation shape those real actions will plug into.
 */
export function FirstRunWizard({ onFinish, onCancel }: FirstRunWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step: StepKey = (STEPS[stepIndex] ?? STEPS[0]).key;

  const seedMutation = useBootstrapSeed();
  const createAdmin = useCreateFirstAdmin();

  const [licenseKey, setLicenseKey] = useState("");
  const [activateStatus, setActivateStatus] = useState<"idle" | "activating" | "done">("idle");

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [adminPinConfirm, setAdminPinConfirm] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminCreated, setAdminCreated] = useState(false);

  const [seedDone, setSeedDone] = useState<Record<string, boolean>>({});

  function handleActivate() {
    setActivateStatus("activating");
    // Stubbed: no license service wired yet (see docs/plan.md §2.5 / packages/domain/src/licensing).
    // Resolves synchronously here purely to drive the demo stepper forward.
    setActivateStatus("done");
  }

  function handleAdminNext() {
    if (!adminName.trim() || !adminEmail.trim()) {
      setAdminError("الاسم الكامل والبريد الإلكتروني مطلوبان.");
      return;
    }
    if (adminPin.length !== 4 || !/^\d{4}$/.test(adminPin)) {
      setAdminError("رمز PIN يجب أن يكون 4 أرقام.");
      return;
    }
    if (adminPin !== adminPinConfirm) {
      setAdminError("رمز PIN وتأكيده غير متطابقين.");
      return;
    }
    setAdminError(null);
    if (adminCreated) {
      goNext();
      return;
    }
    // Persist the admin for real and establish their session, then advance.
    createAdmin.mutate(
      { fullName: adminName.trim(), email: adminEmail.trim(), pin: adminPin },
      {
        onSuccess: () => {
          setAdminCreated(true);
          goNext();
        },
        onError: (err) => setAdminError(err.message),
      },
    );
  }

  function toggleSeedTask(key: string) {
    if (seedDone[key]) {
      setSeedDone((prev) => ({ ...prev, [key]: false }));
      return;
    }
    seedMutation.mutate(undefined, {
      onSuccess: () => setSeedDone((prev) => ({ ...prev, [key]: true })),
    });
  }

  function markAllSeedTasksDone() {
    seedMutation.mutate(undefined, {
      onSuccess: () => setSeedDone(Object.fromEntries(seedTasks.map((t) => [t.key, true]))),
    });
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const allSeeded = seedTasks.every((t) => seedDone[t.key]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-[24px]">
      <div className="w-full max-w-[640px] rounded-lg border border-border bg-surface p-[28px] shadow-2">
        <div className="mb-[20px] flex items-center gap-[10px]">
          <BrandMark className="h-[28px] w-[28px] text-brand" />
          <div>
            <h1 className="font-display text-[17px] font-bold text-ink">معالج الإعداد الأولي</h1>
            <p className="text-[11.5px] text-ink-faint">إعداد نظام ميزان لمنشأة {demoTenantName} لأول مرة</p>
          </div>
        </div>

        <div className="mb-[22px] overflow-x-auto">
          <StepIndicator currentIndex={stepIndex} />
        </div>

        {step === "activate" ? (
          <section aria-label="تفعيل الترخيص">
            <h2 className="font-display text-[15px] font-bold text-ink">تفعيل الترخيص</h2>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">أدخل مفتاح الترخيص المرسل إليك لتفعيل منشأة {demoTenantName}.</p>
            <label className="mt-[14px] flex flex-col gap-[6px]">
              <span className="text-[12.5px] font-semibold text-ink">مفتاح الترخيص</span>
              <input
                type="text"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                className={`${fieldClass} mz-lat`}
              />
            </label>
            <StubNote>الاتصال الفعلي بخادم الترخيص (توقيع Ed25519 غير مباشر) غير مفعّل في هذا العرض — الزر أدناه يُنهي الخطوة فوراً لأغراض العرض فقط.</StubNote>
            <div className="mt-[14px] flex items-center gap-[10px]">
              <Button type="button" variant="primary" onClick={handleActivate} disabled={activateStatus === "done"}>
                {activateStatus === "done" ? "تم التفعيل" : "تفعيل"}
              </Button>
              {activateStatus === "done" ? <StatusPill label="مُفعّل" tone="success" /> : null}
            </div>
          </section>
        ) : null}

        {step === "admin" ? (
          <section aria-label="إنشاء حساب المسؤول">
            <h2 className="font-display text-[15px] font-bold text-ink">إنشاء حساب المسؤول</h2>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">هذا الحساب سيملك صلاحيات كاملة على النظام.</p>
            <div className="mt-[14px] grid grid-cols-1 gap-[12px] sm:grid-cols-2">
              <label className="flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">الاسم الكامل</span>
                <input type="text" value={adminName} onChange={(e) => setAdminName(e.target.value)} className={fieldClass} />
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">البريد الإلكتروني</span>
                <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={fieldClass} />
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">رمز PIN (4 أرقام)</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))}
                  className={`${fieldClass} mz-num`}
                />
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">تأكيد رمز PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={adminPinConfirm}
                  onChange={(e) => setAdminPinConfirm(e.target.value.replace(/\D/g, ""))}
                  className={`${fieldClass} mz-num`}
                />
              </label>
            </div>
            {adminError ? (
              <p role="alert" className="mt-[10px] text-[12px] font-semibold text-danger-ink">
                {adminError}
              </p>
            ) : null}
            <p className="mt-[10px] text-[11.5px] text-ink-muted">
              يُحفظ هذا الحساب فعلياً كمستخدم مدير ويُستخدم لتسجيل الدخول إلى النظام.
            </p>
          </section>
        ) : null}

        {step === "seed" ? (
          <section aria-label="تهيئة البيانات الأساسية">
            <div className="flex flex-wrap items-center justify-between gap-[10px]">
              <h2 className="font-display text-[15px] font-bold text-ink">تهيئة البيانات الأساسية</h2>
              <Button type="button" size="sm" onClick={markAllSeedTasksDone}>
                تشغيل الكل
              </Button>
            </div>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">دليل الحسابات، الضريبة، تسلسلات الترقيم، الفرع والمستودع الرئيسيان.</p>
            <ul className="mt-[14px] flex flex-col gap-[8px]">
              {seedTasks.map((task) => {
                const done = seedDone[task.key] ?? false;
                return (
                  <li key={task.key} className="flex items-center justify-between gap-[12px] rounded-md border border-border p-[10px_12px]">
                    <div>
                      <div className="text-[13px] font-semibold text-ink">{task.label}</div>
                      <div className="mt-[2px] text-[11.5px] text-ink-faint">{task.hint}</div>
                    </div>
                    <div className="flex items-center gap-[8px]">
                      {done ? <StatusPill label="جاهز" tone="success" /> : null}
                      <Button type="button" size="sm" variant={done ? "default" : "primary"} onClick={() => toggleSeedTask(task.key)}>
                        {done ? "إعادة تعيين" : "تشغيل"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-[10px] text-[11.5px] text-ink-muted">
              التهيئة تُنفَّذ فعلياً على قاعدة البيانات (دليل الحسابات، الضريبة، الترقيم، الفرع، المستودع) وهي آمنة للتكرار.
            </p>
          </section>
        ) : null}

        {step === "import" ? (
          <section aria-label="استيراد البيانات">
            <h2 className="font-display text-[15px] font-bold text-ink">استيراد البيانات (اختياري)</h2>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">
              يمكنك استيراد بيانات العملاء والموردين والأصناف الحالية الآن، أو تخطي هذه الخطوة والقيام بذلك لاحقاً من "الإعدادات ← نقل
              البيانات".
            </p>
            <div className="mt-[14px] flex items-center gap-[10px]">
              <Button type="button" disabled>
                استيراد الآن
              </Button>
              <StatusPill label="قريباً" tone="info" />
            </div>
            <StubNote>معالج نقل البيانات (12 خطوة) موثّق في docs/catalog/09 لكنه غير مبني بعد في هذا العرض — تخطَّ هذه الخطوة للمتابعة.</StubNote>
          </section>
        ) : null}

        <div className="mt-[26px] flex items-center justify-between gap-[12px] border-t border-border pt-[18px]">
          <button type="button" onClick={onCancel} className="text-[12px] font-semibold text-ink-muted hover:text-ink">
            إلغاء والعودة لتسجيل الدخول
          </button>
          <div className="flex items-center gap-[10px]">
            {stepIndex > 0 ? (
              <Button type="button" onClick={goBack}>
                رجوع
              </Button>
            ) : null}
            {step === "activate" ? (
              <Button type="button" variant="primary" disabled={activateStatus !== "done"} onClick={goNext}>
                التالي
              </Button>
            ) : null}
            {step === "admin" ? (
              <Button type="button" variant="primary" onClick={handleAdminNext}>
                التالي
              </Button>
            ) : null}
            {step === "seed" ? (
              <Button type="button" variant="primary" disabled={!allSeeded} onClick={goNext}>
                التالي
              </Button>
            ) : null}
            {step === "import" ? (
              <Button type="button" variant="primary" onClick={onFinish}>
                إنهاء والانتقال إلى النظام
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
