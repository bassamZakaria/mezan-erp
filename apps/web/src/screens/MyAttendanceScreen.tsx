import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState, SidePanel, StatusPill } from "@mezan/ui";
import { ClockChallengePurposeDTO, SelfClockActionDTO, type AttendanceEntryDTO, type SelfClockPunchDTO, type SelfieUploadDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { ApiError } from "../data/hooks";
import { useClockChallenge, useRegisterClockCredential, useSelfAttendance, useSelfClockPunch, useSelfClockStatus, useSelfProfile } from "../data/hr-self-hooks";
import {
  ClockCaptureError,
  assertPlatformCredential,
  biometricUnavailableReason,
  captureFrame,
  openFrontCamera,
  readLocation,
  registerPlatformCredential,
  stopStream,
} from "../lib/clock-capture";
import { ToggleField } from "../settings/form-controls";
import { EMPTY } from "../lib/empty";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { AttendanceGrid } from "./AttendanceGrid";
import { ATTENDANCE_STATUS_KEY, ATTENDANCE_STATUS_TONE, formatWorkedDuration } from "./hr-leave-labels";

/** حضوري — the employee's own month and the web clock (hr.self.attendance / hr.self.clock). */

function shiftMonth(month: string, delta: number): string {
  const [year, monthPart] = month.split("-").map(Number);
  const total = (year ?? 1970) * 12 + (monthPart ?? 1) - 1 + delta;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function localMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function captureMessage(err: unknown, t: (key: AppTranslationKey) => string, fallback: string): string {
  if (err instanceof ClockCaptureError) return t(`self.capture.${err.failure}` as AppTranslationKey);
  if (err instanceof ApiError) return err.message;
  return fallback;
}

export function MyAttendanceScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const permissions = session?.permissions ?? [];
  const canClock = permissions.includes("*") || permissions.includes("hr.self.clock");

  const profile = useSelfProfile();
  const status = useSelfClockStatus(canClock);
  const [month, setMonth] = useState(localMonth);
  const attendance = useSelfAttendance(month);
  const challenge = useClockChallenge();
  const register = useRegisterClockCredential();
  const punch = useSelfClockPunch();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareLocation, setShareLocation] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [selfie, setSelfie] = useState<SelfieUploadDTO | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const employee = profile.data?.employee ?? null;
  const linked = profile.data?.employeeId != null;
  const clock = status.data;
  const action = clock?.openEntry ? SelfClockActionDTO.Out : SelfClockActionDTO.In;
  const dayComplete = !clock?.openEntry && clock?.todayEntry?.checkIn != null && clock.todayEntry.checkOut != null;
  const blockedOnRegistration = clock?.requireBiometric === true && !clock.biometricRegistered;

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    setCameraError(null);
    openFrontCamera()
      .then((stream) => {
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      })
      .catch((err: unknown) => setCameraError(captureMessage(err, t, t("self.clockCouldNotRecord"))));
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [cameraOpen, t]);

  async function send(photo: SelfieUploadDTO | null) {
    if (!clock) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: SelfClockPunchDTO = { action };
      if (photo) body.selfie = photo;
      if (clock.requireBiometric) {
        const options = await challenge.mutateAsync(ClockChallengePurposeDTO.Assert);
        body.biometric = await assertPlatformCredential(options);
      }
      if (shareLocation) {
        const location = await readLocation();
        if (location) body.location = location;
      }
      const result = await punch.mutateAsync(body);
      const time = action === SelfClockActionDTO.In ? result.entry.checkIn : result.entry.checkOut;
      setNotice(t(action === SelfClockActionDTO.In ? "self.punchedIn" : "self.punchedOut", { time: time ?? "" }));
      setCameraOpen(false);
      setSelfie(null);
    } catch (err) {
      setError(captureMessage(err, t, t("self.clockCouldNotRecord")));
    } finally {
      setBusy(false);
    }
  }

  async function startPunch() {
    if (busy || !clock) return;
    setError(null);
    setNotice(null);
    if (!clock.storageAvailable) {
      setError(t("self.storageUnavailable"));
      return;
    }
    if (clock.requireBiometric) {
      const reason = await biometricUnavailableReason();
      if (reason) {
        setError(t(`self.capture.${reason}` as AppTranslationKey));
        return;
      }
    }
    if (clock.requireSelfie) {
      setSelfie(null);
      setCameraOpen(true);
      return;
    }
    await send(null);
  }

  async function registerDevice() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const reason = await biometricUnavailableReason();
      if (reason) throw new ClockCaptureError(reason);
      const options = await challenge.mutateAsync(ClockChallengePurposeDTO.Register);
      await register.mutateAsync(await registerPlatformCredential(options));
      setNotice(t("self.deviceRegistered"));
    } catch (err) {
      setError(captureMessage(err, t, t("self.biometricFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function takePhoto() {
    if (!videoRef.current) return;
    try {
      setSelfie(await captureFrame(videoRef.current));
    } catch (err) {
      setCameraError(captureMessage(err, t, t("self.clockCouldNotRecord")));
    }
  }

  const entries: readonly AttendanceEntryDTO[] = attendance.data?.entries ?? EMPTY;
  const summary = useMemo(() => {
    const count = (codes: readonly AttendanceEntryDTO["status"][]) => entries.filter((e) => codes.includes(e.status)).length;
    return {
      present: count(["present", "late", "half_day"]),
      late: count(["late"]),
      absent: count(["absent"]),
      leave: count(["on_leave"]),
      worked: entries.reduce((sum, e) => sum + e.workedMinutes, 0),
    };
  }, [entries]);
  const sorted = useMemo(() => [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)), [entries]);

  const todayEntry = clock?.todayEntry ?? null;
  const openOvernight = clock?.openEntry && clock.openEntry.date !== clock.today ? clock.openEntry : null;

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-[16px]">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">{t("self.eyebrow")}</div>
        <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("self.myAttendance")}</h1>
      </div>

      {profile.isError ? (
        <Card className="p-[16px]">
          <p className="text-[13px] font-semibold text-danger-ink">{profile.error?.message ?? t("self.profileCouldNotLoad")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => profile.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {!profile.isLoading && !profile.isError && !linked ? (
        <Card className="p-[16px]">
          <p className="text-[13px] font-semibold text-ink">{t("self.notLinkedTitle")}</p>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("self.notLinkedBody")}</p>
        </Card>
      ) : null}

      {linked && canClock ? (
        <Card className="flex flex-col gap-[14px] p-[16px]">
          {status.isError ? (
            <p className="text-[13px] font-semibold text-danger-ink">{status.error?.message ?? t("self.clockCouldNotLoad")}</p>
          ) : null}
          {clock ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-[8px]">
                <span className="mz-num text-[12.5px] text-ink-muted">{t("self.serverTime", { time: clock.serverTime, date: clock.today })}</span>
                <span className="flex flex-wrap gap-[6px]">
                  {clock.requireSelfie ? <StatusPill label={t("self.needsSelfie")} tone="info" /> : null}
                  {clock.requireBiometric ? <StatusPill label={t("self.needsBiometric")} tone="info" /> : null}
                </span>
              </div>

              <div className="text-[14px] font-semibold text-ink" aria-live="polite">
                {openOvernight?.checkIn
                  ? t("self.openOvernight", { date: openOvernight.date, time: openOvernight.checkIn })
                  : todayEntry?.checkIn
                    ? todayEntry.checkOut
                      ? `${t("self.clockedInAt", { time: todayEntry.checkIn })} · ${t("self.clockedOutAt", { time: todayEntry.checkOut })}`
                      : t("self.clockedInAt", { time: todayEntry.checkIn })
                    : t("self.notClockedIn")}
              </div>
              {todayEntry?.checkOut ? (
                <div className="mz-num text-[12.5px] text-ink-muted">{t("self.workedToday", { duration: formatWorkedDuration(todayEntry.workedMinutes) })}</div>
              ) : null}

              {blockedOnRegistration ? (
                <div className="flex flex-col gap-[8px] rounded-md border border-border bg-surface-2 p-[12px]">
                  <p className="text-[12.5px] text-ink-muted">{t("self.registerDeviceHint")}</p>
                  <Button variant="primary" className="w-full justify-center py-[12px]" disabled={busy} onClick={() => void registerDevice()}>
                    {busy ? t("self.working") : t("self.registerDevice")}
                  </Button>
                </div>
              ) : null}

              <Button
                variant={action === SelfClockActionDTO.In ? "primary" : "default"}
                className="min-h-[88px] w-full justify-center rounded-lg text-[20px]"
                disabled={busy || dayComplete || blockedOnRegistration}
                onClick={() => void startPunch()}
              >
                {busy ? t("self.working") : dayComplete ? t("self.dayComplete") : action === SelfClockActionDTO.In ? t("self.clockIn") : t("self.clockOut")}
              </Button>

              <ToggleField label={t("self.shareLocation")} hint={t("self.shareLocationHint")} checked={shareLocation} onChange={setShareLocation} disabled={busy} />

              {error ? (
                <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div role="status" className="rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink">
                  {notice}
                </div>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {linked ? (
        <>
          <div className="flex items-center justify-between gap-[8px]">
            <Button size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={t("self.monthPrevious")}>
              {t("self.monthPrevious")}
            </Button>
            <span className="mz-num text-[15px] font-bold text-ink">{month}</span>
            <Button size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label={t("self.monthNext")}>
              {t("self.monthNext")}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-5">
            {[
              { label: t("self.daysPresent"), value: String(summary.present) },
              { label: t("self.daysLate"), value: String(summary.late) },
              { label: t("self.daysAbsent"), value: String(summary.absent) },
              { label: t("self.daysOnLeave"), value: String(summary.leave) },
              { label: t("self.workedHours"), value: formatWorkedDuration(summary.worked) },
            ].map((tile) => (
              <Card key={tile.label} className="p-[12px]">
                <div className="text-[11px] font-semibold text-ink-faint">{tile.label}</div>
                <div className="mz-num mt-[4px] text-[18px] font-bold text-ink">{tile.value}</div>
              </Card>
            ))}
          </div>

          {attendance.isError ? (
            <Card className="p-[16px]">
              <p className="text-[13px] font-semibold text-danger-ink">{attendance.error?.message ?? t("self.attendanceCouldNotLoad")}</p>
            </Card>
          ) : null}

          {employee ? <AttendanceGrid month={month} employees={[employee]} entries={entries} loading={attendance.isLoading} /> : null}

          {sorted.length > 0 ? (
            <Card className="divide-y divide-border">
              {sorted.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center justify-between gap-[8px] px-[14px] py-[10px]">
                  <div className="flex items-center gap-[10px]">
                    <span className="mz-num text-[13px] font-semibold text-ink">{entry.date}</span>
                    <StatusPill label={t(ATTENDANCE_STATUS_KEY[entry.status])} tone={ATTENDANCE_STATUS_TONE[entry.status]} />
                  </div>
                  <div className="mz-num flex gap-[14px] text-[12.5px] text-ink-muted">
                    <span>
                      {t("self.checkIn")}: {entry.checkIn ?? "—"}
                    </span>
                    <span>
                      {t("self.checkOut")}: {entry.checkOut ?? "—"}
                    </span>
                    <span>
                      {t("self.worked")}: {formatWorkedDuration(entry.workedMinutes)}
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          ) : !attendance.isLoading ? (
            <Card>
              <EmptyState title={t("self.noAttendance")} />
            </Card>
          ) : null}
        </>
      ) : null}

      <SidePanel open={cameraOpen} onClose={() => (busy ? undefined : setCameraOpen(false))} title={t("self.cameraTitle")} description={t("self.cameraHint")}>
        <div className="flex flex-col gap-[12px]">
          {cameraError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {cameraError}
            </div>
          ) : null}
          <video
            ref={videoRef}
            aria-label={t("self.cameraPreview")}
            className={`w-full rounded-md bg-surface-3 ${selfie ? "hidden" : ""}`}
            playsInline
            muted
          />
          {selfie ? <img alt={t("self.selfiePreview")} className="w-full rounded-md" src={`data:${selfie.mimeType};base64,${selfie.contentBase64}`} /> : null}
          {error ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {error}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-[9px]">
            {selfie ? (
              <>
                <Button disabled={busy} onClick={() => setSelfie(null)}>
                  {t("self.retake")}
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => void send(selfie)}>
                  {busy ? t("self.working") : t("self.confirmPunch")}
                </Button>
              </>
            ) : (
              <>
                <Button disabled={busy} onClick={() => setCameraOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" disabled={cameraError !== null} onClick={() => void takePhoto()}>
                  {t("self.capture")}
                </Button>
              </>
            )}
          </div>
        </div>
      </SidePanel>
    </div>
  );
}
