import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrandMark, Button, Copyright, TextInput, cn } from "@mezan/ui";
import { useLogin, usePlatformResolve, useTenantInfo } from "../data/hooks";
import { clearSessionExpired, clearTenantCode, loadTenantCode, persistTenantCode, sessionExpiredPending } from "../data/session";
import { useAppTranslation } from "../i18n";
import { displayName } from "../display-name";
import { readDeviceUsers, rememberDeviceUser, type DeviceUser } from "./device-users";

const PIN_LENGTH = 6;
const TENANT_CODE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/**
 * A wait a person can act on. "900 ثانية" is not one — past two minutes the
 * honest unit is minutes, which is also what the server's own message says.
 */
function formatWait(seconds: number): string {
  if (seconds < 120) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}
/**
 * The seed admin's EMAIL, not their display name — login used to match the full
 * name, a field any admin can edit and two people can share. Only used as the
 * fallback when this device remembers nobody.
 */
const DEFAULT_USERNAME = "admin@cyag.example";

export interface LoginScreenProps {
  onStartWizard: () => void;
}

/**
 * Desktop login, direction ل٢ «مَن على الجهاز».
 *
 *   مَن يعمل الآن؟
 *   (م.ا) محمد   (س.ع) سارة   (+) آخر
 *   الرمز السرّي لـ محمد الشهابي
 *   [•][•][•][ ]
 *
 * NO TYPED USERNAME in the common case. The clerk opens this ~60 times a month
 * and is the same person almost every time, so the device offers the people it
 * has actually seen and asks only for the PIN. «آخر» reveals the email field
 * for the monthly-visit accountant, the new hire, and the first run.
 *
 * The face row is NOT the staff roster — it is only who has signed in HERE
 * (see `device-users.ts`), because listing every employee and their role to
 * whoever opens the machine leaks the org chart for no gain.
 *
 * The PIN auto-submits on the fourth digit: at 60 logins a month, a Tab to a
 * button the form already knows how to press is pure friction.
 */
