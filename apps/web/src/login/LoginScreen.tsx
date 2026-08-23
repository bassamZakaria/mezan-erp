import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { BrandMark, Button } from "@mezan/ui";
import { licensedModules } from "@mezan/domain";
import { useEntitlements, useLogin, useTenantInfo } from "../data/hooks";

const PIN_LENGTH = 4;
/** Prefilled default username = the seed admin (docs/catalog/09). The PIN is always verified against the real user store. */
const DEFAULT_USERNAME = "محمد الشهابي";

export interface LoginScreenProps {
  onLogin: () => void;
  onStartWizard: () => void;
}

/**
 * Desktop login — docs/catalog/09's "desktop user + PIN" login shape and the
 * approved mockup's `data-view="login"`. "دخول" verifies the username + PIN
 * against the real users store via `POST /auth/login`; a success establishes
 * the AuthContext session every subsequent API call uses.
 */
export function LoginScreen({ onLogin, onStartWizard }: LoginScreenProps) {
  const login = useLogin();
  const entitlements = useEntitlements().data ?? null;
  const tenantName = useTenantInfo().data?.name ?? "";
  const modules = entitlements ? licensedModules(entitlements) : [];
  const [username, setUsername] = useState(DEFAULT_USERNAME);
  const [pinDigits, setPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const pinComplete = pinDigits.every((d) => d !== "");
  const canSubmit = username.trim() !== "" && pinComplete && !login.isPending;

  function handlePinChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const digit = event.target.value.replace(/\D/g, "").slice(-1);
    setPinDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    setError(null);
    if (digit !== "" && index < PIN_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function handlePinKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && pinDigits[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    login.mutate(
      { username: username.trim(), pin: pinDigits.join("") },
      {
        onSuccess: () => onLogin(),
        onError: (err) => setError(err.message || "تعذّر تسجيل الدخول."),
      },
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-surface lg:grid-cols-[1.05fr_.95fr]">
      <div className="hidden flex-col items-center justify-center gap-[24px] bg-gradient-to-br from-brand to-brand-strong p-[48px] text-brand-ink lg:flex">
        <BrandMark className="h-[88px] w-[88px] text-accent" />
        <h1 className="font-display text-[34px] font-extrabold text-brand-ink">ميزان</h1>
        <p className="max-w-[300px] text-center text-[13.5px] leading-[1.7] text-brand-ink opacity-85">
          نظام تخطيط موارد المنشآت — دقة محاسبية، وضوح تشغيلي، وتوازن في كل قيد.
        </p>
        <div className="mz-lat text-[10.5px] font-semibold uppercase tracking-[2px] text-brand-ink opacity-70">Mezan ERP · 2026.8</div>
      </div>

      <div className="flex items-center justify-center p-[48px]">
        <form onSubmit={handleSubmit} className="w-full max-w-[372px]" noValidate>
          <div className="mb-[18px] flex items-center gap-[8px] rounded-pill border border-border bg-surface-2 px-[13px] py-[8px] text-[12.5px] font-medium text-ink-muted">
            <svg aria-hidden viewBox="0 0 16 16" fill="none" className="h-[15px] w-[15px] text-ink-faint">
              <path d="M2 6.5 8 3l6 3.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5Z" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <b className="mz-lat">{tenantName}</b>
            <span className="text-ink-faint">{entitlements?.plan ?? ""}</span>
          </div>

          <h2 className="font-display text-[22px] font-bold text-ink">تسجيل الدخول</h2>
          <p className="mb-[22px] mt-[6px] text-[12.5px] text-ink-muted">أدخل اسم المستخدم ورمز PIN الخاص بجهازك</p>

          <label className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">اسم المستخدم</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none transition-colors focus:border-brand"
            />
          </label>

          <div className="mt-[16px] flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">
              رمز <span className="mz-lat">PIN</span>
            </span>
            <div className="flex gap-[8px]" dir="ltr">
              {pinDigits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  aria-label={`رمز PIN رقم ${index + 1}`}
                  onChange={(e) => handlePinChange(index, e)}
                  onKeyDown={(e) => handlePinKeyDown(index, e)}
                  className="h-[46px] w-[46px] rounded-md border border-border bg-surface text-center text-[18px] font-bold text-ink outline-none transition-colors focus:border-brand"
                />
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-[10px] text-[12px] font-semibold text-danger-ink">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" disabled={!canSubmit} className="mt-[16px] w-full justify-center py-[11px]">
            دخول
          </Button>

          <div className="mt-[18px]">
            <div className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.6px] text-ink-faint">الوحدات المرخّصة</div>
            <div className="flex flex-wrap gap-[6px]">
              {modules.map((mod) => (
                <span
                  key={mod.id}
                  className="rounded-pill bg-surface-3 px-[9px] py-[3px] text-[11px] font-semibold text-ink-muted"
                >
                  {mod.labelAr}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-[24px] flex items-center justify-between gap-[10px] border-t border-border pt-[18px] text-[11px] text-ink-faint">
            <span className="mz-lat">Mezan 2026.8</span>
            <span>
              مرخّص لـ <span className="mz-lat">{tenantName}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={onStartWizard}
            className="mt-[14px] w-full text-center text-[12px] font-semibold text-brand hover:underline"
          >
            أول مرة على ميزان؟ ابدأ معالج الإعداد الأولي
          </button>
        </form>
      </div>
    </div>
  );
}
