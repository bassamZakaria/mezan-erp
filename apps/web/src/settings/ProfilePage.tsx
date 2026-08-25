import { useEffect, useState } from "react";
import { DocumentDetail, Button, Card, StatusPill, formatDate, type PillTone } from "@mezan/ui";
import type { AuditEventDTO, AuditSeverityDTO } from "@mezan/contracts";
import { useProfile, useUpdateProfile, useChangePassword, useChangePin, useProfileActivity } from "../data/account-hooks";
import { TextField, SectionCard } from "./form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * الملف الشخصي (self-service profile, `/settings/profile`) — the SIGNED-IN
 * user's own account. Unlike `UsersPage` (admin, gated on `admin.users.*`,
 * any user), every action here is scoped to the caller's own id by the API
 * (`profile-routes.ts`) — there is no user picker and no permission gate.
 */

function severityTone(severity: AuditSeverityDTO): PillTone {
  switch (severity) {
    case "CRITICAL":
      return "danger";
    case "ERROR":
      return "danger";
    case "WARNING":
      return "warning";
    default:
      return "info";
  }
}

const ACTION_KEYS: Readonly<Record<string, AppTranslationKey>> = {
  PASSWORD_CHANGED: "profile.changeThePassword",
  PIN_CHANGED: "profile.changeThePin",
  PIN_CLEARED: "profile.clearThePin",
};

function InfoTab() {
  const { t, locale } = useAppTranslation();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const profile = profileQuery.data;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.fullName);
    setEmail(profile.email);
    setPhone(profile.phone ?? "");
  }, [profile]);

  if (profileQuery.isLoading) return <p className="text-[12.5px] text-ink-muted">{t("common.loading")}</p>;
  if (!profile) return <p className="text-[12.5px] text-danger-ink">{t("profile.couldNotLoadTheAccount")}</p>;

  async function handleSave() {
    setMessage(null);
    try {
      await updateProfile.mutateAsync({ fullName, email, phone: phone.trim() === "" ? null : phone });
      setMessage({ kind: "ok", text: t("profile.theAccountDetailsWereSaved") });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : t("profile.couldNotSaveTheDetails") });
    }
  }

  return (
    <SectionCard title={t("profile.coreDetails")} description={t("profile.yourAccountSNameEmail")}>
      <TextField label={t("profile.fullName")} value={fullName} onChange={setFullName} />
      <TextField label={t("common.email")} value={email} onChange={setEmail} type="email" />
      <TextField label={t("profile.phoneNumber")} value={phone} onChange={setPhone} type="tel" placeholder={t("profile.optional")} />
      <div className="col-span-full flex items-center gap-[10px]">
        <Button variant="primary" disabled={updateProfile.isPending} onClick={() => void handleSave()}>
          {updateProfile.isPending ? t("profile.saving") : t("profile.saveTheChanges")}
        </Button>
        {message ? (
          <span className={message.kind === "ok" ? "text-[12.5px] text-success-ink" : "text-[12.5px] text-danger-ink"}>
            {message.text}
          </span>
        ) : null}
      </div>
    </SectionCard>
  );
}