export function LoginScreen({ onStartWizard }: LoginScreenProps) {
  const { t, locale } = useAppTranslation();
  const login = useLogin();
  const queryClient = useQueryClient();

  const platformResolve = usePlatformResolve();
  const tenantMode = platformResolve.data?.mode;
  const [tenantCode, setTenantCode] = useState(() => loadTenantCode() ?? "");
  const [resolvedCode, setResolvedCode] = useState(() => loadTenantCode() ?? "");
  const tenantCodeInvalid = tenantCode !== "" && !TENANT_CODE_RE.test(tenantCode);
  const tenantInfo = useTenantInfo(tenantMode === "subdomain" ? null : resolvedCode || null, {
    enabled: tenantMode === "subdomain" || resolvedCode !== "",
  });
  const tenantNotFound = resolvedCode !== "" && tenantInfo.isError && tenantInfo.error?.status === 404;

  const [remembered, setRemembered] = useState<DeviceUser[]>(() => readDeviceUsers());
  const [selected, setSelected] = useState<DeviceUser | null>(remembered[0] ?? null);
  /** True once «آخر» is chosen, or when the device remembers nobody at all. */
  const [typing, setTyping] = useState(remembered.length === 0);
  const [username, setUsername] = useState(remembered[0]?.email ?? DEFAULT_USERNAME);

  /**
   * A different company's rows must never survive a tenant switch on the
   * SAME browser tab: a "code" tenant shares one origin (and so one
   * `QueryClient` cache) across every company, so clearing it — and
   * re-reading `mezan.deviceUsers.<code>` for the face row — is what a
   * `persistTenantCode`/`clearTenantCode` to a DIFFERENT value must do.
   * Skipped when the code is unchanged, so a mere re-blur doesn't wipe the
   * cache the screen just warmed up.
   */
  function switchTenantCode(apply: () => void) {
    const before = loadTenantCode();
    apply();
    if (loadTenantCode() === before) return;
    queryClient.clear();
    const list = readDeviceUsers();
    setRemembered(list);
    setSelected(list[0] ?? null);
    setTyping(list.length === 0);
    setUsername(list[0]?.email ?? DEFAULT_USERNAME);
    setPinDigits(Array(PIN_LENGTH).fill(""));
    setError(null);
  }

  function handleTenantCodeChange(event: ChangeEvent<HTMLInputElement>) {
    setTenantCode(event.target.value.toLowerCase());
  }

  function handleTenantCodeBlur() {
    if (tenantCode === "") {
      switchTenantCode(clearTenantCode);
      setResolvedCode("");
      return;
    }
    if (tenantCodeInvalid) return;
    switchTenantCode(() => persistTenantCode(tenantCode));
    setResolvedCode(tenantCode);
  }

  function handleChangeTenant() {
    switchTenantCode(clearTenantCode);
    setTenantCode("");
    setResolvedCode("");
  }
  const [pinDigits, setPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  // Pure read at mount, cleared in the effect below — see `session.ts` for why
  // the two are not one call.
  const [expired] = useState(sessionExpiredPending);
  useEffect(() => clearSessionExpired(), []);
  const [error, setError] = useState<string | null>(null);
  /**
   * Seconds left on a lockout, counted down locally.
   *
   * The server answers a 429 with `retryAfterSeconds`, and the screen used to
   * print the sentence and leave the button enabled — so the obvious response
   * to "try again later" was to try again now, and every attempt during a lock
   * reads to the person typing as another failure of their own PIN. A shop
   * floor at 6pm does not read carefully; it presses the button again.
   */
  const [lockedForSeconds, setLockedForSeconds] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const submittedFor = useRef<string>("");

  const pin = pinDigits.join("");
  const pinComplete = pin.length === PIN_LENGTH && pinDigits.every((d) => d !== "");
  const identity = typing ? username.trim() : (selected?.email ?? "");
  const canSubmit =
    identity !== "" &&
    pinComplete &&
    !login.isPending &&
    lockedForSeconds === 0 &&
    !tenantCodeInvalid;

  function submit() {
    if (tenantMode === "code" && tenantCode.trim() === "") {
      setError(t("login.tenantRequired"));
      return;
    }
    if (tenantCodeInvalid) return;
    if (!canSubmit) return;
    // Guard the auto-submit against React re-running the effect for the same
    // completed PIN — otherwise a slow server turns one sign-in into several.
    const attempt = `${identity}:${pin}`;
    if (submittedFor.current === attempt) return;
    submittedFor.current = attempt;
    setError(null);
    login.mutate(
      { username: identity, pin },
      {
        onSuccess: (session) => rememberDeviceUser(session),
        onError: (err) => {
          setError(err.message || t("login.error.generic"));
          if (err.status === 429 && typeof err.retryAfterSeconds === "number") {
            setLockedForSeconds(Math.max(1, Math.ceil(err.retryAfterSeconds)));
          }
          setPinDigits(Array(PIN_LENGTH).fill(""));
          inputRefs.current[0]?.focus();
        },
      },
    );
  }

  // Ticks the lockout down so the form re-enables itself the moment the wait
  // is over, rather than after a reload nobody thinks to do. Keyed on WHETHER
  // a lock is running, not on the number: depending on the count would tear
  // down and rebuild the interval every second.
  const isLocked = lockedForSeconds > 0;
  useEffect(() => {
    if (!isLocked) return;
    const id = setInterval(() => setLockedForSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [isLocked]);

  /**
   * The fourth digit submits. `submit()` is idempotent per (identity, pin) via
   * `submittedFor`, so re-running this effect cannot fire two sign-ins for one
   * PIN — which is why it does not need to be in the dependency list.
   */
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (pinComplete) submitRef.current();
  }, [pinComplete, pin, identity]);

  function pickUser(user: DeviceUser) {
    setSelected(user);
    setTyping(false);
    setUsername(user.email);
    setPinDigits(Array(PIN_LENGTH).fill(""));
    setError(null);
    inputRefs.current[0]?.focus();
  }

  function handlePinChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value.replace(/\D/g, "");
    // The box keeps no `maxLength`, so a PASTED "1234" arrives whole — but that
    // also means typing over a filled box arrives as old+new ("1" + "4" = "14").
    // Drop the digit that was already there, or the stale one wins and the PIN
    // silently becomes the wrong number.
    const previous = pinDigits[index] ?? "";
    let typed = previous !== "" && raw.startsWith(previous) ? raw.slice(previous.length) : raw;
    if (typed === "") typed = raw.slice(-1);
    if (raw === "") {
      setPinDigits((prev) => prev.map((d, i) => (i === index ? "" : d)));
      return;
    }
    // A pasted or fast-typed run fills forward from here rather than keeping
    // only its last character — the reason a pasted 4-digit PIN used to vanish.
    setPinDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < typed.length && index + i < PIN_LENGTH; i += 1) next[index + i] = typed[i] ?? "";
      return next;
    });
    setError(null);
    const landed = Math.min(index + typed.length, PIN_LENGTH - 1);
    inputRefs.current[landed]?.focus();
  }

  function handlePinKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && pinDigits[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  const pinLabel = typing
    ? t("login.pin")
    : t("login.who.pinFor", { name: selected ? displayName(selected, locale) : "" });

  const resolvedTenant = platformResolve.data?.tenant;
  const tenantDisplayName = resolvedTenant ? (locale === "en" && resolvedTenant.nameEn ? resolvedTenant.nameEn : resolvedTenant.nameAr) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-[24px]">
      {/* The mark, oversized and barely there, anchors the empty quadrant
          instead of sitting as a badge on the card. */}
      <BrandMark
        aria-hidden
        className="pointer-events-none fixed bottom-[-70px] end-[-40px] h-[320px] w-[320px] text-brand opacity-10"
      />

      <form
        onSubmit={handleSubmit}
        noValidate
        className="relative w-full max-w-[380px] rounded-lg border border-border bg-surface p-[28px] pb-[18px] shadow-2"
      >
        <div className="flex items-center gap-[10px]">
          <BrandMark className="h-[30px] w-[30px] flex-none text-brand" />
          <span className="mz-disp text-[17px] font-bold text-ink">{t("shell.brand.name")}</span>
          <span className="ms-auto text-2xs text-ink-faint">{t("login.branchHint")}</span>
        </div>

        {tenantMode === "subdomain" && tenantDisplayName ? (
          <p className="mt-[4px] text-xs font-semibold text-ink">{tenantDisplayName}</p>
        ) : null}

        {platformResolve.isLoading ? (
          <p className="mt-[4px] text-2xs text-ink-faint">{t("login.platformChecking")}</p>
        ) : null}

        {/* A session that ended says so, rather than looking like a fresh start
            the user asked for. It sits above the face row, since that is where
            the eye lands first. */}
        {expired && error === null ? (
          <div
            role="status"
            className="mt-[12px] rounded-md border border-warning bg-warning-soft px-[12px] py-[9px] text-xs text-warning-ink"
          >
            {t("login.sessionExpired")}
          </div>
        ) : null}

        <h2 className="mt-[14px] font-display text-[21px] font-bold leading-[1.35] text-ink">
          {typing ? t("login.title") : t("login.who")}
        </h2>

        {remembered.length > 0 ? (
          <div className="mt-[14px] flex gap-[9px]" role="radiogroup" aria-label={t("login.who")}>
            {remembered.map((user) => {
              const active = !typing && selected?.email === user.email;
              return (
                <button
                  key={user.email}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={t("login.who.pick", { name: displayName(user, locale) })}
                  onClick={() => pickUser(user)}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center gap-[6px] rounded-md border px-[4px] py-[10px] text-2xs transition-colors",
                    active
                      ? "border-accent-strong bg-accent-soft font-semibold text-ink"
                      : "border-transparent bg-surface-2 text-ink-muted hover:bg-surface-3",
                  )}
                >
                  {user.photoUrl ? (
                    <img src={user.photoUrl} alt="" className="h-[40px] w-[40px] flex-none rounded-full object-cover" />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-[40px] w-[40px] flex-none items-center justify-center rounded-full font-display text-[13px] font-extrabold",
                        active ? "bg-accent text-accent-ink" : "bg-brand text-brand-ink",
                      )}
                    >
                      {user.initials}
                    </span>
                  )}
                  <span className="w-full truncate text-center" title={displayName(user, locale)}>
                    {displayName(user, locale)}
                  </span>
                </button>
              );
            })}
            {/* «آخر» is an ACTION, not a fourth person — it sits outside the
                radiogroup so a screen reader does not count it as a choice. */}
            <button
              type="button"
              onClick={() => {
                setTyping(true);
                setSelected(null);
                setUsername("");
                setError(null);
              }}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-[6px] rounded-md border px-[4px] py-[10px] text-2xs transition-colors",
                typing ? "border-accent-strong bg-accent-soft font-semibold text-ink" : "border-transparent bg-surface-2 text-ink-muted hover:bg-surface-3",
              )}
            >
              <span
                aria-hidden
                className="flex h-[40px] w-[40px] flex-none items-center justify-center rounded-full bg-surface-3 text-[16px] text-ink-muted"
              >
                +
              </span>
              <span className="w-full truncate text-center">{t("login.who.other")}</span>
            </button>
          </div>
        ) : null}

        {tenantMode === "code" ? (
          <div className="mt-[14px] flex flex-col gap-[6px]">
            <label className="flex flex-col gap-[6px]">
              <span className="text-xs font-semibold text-ink">{t("login.tenantCode")}</span>
              <TextInput
                value={tenantCode}
                dir="ltr"
                autoComplete="organization"
                placeholder={t("login.tenantCodeHint")}
                className="mz-lat"
                invalid={tenantCodeInvalid}
                onChange={handleTenantCodeChange}
                onBlur={handleTenantCodeBlur}
              />
            </label>
            {tenantCodeInvalid ? (
              <p role="alert" className="text-2xs font-semibold text-danger-ink">
                {t("login.tenantCodeInvalid")}
              </p>
            ) : resolvedCode !== "" && tenantInfo.data ? (
              <div className="flex items-center justify-between gap-[8px]">
                <span className="text-2xs text-ink-muted">{tenantInfo.data.name}</span>
                <button type="button" onClick={handleChangeTenant} className="text-2xs text-ink-muted hover:underline">
                  {t("login.changeTenant")}
                </button>
              </div>
            ) : tenantNotFound ? (
              <p role="alert" className="text-2xs font-semibold text-danger-ink">
                {t("login.tenantNotFound")}
              </p>
            ) : (
              <span className="text-2xs text-ink-faint">{t("login.tenantCodeHint")}</span>
            )}
          </div>
        ) : null}

        {typing ? (
          <label className="mt-[14px] flex flex-col gap-[6px]">
            <span className="text-xs font-semibold text-ink">{t("login.email")}</span>
            <TextInput
              type="email"
              value={username}
              placeholder={t("login.who.otherHint")}
              autoComplete="username"
              className="mz-lat"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
        ) : null}

        <p className="mt-[16px] text-xs text-ink-muted">{pinLabel}</p>

        <div className="mt-[8px] flex gap-[7px]" dir="ltr" role="group" aria-label={t("login.pin")}>
          {pinDigits.map((digit, index) => (
            <TextInput
              key={index}
              ref={(el) => {
                inputRefs.current[index] = el;
              }}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={digit}
              aria-label={t("login.pin.digit", { index: index + 1 })}
              onChange={(e) => handlePinChange(index, e)}
              onKeyDown={(e) => handlePinKeyDown(index, e)}
              className="h-[52px] w-full px-0 text-center text-[19px] font-bold"
            />
          ))}
        </div>

        {error ? (
          <p role="alert" className="mt-[10px] text-xs font-semibold text-danger-ink">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" disabled={!canSubmit} className="mt-[16px] w-full justify-center py-[12px]">
          {lockedForSeconds > 0 ? `${t("login.lockedFor")} ${formatWait(lockedForSeconds)}` : t("login.submit")}
        </Button>

        <div className="mt-[16px] flex items-center gap-[10px] text-2xs text-ink-faint">
          {!typing ? (
            <button
              type="button"
              onClick={() => {
                setTyping(true);
                setSelected(null);
                setUsername("");
              }}
              className="text-ink-muted hover:underline"
            >
              {t("login.otherUser")}
            </button>
          ) : null}
          <button type="button" onClick={onStartWizard} className="text-ink-muted hover:underline">
            {t("login.wizard.short")}
          </button>
          <span className="mz-lat ms-auto">Mezan 2026.8</span>
        </div>

        <div className="mt-[10px] border-t border-border pt-[10px] text-center">
          <Copyright />
        </div>
      </form>
    </div>
  );
}
