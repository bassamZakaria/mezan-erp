import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrandMark, Button, Copyright, TextInput, cn } from "@mezan/ui";
import { TenantResolveMode } from "@mezan/contracts";
import { AccountLockedError, ApiError, SignInRefusalCode, isDesktopHost, noPlatformInFront, platformLookupFailing, useBootstrapStatus, useForgotPassword, useLogin, usePlatformResolve, useSignInConfig, useTenantInfo, useUnlockAccount } from "../data/hooks";
import type { FirebaseWebConfigDTO } from "@mezan/contracts";
import { FIREBASE_FAILURE_KEYS, FirebaseSignInError, firebaseGoogleToken, firebasePasswordToken, firebaseSendPasswordReset, prepareFirebase } from "./firebase-sign-in";
import { holdsItsOwnBooks, lastTenantMode, LookupHost, lookupHostOf, rememberTenantMode } from "./lookup-host";
import { useAppVersion } from "../data/hub-hooks";
import { OWNER_HAND_OVER_NOTICE_KEYS } from "../data/owner-hand-over-notice";
import {
  SignInNotice,
  clearOwnerHandOver,
  clearSignInHandOff,
  clearSignInNotice,
  clearTenantCode,
  forgetTenantCodeForEmail,
  clearTenantCodeConfirmed,
  loadTenantCode,
  markTenantCodeConfirmed,
  persistTenantCode,
  pendingSignInNotice,
  rememberTenantCodeForEmail,
  pendingOwnerHandOver,
  pendingSignInHandOff,
  tenantCodeIsLeftover,
  tenantCodeForEmail,
} from "../data/session";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { displayName } from "../display-name";
import { readDeviceUsers, rememberDeviceUser, type DeviceUser } from "./device-users";
// lan-ux
import { PairHostLink } from "./PairHostLink";
import { PasswordInput } from "./PasswordInput";
import { SignupLayout } from "../signup/SignupLayout";

const HOST_REFUSAL_STATUSES: readonly number[] = [403, 429];
const TENANT_CODE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/**
 * A wait a person can act on. "900 ثانية" is not one — past two minutes the
 * honest unit is minutes, which is also what the server's own message says.
 */
const WAIT_IN_MINUTES_FROM_SECONDS = 120;
const FEW = 10;

enum WaitUnit {
  Seconds = "seconds",
  Minutes = "minutes",
}

function waitKey(count: number, unit: WaitUnit): AppTranslationKey {
  if (count === 1) return `login.wait.${unit}.one`;
  if (count === 2) return `login.wait.${unit}.two`;
  return count <= FEW ? `login.wait.${unit}.few` : `login.wait.${unit}.many`;
}

function formatWait(seconds: number, t: (key: AppTranslationKey, params?: Record<string, string | number>) => string): string {
  if (seconds < WAIT_IN_MINUTES_FROM_SECONDS) return t(waitKey(seconds, WaitUnit.Seconds), { count: seconds });
  const minutes = Math.ceil(seconds / 60);
  return t(waitKey(minutes, WaitUnit.Minutes), { count: minutes });
}
// SECURITY: offered only on a desktop host running the demo seed. Any other sign-in opens
// on an empty email field: a real company's sign-in must never name an account.
const DEMO_SEED_ADMIN_EMAIL = "admin@cyag.example";

function openingTenantCode(): string | null {
  return tenantCodeIsLeftover() ? null : loadTenantCode();
}

export interface LoginScreenProps {
  onStartWizard: () => void;
}

// SECURITY: the face row is NOT the staff roster — only who has signed in HERE (`device-users.ts`); listing every employee to whoever opens the machine leaks the org chart.
const SERVER_BUSY = 503;

