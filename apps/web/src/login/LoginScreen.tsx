import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  BrandMark,
  Button,
  TextInput,
} from "@mezan/ui";
import { useLogin } from "../data/hooks";
import { useAppTranslation } from "../i18n";

const PIN_LENGTH = 4;
/**
 * Prefilled login = the seed admin's EMAIL, not their display name. It used to
 * be «محمد الشهابي», which worked only because login matched the full name — a
 * field any admin can edit, and one two people can share. The PIN is always
 * verified against the real user store.
 */
const DEFAULT_USERNAME = "admin@cyag.example";

export interface LoginScreenProps {
  onStartWizard: () => void;
}

/**
 * Desktop login — docs/catalog/09's "desktop user + PIN" login shape and the
 * approved mockup's `data-view="login"`. "دخول" verifies the username + PIN
 * against the real users store via `POST /auth/login`; a success establishes
 * the session in ApiContext, which is what dismisses this screen.
 */
export function LoginScreen({ onStartWizard }: LoginScreenProps) {
  const { t } = useAppTranslation();
  const login = useLogin();
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
        onError: (err) => setError(err.message || t("login.error.generic")),
      },
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-surface lg:grid-cols-[1.05fr_.95fr]">
      <div className="hidden flex-col items-center justify-center gap-[24px] bg-gradient-to-br from-brand to-brand-strong p-[48px] text-brand-ink lg:flex">
        <BrandMark className="h-[88px] w-[88px] text-accent" />
        <h1 className="font-display text-[34px] font-extrabold text-brand-ink">{t("shell.brand.name")}</h1>
        <p className="max-w-[300px] text-center text-[13.5px] leading-[1.7] text-brand-ink opacity-85">
          {t("login.hero.tagline")}
        </p>
        <div className="mz-lat text-[10.5px] font-semibold uppercase tracking-[2px] text-brand-ink opacity-70">Mezan ERP · 2026.8</div>
      </div>

      <div className="flex items-center justify-center p-[48px]">
        <form onSubmit={handleSubmit} className="w-full max-w-[372px]" noValidate>
          <h2 className="font-display text-[22px] font-bold text-ink">{t("login.title")}</h2>
          <p className="mb-[22px] mt-[6px] text-[12.5px] text-ink-muted">{t("login.subtitle")}</p>

          <label className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">{t("login.email")}</span>
            <TextInput
              type="email"
              value={username}
              placeholder="admin@example.com"
              autoComplete="username"
              className="mz-lat"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <div className="mt-[16px] flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">
              {t("login.pin")} <span className="mz-lat">PIN</span>
            </span>
            <div className="flex gap-[8px]" dir="ltr">
              {pinDigits.map((digit, index) => (
                <TextInput
                  key={index}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  aria-label={t("login.pin.digit", { index: index + 1 })}
                  onChange={(e) => handlePinChange(index, e)}
                  onKeyDown={(e) => handlePinKeyDown(index, e)}
                  className="h-[46px] w-[46px] px-0 text-center text-[18px] font-bold"
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
            {t("login.submit")}
          </Button>

          <div className="mt-[24px] border-t border-border pt-[18px] text-[11px] text-ink-faint">
            <span className="mz-lat">Mezan 2026.8</span>
          </div>

          <button
            type="button"
            onClick={onStartWizard}
            className="mt-[14px] w-full text-center text-[12px] font-semibold text-brand hover:underline"
          >
            {t("login.wizard")}
          </button>
        </form>
      </div>
    </div>
  );
}