function SecurityTab() {
  const { t, locale } = useAppTranslation();
  const changePassword = useChangePassword();
  const changePin = useChangePin();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [pinCurrentPassword, setPinCurrentPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinMessage, setPinMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function handleChangePassword() {
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ kind: "error", text: t("profile.theNewPasswordAndIts") });
      return;
    }
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setPasswordMessage({ kind: "ok", text: t("profile.thePasswordWasChanged") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordMessage({ kind: "error", text: err instanceof Error ? err.message : t("profile.couldNotChangeThePassword") });
    }
  }

  async function handleChangePin() {
    setPinMessage(null);
    try {
      await changePin.mutateAsync({ currentPassword: pinCurrentPassword, newPin: newPin.trim() === "" ? null : newPin });
      setPinMessage({ kind: "ok", text: newPin.trim() === "" ? t("profile.thePinWasCleared") : t("profile.thePinWasChanged") });
      setPinCurrentPassword("");
      setNewPin("");
    } catch (err) {
      setPinMessage({ kind: "error", text: err instanceof Error ? err.message : t("profile.couldNotChangeThePin") });
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard title={t("profile.changeThePassword")} description={t("profile.enterTheCurrentPasswordTo")}>
        <TextField label={t("profile.currentPassword")} value={currentPassword} onChange={setCurrentPassword} type="text" />
        <TextField label={t("profile.newPassword")} value={newPassword} onChange={setNewPassword} type="text" hint={t("profile.atLeast8Characters")} />
        <TextField label={t("profile.confirmTheNewPassword")} value={confirmPassword} onChange={setConfirmPassword} type="text" />
        <div className="col-span-full flex items-center gap-[10px]">
          <Button
            variant="primary"
            disabled={changePassword.isPending || !currentPassword || !newPassword}
            onClick={() => void handleChangePassword()}
          >
            {changePassword.isPending ? t("profile.saving") : t("profile.changeThePassword")}
          </Button>
          {passwordMessage ? (
            <span className={passwordMessage.kind === "ok" ? "text-[12.5px] text-success-ink" : "text-[12.5px] text-danger-ink"}>
              {passwordMessage.text}
            </span>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title={t("profile.pin")} description={t("profile.usedForAQuickSign")}>
        <TextField label={t("profile.currentPassword")} value={pinCurrentPassword} onChange={setPinCurrentPassword} type="text" />
        <TextField label={t("profile.newPin")} value={newPin} onChange={setNewPin} type="text" hint={t("profile.4To6DigitsOr")} />
        <div className="col-span-full flex items-center gap-[10px]">
          <Button variant="primary" disabled={changePin.isPending || !pinCurrentPassword} onClick={() => void handleChangePin()}>
            {changePin.isPending ? t("profile.saving") : t("common.save")}
          </Button>
          {pinMessage ? (
            <span className={pinMessage.kind === "ok" ? "text-[12.5px] text-success-ink" : "text-[12.5px] text-danger-ink"}>
              {pinMessage.text}
            </span>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}

function activityLabel(event: AuditEventDTO, t: (key: AppTranslationKey) => string): string {
  const key = ACTION_KEYS[event.action];
  return key ? t(key) : `${event.module}.${event.action}`;
}

function ActivityTab() {
  const { t, locale } = useAppTranslation();
  const activityQuery = useProfileActivity();
  const events = activityQuery.data ?? [];

  if (activityQuery.isLoading) return <p className="text-[12.5px] text-ink-muted">{t("common.loading")}</p>;

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-[24px] text-center text-[12.5px] text-ink-muted">
        {t("profile.noActivityHasBeenRecorded")}
      </div>
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-ink-muted">
            <th className="p-[10px] text-start font-semibold">{t("profile.event")}</th>
            <th className="p-[10px] text-start font-semibold">{t("profile.module")}</th>
            <th className="p-[10px] text-start font-semibold">{t("profile.severity")}</th>
            <th className="p-[10px] text-end font-semibold">{t("common.date")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, i) => (
            <tr key={`${event.timestamp}-${i}`} className="border-b border-border last:border-b-0">
              <td className="p-[10px] text-ink">{activityLabel(event, t)}</td>
              <td className="p-[10px] text-ink-muted">{event.module}</td>
              <td className="p-[10px]">
                <StatusPill label={event.severity} tone={severityTone(event.severity)} />
              </td>
              <td className="mz-num p-[10px] text-end text-ink-muted">{formatDate(event.timestamp, { style: "long", locale })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function ProfilePage() {
  const { t, locale } = useAppTranslation();
  const profileQuery = useProfile();
  const profile = profileQuery.data;

  return (
    <DocumentDetail
      title={profile?.fullName ?? t("profile.profile")}
      subtitle={profile?.email}
      statusLabel={profile ? (profile.isCompanyAdmin ? t("profile.companyAdministrator") : t("profile.user")) : undefined}
      statusTone={profile?.isCompanyAdmin ? "success" : "neutral"}
      summary={
        profile
          ? [
              { label: t("profile.pin2"), value: profile.hasPin ? t("profile.set") : t("profile.notSet") },
              { label: t("profile.lastSignedIn"), value: profile.lastLoginAt ? formatDate(profile.lastLoginAt, { style: "long", locale }) : t("common.none") },
              { label: t("profile.createdOn"), value: formatDate(profile.createdAt, { style: "long", locale }) },
            ]
          : []
      }
      tabs={[
        { key: "info", label: t("profile.details"), content: <InfoTab /> },
        { key: "security", label: t("profile.security"), content: <SecurityTab /> },
        { key: "activity", label: t("profile.activity"), content: <ActivityTab /> },
      ]}
    />
  );
}