export function LoginScreen({ onStartWizard }: LoginScreenProps) {
  const { t, locale } = useAppTranslation();
  const appVersion = useAppVersion();
  const login = useLogin();
  const queryClient = useQueryClient();

  // REQUIRED ORDERING: must stay the first hook: a layout effect here runs before any query in the tree
  // subscribes, so no request is ever sent under the previous operator's company.
  useLayoutEffect(() => {
    if (tenantCodeIsLeftover()) clearTenantCode();
  }, []);

  const platformResolve = usePlatformResolve();
  const tenantMode = platformResolve.data?.mode;
  const lookupFailingNow = platformLookupFailing(platformResolve);
  const lookupAnswered = platformResolve.data !== undefined || platformResolve.isError;
  const lookupRefusal = platformResolve.failureReason;
  const hostMessageNow =
    lookupRefusal instanceof ApiError && HOST_REFUSAL_STATUSES.includes(lookupRefusal.status) && lookupRefusal.message !== "" ? lookupRefusal.message : null;
  const [lastLookupFailure, setLastLookupFailure] = useState<{ readonly hostMessage: string | null } | null>(null);
  useEffect(() => {
    if (lookupFailingNow) setLastLookupFailure({ hostMessage: hostMessageNow });
    else if (lookupAnswered) setLastLookupFailure(null);
  }, [lookupFailingNow, lookupAnswered, hostMessageNow]);
  const lookupFailing = lookupFailingNow || (lastLookupFailure !== null && !lookupAnswered);
  const hostMessage = lookupFailingNow ? hostMessageNow : lookupFailing ? (lastLookupFailure?.hostMessage ?? null) : null;
  const lookupHost = useMemo(() => lookupHostOf(), []);
  const signInConfig = useSignInConfig({ enabled: lookupHost === LookupHost.Cloud });
  const firebaseConfig = signInConfig.data?.firebase ?? null;
  useEffect(() => {
    if (firebaseConfig) prepareFirebase(firebaseConfig);
  }, [firebaseConfig]);
  const [firebaseBusy, setFirebaseBusy] = useState(false);
  useEffect(() => {
    if (tenantMode !== undefined) rememberTenantMode(tenantMode);
  }, [tenantMode]);
  const companyCodeUnknown = lookupFailing && lookupHost === LookupHost.Cloud && lastTenantMode() !== TenantResolveMode.Subdomain;
  const companyCodeOffered = companyCodeUnknown;
  const resolvesByEmail = tenantMode === TenantResolveMode.Code && !companyCodeUnknown;
  const hostUnreachable = lookupFailing && lookupHost === LookupHost.LanTill;
  const [companyUnconfirmed, setCompanyUnconfirmed] = useState(false);
  const [tenantCode, setTenantCode] = useState(() => openingTenantCode() ?? "");
  const [resolvedCode, setResolvedCode] = useState(() => openingTenantCode() ?? "");
  const tenantCodeInvalid = tenantCode !== "" && !TENANT_CODE_RE.test(tenantCode);
  const tenantInfo = useTenantInfo(tenantMode === TenantResolveMode.Subdomain ? null : resolvedCode || null, {
    enabled: tenantMode === TenantResolveMode.Subdomain || resolvedCode !== "",
  });
  const tenantNotFound = resolvedCode !== "" && tenantInfo.isError && tenantInfo.error?.status === 404;

  const [handOff] = useState(pendingSignInHandOff);
  const [remembered, setRemembered] = useState<DeviceUser[]>(() => readDeviceUsers(openingTenantCode()));
  const [selected, setSelected] = useState<DeviceUser | null>(handOff ? null : (remembered[0] ?? null));
  /** True once «آخر» is chosen, when the device remembers nobody at all, or when activation handed over its owner's address. */
  const [typing, setTyping] = useState(handOff !== null || remembered.length === 0);
  const [username, setUsername] = useState(handOff?.email ?? remembered[0]?.email ?? "");
  const desktopHost = isDesktopHost();
  const oneCompanyHost = holdsItsOwnBooks(lookupHost, noPlatformInFront(platformResolve.error));
  const bootstrap = useBootstrapStatus({ enabled: oneCompanyHost });
  const demoSeeded = bootstrap.data?.demoSeeded === true;
  const offersFirstRun = oneCompanyHost && bootstrap.data?.claimed === false;
  useEffect(() => {
    if (demoSeeded && desktopHost && remembered.length === 0) setUsername((current) => (current === "" ? DEMO_SEED_ADMIN_EMAIL : current));
  }, [demoSeeded, desktopHost, remembered.length]);

  /**
   * A different company's rows must never survive a tenant switch on the
   * SAME browser tab: a "code" tenant shares one origin (and so one
   * `QueryClient` cache) across every company, so clearing it — and
   * re-reading `mezan.deviceUsers.<code>` for the face row — is what a
   * `persistTenantCode`/`clearTenantCode` to a DIFFERENT value must do.
   * Skipped when the code is unchanged, so a mere re-blur doesn't wipe the
   * cache the screen just warmed up.
   *
   * The face-picker identity (`selected`/`typing`/`username`) is reset to
   * the NEW tenant's own default only while the operator is still choosing
   * a face (`!typing`) — never while they are mid-typing an email, so a
   * deliberate company switch never wipes out what they just typed (the
   * other half of the same finding above). `remembered` is refreshed
   * unconditionally either way, so a rival company's face can never show.
   */
  function switchTenantCode(apply: () => void) {
    const before = loadTenantCode();
    apply();
    if (loadTenantCode() === before) return;
    clearSignInHandOff();
    queryClient.clear();
    const list = readDeviceUsers();
    setRemembered(list);
    if (!typing) {
      setSelected(list[0] ?? null);
      setTyping(list.length === 0);
      setUsername(list[0]?.email ?? "");
    }
    setPassword("");
    setError(null);
  }

  function handleTenantCodeChange(event: ChangeEvent<HTMLInputElement>) {
    acknowledgeExpiry();
    setTenantCode(event.target.value.toLowerCase());
  }

  function handleTenantCodeBlur() {
    if (tenantCode === "") {
      switchTenantCode(clearTenantCode);
      setResolvedCode("");
      clearTenantCodeConfirmed();
      return;
    }
    if (tenantCodeInvalid) return;
    switchTenantCode(() => persistTenantCode(tenantCode));
    setResolvedCode(tenantCode);
    markTenantCodeConfirmed(loadTenantCode() ?? tenantCode);
  }

  function handleChangeTenant() {
    switchTenantCode(clearTenantCode);
    setTenantCode("");
    setResolvedCode("");
    clearTenantCodeConfirmed();
  }

  /**
   * A per-operator remembered code that stops resolving (the tenant was
   * archived, or never existed) must not keep correcting the screen BACK to
   * a dead end on every later visit — only forgotten when it was actually
   * the source of the current (not-found) code, so an unrelated typo never
   * wipes a good mapping.
   */
  useEffect(() => {
    if (!tenantNotFound) return;
    const identity = username.trim();
    if (identity !== "" && tenantCodeForEmail(identity) === resolvedCode) forgetTenantCodeForEmail(identity);
  }, [tenantNotFound, username, resolvedCode]);

  const [password, setPassword] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const passwordId = useId();
  const [arrivedWith, setArrivedWith] = useState(pendingSignInNotice);
  const signedOutNotice =
    arrivedWith === SignInNotice.SignedInElsewhere ? t("login.signedInElsewhere") : arrivedWith === SignInNotice.SessionExpired ? t("login.sessionExpired") : null;
  // REQUIRED ORDERING: the flag is cleared by something the person does, never by this
  // screen mounting. A sign-out by the server is followed by a navigation that
  // mounts the screen a second time, and a notice consumed by the first mount
  // was gone before anyone could read it.
  const [handOver, setHandOver] = useState(pendingOwnerHandOver);
  const handOverNoticeKey = handOver === null ? null : OWNER_HAND_OVER_NOTICE_KEYS[handOver];
  function dismissHandOver() {
    clearOwnerHandOver();
    setHandOver(null);
  }
  function acknowledgeExpiry() {
    if (arrivedWith === null) return;
    clearSignInNotice();
    setArrivedWith(null);
  }
  const [error, setError] = useState<string | null>(null);
  /**
   * Seconds left on a lockout, counted down locally.
   *
   * The server answers a 429 with `retryAfterSeconds`, and the screen used to
   * print the sentence and leave the button enabled — so the obvious response
   * to "try again later" was to try again now, and every attempt during a lock
   * reads to the person typing as another failure of their own password. A shop
   * floor at 6pm does not read carefully; it presses the button again.
   */
  const [lockedForSeconds, setLockedForSeconds] = useState(0);
  const [waitingOnBusyServer, setWaitingOnBusyServer] = useState(false);
  const [errorEndsWithTheWait, setErrorEndsWithTheWait] = useState(false);
  const [unlockOffered, setUnlockOffered] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [unlockedNotice, setUnlockedNotice] = useState(arrivedWith === SignInNotice.AccountUnlocked);
  const unlock = useUnlockAccount();

  function submitUnlockCode() {
    if (unlockCode.trim() === "" || unlock.isPending) return;
    unlock.mutate(
      { username: identity, code: unlockCode.trim(), byEmail: resolvesByEmail },
      {
        onSuccess: () => {
          setUnlockOffered(false);
          setUnlockCode("");
          setError(null);
          setUnlockedNotice(true);
        },
        onError: (err) => setError(err.message),
      },
    );
  }
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const focusEmailNext = useRef(false);
  useEffect(() => {
    if (!typing || !focusEmailNext.current) return;
    focusEmailNext.current = false;
    emailRef.current?.focus();
  }, [typing]);

  const identity = typing ? username.trim() : (selected?.email ?? "");
  const canSubmit =
    identity !== "" &&
    password !== "" &&
    !login.isPending &&
    !firebaseBusy &&
    lockedForSeconds === 0 &&
    !tenantCodeInvalid;

  function submit() {
    if (tenantCodeInvalid) return;
    if (!canSubmit) return;
    setError(null);
    setCompanyUnconfirmed(lookupFailing && tenantCode.trim() !== "" && !tenantInfo.isSuccess);
    // On the cloud the sign-in waits for the config: guessing "no Firebase" would post a password the server refuses.
    if (lookupHost === LookupHost.Cloud && !signInConfig.isSuccess) {
      setFirebaseBusy(true);
      void signInConfig.refetch().then(({ data }) => {
        setFirebaseBusy(false);
        if (data) signInWith(data.firebase);
        else setError(t("login.firebase.network"));
      });
      return;
    }
    signInWith(firebaseConfig);
  }

  function signInWith(config: FirebaseWebConfigDTO | null) {
    if (config) {
      signInThroughFirebase(() => firebasePasswordToken(config, identity, password));
      return;
    }
    login.mutate({ username: identity, password, byEmail: resolvesByEmail }, signInOutcome);
  }

  function signInThroughFirebase(token: () => Promise<string>) {
    if (firebaseBusy || login.isPending) return;
    setError(null);
    setFirebaseBusy(true);
    token()
      .then((idToken) => login.mutate({ idToken, byEmail: resolvesByEmail }, signInOutcome))
      .catch((err: unknown) => {
        const key = err instanceof FirebaseSignInError ? FIREBASE_FAILURE_KEYS[err.failure] : "login.error.generic";
        if (key) setError(t(key));
        setErrorEndsWithTheWait(false);
        setUnlockOffered(false);
        setPassword("");
        passwordRef.current?.focus();
      })
      .finally(() => setFirebaseBusy(false));
  }

  const signInOutcome = {
        onSuccess: (session) => {
          clearSignInNotice();
          clearSignInHandOff();
          clearOwnerHandOver();
          clearTenantCodeConfirmed();
          rememberDeviceUser(session);
          const signedInto = loadTenantCode();
          if (tenantMode === TenantResolveMode.Code && signedInto) rememberTenantCodeForEmail(session.email, signedInto);
        },
        onError: (err) => {
          const timedWait = (err.status === 429 || err.status === SERVER_BUSY) && typeof err.retryAfterSeconds === "number";
          const throttled = timedWait && err.code === SignInRefusalCode.TooManyAttempts;
          setError(throttled ? t("login.tooManyAttempts") : err.message || t("login.error.generic"));
          setErrorEndsWithTheWait(throttled);
          setUnlockOffered(err instanceof AccountLockedError && err.unlockByCode);
          if (timedWait) {
            setLockedForSeconds(Math.max(1, Math.ceil(err.retryAfterSeconds ?? 1)));
            setWaitingOnBusyServer(err.status === SERVER_BUSY);
          }
          setPassword("");
          passwordRef.current?.focus();
        },
  } satisfies Parameters<typeof login.mutate>[1];

  // Ticks the lockout down so the form re-enables itself the moment the wait
  // is over, rather than after a reload nobody thinks to do. Keyed on WHETHER
  // a lock is running, not on the number: depending on the count would tear
  // down and rebuild the interval every second.
  const isLocked = lockedForSeconds > 0;
  useEffect(() => {
    if (isLocked || !errorEndsWithTheWait) return;
    setError(null);
    setErrorEndsWithTheWait(false);
  }, [isLocked, errorEndsWithTheWait]);
  useEffect(() => {
    if (!isLocked) return;
    const id = setInterval(() => setLockedForSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [isLocked]);

  function pickUser(user: DeviceUser) {
    acknowledgeExpiry();
    setSelected(user);
    setTyping(false);
    setUsername(user.email);
    setPassword("");
    setError(null);
    passwordRef.current?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  const passwordLabel = typing ? t("login.password") : t("login.who.passwordFor", { name: selected ? displayName(selected, locale) : "" });
  const onCloud = lookupHost === LookupHost.Cloud;

  const card = forgotOpen ? (
    <ForgotPasswordCard
      initialEmail={identity}
      firebase={firebaseConfig}
      mailed={onCloud}
      byEmail={resolvesByEmail}
      onBack={() => setForgotOpen(false)}
    />
  ) : (
    <form onSubmit={handleSubmit} noValidate className={CARD_CLASS}>
      {onCloud ? null : (
        <div className="flex items-center gap-[10px]">
          <BrandMark className="h-[30px] w-[30px] flex-none text-brand" />
          <span className="mz-disp text-[17px] font-bold text-ink">{t("shell.brand.name")}</span>
          <span className="ms-auto text-2xs text-ink-faint">{t("login.branchHint")}</span>
        </div>
      )}

      {platformResolve.isLoading && !lookupFailing ? (
        <p className="mt-[4px] text-2xs text-ink-faint">{t("login.platformChecking")}</p>
      ) : null}

      {hostUnreachable ? (
        <p role="status" className="mt-[12px] rounded-md border border-warning bg-warning-soft px-[12px] py-[9px] text-xs text-warning-ink">
          {t("login.hostUnreachable")}
        </p>
      ) : null}

      {hostMessage ? (
        <p role="status" className="mt-[12px] rounded-md border border-warning bg-warning-soft px-[12px] py-[9px] text-xs text-warning-ink">
          {hostMessage}
        </p>
      ) : null}

      {/* A session that ended says so, rather than looking like a fresh start
          the user asked for. It sits above the face row, since that is where
          the eye lands first. */}
      {signedOutNotice !== null && error === null ? (
        <div
          role="status"
          className="mt-[12px] rounded-md border border-warning bg-warning-soft px-[12px] py-[9px] text-xs text-warning-ink"
        >
          {signedOutNotice}
        </div>
      ) : null}
      {handOverNoticeKey ? (
        <div role="status" className="mt-[12px] flex items-start gap-[8px] rounded-md border border-warning bg-warning-soft px-[12px] py-[9px] text-xs text-warning-ink">
          <span className="flex-1">{t(handOverNoticeKey)}</span>
          <Button size="sm" variant="ghost" onClick={dismissHandOver}>
            {t("login.ownerHandOver.dismiss")}
          </Button>
        </div>
      ) : null}

      <h1 className="mt-[14px] font-display text-[21px] font-bold leading-[1.35] text-ink">
        {typing ? t("login.title") : t("login.who")}
      </h1>

      {remembered.length > 0 ? (
        <div className="mt-[14px] flex gap-[9px]">
          <div role="radiogroup" aria-label={t("login.who")} className="flex min-w-0 gap-[9px]" style={{ flexGrow: remembered.length, flexBasis: 0 }}>
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
          </div>
          {/* «آخر» is an ACTION, not a fourth person — it sits outside the
              radiogroup so a screen reader does not count it as a choice. */}
          <button
            type="button"
            onClick={() => {
              setTyping(true);
              setSelected(null);
              setUsername("");
              setError(null);
              focusEmailNext.current = true;
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

      {companyCodeOffered ? (
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
          ) : resolvedCode !== "" && tenantInfo.isSuccess ? (
            // The tenant's real name is shown only after sign-in — pre-auth
            // this echoes back the code the person typed, per the
            // `/platform/resolve` name-leak fix (never a name lookup here).
            <div className="flex items-center justify-between gap-[8px]">
              <span className="mz-lat text-2xs text-ink-muted" dir="ltr">
                {t("login.tenantResolved", { code: resolvedCode })}
              </span>
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
            ref={emailRef}
            type="email"
            value={username}
            placeholder={t("login.who.otherHint")}
            autoComplete="username"
            className="mz-lat"
            onChange={(e) => {
              acknowledgeExpiry();
              setUsername(e.target.value);
            }}
          />
        </label>
      ) : null}

      <div className="mt-[16px] flex items-center justify-between gap-[8px]">
        <label htmlFor={passwordId} className="text-xs text-ink-muted">
          {passwordLabel}
        </label>
        <button
          type="button"
          onClick={() => setForgotOpen(true)}
          className="text-2xs font-semibold text-accent-strong hover:underline"
        >
          {t("login.forgot")}
        </button>
      </div>
      <PasswordInput
        id={passwordId}
        ref={passwordRef}
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          acknowledgeExpiry();
          setPassword(e.target.value);
          setError(null);
        }}
        className="mt-[8px]"
      />

      {companyUnconfirmed ? (
        <p role="status" className="mt-[10px] text-xs text-warning-ink">
          {t("login.companyUnconfirmed")}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-[10px] text-xs font-semibold text-danger-ink">
          {error}
        </p>
      ) : null}

      {unlockedNotice && error === null ? (
        <p role="status" className="mt-[10px] text-xs font-semibold text-success-ink">
          {t("login.unlock.done")}
        </p>
      ) : null}

      {unlockOffered && !firebaseConfig ? (
        <div className="mt-[12px] flex items-end gap-[8px]">
          <label className="flex-1 text-xs text-ink-muted">
            {t("login.unlock.code")}
            <TextInput
              dir="ltr"
              autoComplete="one-time-code"
              value={unlockCode}
              onChange={(e) => setUnlockCode(e.target.value)}
              className="mt-[4px] w-full"
            />
          </label>
          <Button type="button" disabled={unlockCode.trim() === "" || unlock.isPending} onClick={submitUnlockCode}>
            {t("login.unlock.submit")}
          </Button>
        </div>
      ) : null}

      <Button type="submit" variant="primary" disabled={!canSubmit} className="mt-[16px] w-full justify-center py-[12px]">
        {lockedForSeconds > 0 ? t(waitingOnBusyServer ? "login.busyFor" : "login.throttledFor", { wait: formatWait(lockedForSeconds, t) }) : t("login.submit")}
      </Button>

      {firebaseConfig ? (
        <>
          <div className="mt-[14px] flex items-center gap-[10px] text-2xs text-ink-faint">
            <span className="h-px flex-1 bg-border" />
            {t("login.or")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="default"
            disabled={firebaseBusy || login.isPending || lockedForSeconds > 0 || tenantCodeInvalid}
            onClick={() => signInThroughFirebase(() => firebaseGoogleToken(firebaseConfig, identity || undefined))}
            className="mt-[14px] w-full justify-center py-[12px]"
          >
            {t("login.google")}
          </Button>
        </>
      ) : null}

      <div className="mt-[16px] flex items-center gap-[10px] text-2xs text-ink-faint">
        {!typing ? (
          <button
            type="button"
            onClick={() => {
              setTyping(true);
              setSelected(null);
              setUsername("");
              focusEmailNext.current = true;
            }}
            className="text-ink-muted hover:underline"
          >
            {t("login.otherUser")}
          </button>
        ) : null}
        {offersFirstRun ? (
          <button type="button" onClick={onStartWizard} className="text-ink-muted hover:underline">
            {t("login.wizard.short")}
          </button>
        ) : null}
        {/* lan-ux: the only way into pairing from the UI. Rendered only on a
            desktop machine that holds no books, so it can never appear on a
            shop's live host and offer to turn it into a till. */}
        <PairHostLink />
        {/*
          The build's OWN version, over IPC on desktop. It was the literal
          `Mezan 2026.8`, which is the first thing support asks for and the one
          place a user could read it — so «ما هي نسختك؟» had a confident wrong
          answer that no upgrade ever changed.
        */}
        {onCloud ? null : <span className="mz-lat ms-auto">Mezan {appVersion}</span>}
      </div>

      {onCloud ? null : (
        <div className="mt-[10px] border-t border-border pt-[10px] text-center">
          <Copyright />
        </div>
      )}
    </form>
  );

  if (onCloud) return <SignupLayout maxWidthClassName="max-w-[380px]">{card}</SignupLayout>;
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-[24px]">
      {/* The mark, oversized and barely there, anchors the empty quadrant
          instead of sitting as a badge on the card. */}
      <BrandMark
        aria-hidden
        className="pointer-events-none fixed bottom-[-70px] end-[-40px] h-[320px] w-[320px] text-brand opacity-10"
      />
      {card}
    </div>
  );
}

const CARD_CLASS = "relative w-full max-w-[380px] rounded-lg border border-border bg-surface p-[28px] pb-[18px] shadow-2";

function ForgotPasswordCard({
  initialEmail,
  firebase,
  mailed,
  byEmail,
  onBack,
}: {
  initialEmail: string;
  firebase: FirebaseWebConfigDTO | null;
  mailed: boolean;
  byEmail: boolean;
  onBack: () => void;
}) {
  const { t } = useAppTranslation();
  const forgot = useForgotPassword();
  const emailId = useId();
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [firebaseSending, setFirebaseSending] = useState(false);
  const [firebaseFailed, setFirebaseFailed] = useState(false);
  const sending = forgot.isPending || firebaseSending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (email.trim() === "" || sending) return;
    if (firebase) {
      setFirebaseFailed(false);
      setFirebaseSending(true);
      firebaseSendPasswordReset(firebase, email)
        .then(() => setSent(true))
        .catch(() => setFirebaseFailed(true))
        .finally(() => setFirebaseSending(false));
      return;
    }
    forgot.mutate({ username: email.trim(), byEmail }, { onSuccess: () => setSent(true) });
  }

  let body: ReactNode;
  if (!mailed) {
    body = <p className="mt-[12px] text-[13px] leading-[1.8] text-ink-muted">{t("login.forgot.askAdmin")}</p>;
  } else if (sent) {
    body = (
      <p role="status" className="mt-[12px] text-[13px] leading-[1.8] text-ink">
        {t("login.forgot.sent")}
      </p>
    );
  } else {
    body = (
      <>
        <p className="mt-[8px] text-[13px] leading-[1.8] text-ink-muted">{t("login.forgot.body")}</p>
        <label htmlFor={emailId} className="mt-[14px] block text-xs font-semibold text-ink">
          {t("login.email")}
        </label>
        <TextInput id={emailId} type="email" autoComplete="username" className="mz-lat mt-[6px] w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
        {forgot.error || firebaseFailed ? (
          <p role="alert" className="mt-[10px] text-xs font-semibold text-danger-ink">
            {forgot.error?.message ?? t("login.forgot.failed")}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={email.trim() === "" || sending} className="mt-[16px] w-full justify-center py-[12px]">
          {t("login.forgot.submit")}
        </Button>
      </>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={CARD_CLASS}>
      <h1 className="font-display text-[21px] font-bold leading-[1.35] text-ink">{t("login.forgot.title")}</h1>
      {body}
      <button type="button" onClick={onBack} className="mt-[16px] text-xs font-semibold text-accent-strong hover:underline">
        {t("login.unlockLink.backToSignIn")}
      </button>
    </form>
  );
}
