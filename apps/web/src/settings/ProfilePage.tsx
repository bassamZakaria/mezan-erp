import { useEffect, useRef, useState } from "react";
import { DocumentDetail, Button, Card, StatusPill, formatDate, type PillTone } from "@mezan/ui";
import type { AuditEventDTO, AuditSeverityDTO } from "@mezan/contracts";
import { useProfile, useUpdateProfile, useChangePassword, useProfileActivity } from "../data/account-hooks";
import { useCredentialsInFirebase } from "../data/hooks";
import { TextField, SectionCard } from "./form-controls";
import { squarePhotoDataUrl } from "./photo";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * الملف الشخصي (self-service profile, `/settings/profile`) — the SIGNED-IN
 * user's own account. Unlike `UsersPage` (admin, gated on `admin.users.*`,
 * any user), every action here is scoped to the caller's own id by the API
 * (`profile-routes.ts`) — there is no user picker and no permission gate.
 */

/** Two initials for the fallback disc — the same shape the shell's avatar uses. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? "")][0] ?? "؟";
  const second = [...(parts[1] ?? "")][0] ?? "";
  return second ? `${first}.${second}` : first;
}

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
  PIN_CHANGED: "profile.legacyCodeChanged",
  PIN_CLEARED: "profile.legacyCodeCleared",
};

function InfoTab() {
  const { t, locale } = useAppTranslation();
  const credentialsInFirebase = useCredentialsInFirebase();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const profile = profileQuery.data;

  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [emailPassword, setEmailPassword] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!profile) return;
    setNameAr(profile.nameAr);
    setNameEn(profile.nameEn ?? "");
    setEmail(profile.email);
    setPhone(profile.phone ?? "");
    setPhotoUrl(profile.photoUrl ?? null);
  }, [profile]);

  if (profileQuery.isLoading) return <p className="text-[12.5px] text-ink-muted">{t("common.loading")}</p>;
  if (!profile) return <p className="text-[12.5px] text-danger-ink">{t("profile.couldNotLoadTheAccount")}</p>;
  const emailChanges = email.trim().toLowerCase() !== profile.email.trim().toLowerCase();

  async function handlePickPhoto(file: File) {
    setMessage(null);
    try {
      // Downscaled and re-encoded here, not stored as picked: the row holds the
      // string itself, so a 4MB camera JPEG would otherwise travel with every
      // user read. 256px square at JPEG q0.85 lands around 20KB.
      setPhotoUrl(await squarePhotoDataUrl(file, 256));
    } catch {
      setMessage({ kind: "error", text: t("profile.photoUnreadable") });
    }
  }

  async function handleSave() {
    setMessage(null);
    try {
      await updateProfile.mutateAsync({
        nameAr,
        nameEn: nameEn.trim() === "" ? null : nameEn,
        email,
        phone: phone.trim() === "" ? null : phone,
        photoUrl,
        ...(emailChanges ? { currentPassword: emailPassword } : {}),
      });
      setEmailPassword("");
      setMessage({ kind: "ok", text: t("profile.theAccountDetailsWereSaved") });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : t("profile.couldNotSaveTheDetails") });
    }
  }

  return (
    <SectionCard title={t("profile.coreDetails")} description={t("profile.yourAccountSNameEmail")}>
      <div className="col-span-full flex items-center gap-[14px]">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="h-[72px] w-[72px] flex-none rounded-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full bg-accent font-display text-[22px] font-extrabold text-accent-ink"
          >
            {initialsOf(nameAr)}
          </span>
        )}
        <div className="flex flex-col gap-[6px]">
          <span className="text-[12.5px] font-semibold text-ink">{t("profile.photo")}</span>
          <span className="text-[11.5px] text-ink-faint">{t("profile.photoHint")}</span>
          <div className="flex gap-[8px]">
            <Button onClick={() => fileRef.current?.click()}>{t("profile.photoChoose")}</Button>
            {photoUrl ? (
              <Button variant="danger-outline" onClick={() => setPhotoUrl(null)}>
                {t("profile.photoRemove")}
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handlePickPhoto(file);
            }}
          />
        </div>
      </div>
      <TextField label={t("users.nameAr")} value={nameAr} onChange={setNameAr} />
      <TextField label={t("users.nameEn")} value={nameEn} onChange={setNameEn} placeholder={t("users.nameEnOptional")} />
      <TextField
        label={t("common.email")}
        value={email}
        onChange={setEmail}
        type="email"
        disabled={credentialsInFirebase}
        hint={credentialsInFirebase ? t("login.firebase.emailByAdmin") : undefined}
      />
      {emailChanges && !credentialsInFirebase ? (
        <TextField
          label={t("profile.currentPassword")}
          value={emailPassword}
          onChange={setEmailPassword}
          type="password"
          hint={t("profile.emailChangeNeedsPassword")}
        />
      ) : null}
      <TextField label={t("profile.phoneNumber")} value={phone} onChange={setPhone} type="tel" placeholder={t("profile.optional")} />
      <div className="col-span-full flex items-center gap-[10px]">
        <Button variant="primary" disabled={updateProfile.isPending || (emailChanges && emailPassword === "")} onClick={() => void handleSave()}>
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
  const credentialsInFirebase = useCredentialsInFirebase();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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

  if (credentialsInFirebase) {
    return (
      <div className="flex flex-col gap-[16px]">
        <SectionCard title={t("profile.changeThePassword")} description={t("login.firebase.managedHere")}>
          {null}
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard title={t("profile.changeThePassword")} description={t("profile.enterTheCurrentPasswordTo")}>
        <TextField label={t("profile.currentPassword")} value={currentPassword} onChange={setCurrentPassword} type="password" autoComplete="current-password" />
        <TextField label={t("profile.newPassword")} value={newPassword} onChange={setNewPassword} type="password" autoComplete="new-password" hint={t("profile.atLeast8Characters")} />
        <TextField label={t("profile.confirmTheNewPassword")} value={confirmPassword} onChange={setConfirmPassword} type="password" autoComplete="new-password" />
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
      title={profile?.nameAr ?? t("profile.profile")}
      subtitle={profile?.email}
      statusLabel={profile ? (profile.isCompanyAdmin ? t("profile.companyAdministrator") : t("profile.user")) : undefined}
      statusTone={profile?.isCompanyAdmin ? "success" : "neutral"}
      summary={
        profile
          ? [
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
