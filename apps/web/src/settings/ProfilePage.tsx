import { useEffect, useState } from "react";
import { DocumentDetail, Button, Card, StatusPill, formatDate, type PillTone } from "@mezan/ui";
import type { AuditEventDTO, AuditSeverityDTO } from "@mezan/contracts";
import { useProfile, useUpdateProfile, useChangePassword, useChangePin, useProfileActivity } from "../data/account-hooks";
import { TextField, SectionCard } from "./form-controls";

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

const ACTION_LABELS: Readonly<Record<string, string>> = {
  PASSWORD_CHANGED: "تغيير كلمة المرور",
  PIN_CHANGED: "تغيير الرقم السري",
  PIN_CLEARED: "إلغاء الرقم السري",
};

function InfoTab() {
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

  if (profileQuery.isLoading) return <p className="text-[12.5px] text-ink-muted">جارٍ التحميل…</p>;
  if (!profile) return <p className="text-[12.5px] text-danger-ink">تعذّر تحميل بيانات الحساب.</p>;

  async function handleSave() {
    setMessage(null);
    try {
      await updateProfile.mutateAsync({ fullName, email, phone: phone.trim() === "" ? null : phone });
      setMessage({ kind: "ok", text: "تم حفظ بيانات الحساب." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "تعذر حفظ البيانات." });
    }
  }

  return (
    <SectionCard title="البيانات الأساسية" description="الاسم والبريد الإلكتروني ورقم الهاتف الخاصين بحسابك.">
      <TextField label="الاسم الكامل" value={fullName} onChange={setFullName} />
      <TextField label="البريد الإلكتروني" value={email} onChange={setEmail} type="email" />
      <TextField label="رقم الهاتف" value={phone} onChange={setPhone} type="tel" placeholder="اختياري" />
      <div className="col-span-full flex items-center gap-[10px]">
        <Button variant="primary" disabled={updateProfile.isPending} onClick={() => void handleSave()}>
          {updateProfile.isPending ? "جارٍ الحفظ…" : "حفظ التغييرات"}
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
      setPasswordMessage({ kind: "error", text: "كلمة المرور الجديدة وتأكيدها غير متطابقين." });
      return;
    }
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setPasswordMessage({ kind: "ok", text: "تم تغيير كلمة المرور." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordMessage({ kind: "error", text: err instanceof Error ? err.message : "تعذر تغيير كلمة المرور." });
    }
  }

  async function handleChangePin() {
    setPinMessage(null);
    try {
      await changePin.mutateAsync({ currentPassword: pinCurrentPassword, newPin: newPin.trim() === "" ? null : newPin });
      setPinMessage({ kind: "ok", text: newPin.trim() === "" ? "تم إلغاء الرقم السري." : "تم تغيير الرقم السري." });
      setPinCurrentPassword("");
      setNewPin("");
    } catch (err) {
      setPinMessage({ kind: "error", text: err instanceof Error ? err.message : "تعذر تغيير الرقم السري." });
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard title="تغيير كلمة المرور" description="يجب إدخال كلمة المرور الحالية للتحقق قبل تعيين كلمة جديدة.">
        <TextField label="كلمة المرور الحالية" value={currentPassword} onChange={setCurrentPassword} type="text" />
        <TextField label="كلمة المرور الجديدة" value={newPassword} onChange={setNewPassword} type="text" hint="8 أحرف على الأقل" />
        <TextField label="تأكيد كلمة المرور الجديدة" value={confirmPassword} onChange={setConfirmPassword} type="text" />
        <div className="col-span-full flex items-center gap-[10px]">
          <Button
            variant="primary"
            disabled={changePassword.isPending || !currentPassword || !newPassword}
            onClick={() => void handleChangePassword()}
          >
            {changePassword.isPending ? "جارٍ الحفظ…" : "تغيير كلمة المرور"}
          </Button>
          {passwordMessage ? (
            <span className={passwordMessage.kind === "ok" ? "text-[12.5px] text-success-ink" : "text-[12.5px] text-danger-ink"}>
              {passwordMessage.text}
            </span>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="الرقم السري (PIN)" description="يُستخدم لتسجيل الدخول السريع. اتركه فارغًا لإلغاء الرقم السري الحالي.">
        <TextField label="كلمة المرور الحالية" value={pinCurrentPassword} onChange={setPinCurrentPassword} type="text" />
        <TextField label="الرقم السري الجديد" value={newPin} onChange={setNewPin} type="text" hint="4 إلى 6 أرقام، أو اتركه فارغًا للإلغاء" />
        <div className="col-span-full flex items-center gap-[10px]">
          <Button variant="primary" disabled={changePin.isPending || !pinCurrentPassword} onClick={() => void handleChangePin()}>
            {changePin.isPending ? "جارٍ الحفظ…" : "حفظ"}
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

function activityLabel(event: AuditEventDTO): string {
  return ACTION_LABELS[event.action] ?? `${event.module}.${event.action}`;
}

function ActivityTab() {
  const activityQuery = useProfileActivity();
  const events = activityQuery.data ?? [];

  if (activityQuery.isLoading) return <p className="text-[12.5px] text-ink-muted">جارٍ التحميل…</p>;

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-[24px] text-center text-[12.5px] text-ink-muted">
        لا يوجد نشاط مسجّل على حسابك بعد.
      </div>
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-ink-muted">
            <th className="p-[10px] text-start font-semibold">الحدث</th>
            <th className="p-[10px] text-start font-semibold">الوحدة</th>
            <th className="p-[10px] text-start font-semibold">الخطورة</th>
            <th className="p-[10px] text-end font-semibold">التاريخ</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, i) => (
            <tr key={`${event.timestamp}-${i}`} className="border-b border-border last:border-b-0">
              <td className="p-[10px] text-ink">{activityLabel(event)}</td>
              <td className="p-[10px] text-ink-muted">{event.module}</td>
              <td className="p-[10px]">
                <StatusPill label={event.severity} tone={severityTone(event.severity)} />
              </td>
              <td className="mz-num p-[10px] text-end text-ink-muted">{formatDate(event.timestamp, { style: "long" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function ProfilePage() {
  const profileQuery = useProfile();
  const profile = profileQuery.data;

  return (
    <DocumentDetail
      title={profile?.fullName ?? "الملف الشخصي"}
      subtitle={profile?.email}
      statusLabel={profile ? (profile.isCompanyAdmin ? "مدير الشركة" : "مستخدم") : undefined}
      statusTone={profile?.isCompanyAdmin ? "success" : "neutral"}
      summary={
        profile
          ? [
              { label: "الرقم السري", value: profile.hasPin ? "مُفعّل" : "غير مُفعّل" },
              { label: "آخر تسجيل دخول", value: profile.lastLoginAt ? formatDate(profile.lastLoginAt, { style: "long" }) : "لا يوجد" },
              { label: "تاريخ الإنشاء", value: formatDate(profile.createdAt, { style: "long" }) },
            ]
          : []
      }
      tabs={[
        { key: "info", label: "البيانات", content: <InfoTab /> },
        { key: "security", label: "الأمان", content: <SecurityTab /> },
        { key: "activity", label: "النشاط", content: <ActivityTab /> },
      ]}
    />
  );
}
