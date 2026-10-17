import { useMemo, useState } from "react";
import { Button, Checkbox, EmptyState, Field, Select, TextInput } from "@mezan/ui";
import type { OneTimeCredentialDTO } from "@mezan/contracts";
import { useUsers } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { EMPTY } from "../../../lib/empty";
import { useCloneUser } from "./hooks";
import { Notice, NoticeTone, type NoticeState } from "./Notice";

const SOD_CONFLICT = "SOD_CONFLICT";
const CLONE_SEGMENT = "clone";

export interface CloneUserPanelProps {
  readonly onIssued: (credentials: readonly OneTimeCredentialDTO[], message: string) => void;
}

export function CloneUserPanel({ onIssued }: CloneUserPanelProps) {
  const { t } = useAppTranslation();
  const { segments } = useNavigation();
  const users = useUsers();
  const clone = useCloneUser();
  const requested = segments[0] === CLONE_SEGMENT ? (segments[1] ?? "") : "";
  const [picked, setPicked] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [needsAcknowledgement, setNeedsAcknowledgement] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const eligible = useMemo(
    () => (users.data ?? EMPTY).filter((user) => user.status === "active" && !user.isCompanyAdmin && user.roleId !== null && !user.erasedAt),
    [users.data],
  );
  const options = useMemo(() => eligible.map((user) => ({ value: user.id, label: `${user.nameAr} — ${user.email}` })), [eligible]);
  const sourceId = picked !== "" ? picked : eligible.some((user) => user.id === requested) ? requested : "";

  function submit() {
    if (clone.isPending || sourceId === "" || nameAr.trim() === "" || email.trim() === "") return;
    setNotice(null);
    const acknowledged = acknowledge && reason.trim() !== "";
    clone.mutate(
      {
        sourceId,
        body: {
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || null,
          email: email.trim(),
          phone: phone.trim() || null,
          ...(acknowledged ? { acknowledge: true, reason: reason.trim() } : {}),
        },
      },
      {
        onSuccess: (result) => {
          setNameAr("");
          setNameEn("");
          setEmail("");
          setPhone("");
          setNeedsAcknowledgement(false);
          setAcknowledge(false);
          setReason("");
          setNotice(null);
          onIssued(
            [result.credentials],
            `${t("provisioning.clone.created", { name: result.user.nameAr })} ${
              result.preferencesCopied ? t("provisioning.clone.preferencesCopied") : t("provisioning.clone.preferencesNotCopied")
            }`,
          );
        },
        onError: (error) => {
          if (error.code === SOD_CONFLICT) setNeedsAcknowledgement(true);
          setNotice({ tone: NoticeTone.Danger, message: error.message });
        },
      },
    );
  }

  if (!users.isLoading && eligible.length === 0) return <EmptyState title={t("provisioning.clone.noEligible")} />;

  return (
    <div className="flex max-w-[640px] flex-col gap-[12px]">
      <p className="text-[12.5px] text-ink-muted">{t("provisioning.clone.intro")}</p>
      <Notice notice={notice} />
      <Field label={t("provisioning.clone.source")} htmlFor="clone-source">
        <Select id="clone-source" value={sourceId} onChange={setPicked} options={options} placeholder={t("provisioning.clone.sourcePlaceholder")} />
      </Field>
      <Field label={t("provisioning.clone.nameAr")} htmlFor="clone-name-ar" required>
        <TextInput id="clone-name-ar" value={nameAr} onChange={(event) => setNameAr(event.target.value)} />
      </Field>
      <Field label={t("provisioning.clone.nameEn")} htmlFor="clone-name-en">
        <TextInput id="clone-name-en" dir="ltr" value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
      </Field>
      <Field label={t("provisioning.clone.email")} htmlFor="clone-email" required>
        <TextInput id="clone-email" type="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Field label={t("provisioning.clone.phone")} htmlFor="clone-phone">
        <TextInput id="clone-phone" type="tel" dir="ltr" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </Field>
      {needsAcknowledgement ? (
        <div className="flex flex-col gap-[8px] rounded-md border border-warning bg-warning-soft p-[12px]">
          <p className="text-[13px] font-bold text-warning-ink">{t("provisioning.clone.sodTitle")}</p>
          <p className="text-[12.5px] text-warning-ink">{t("provisioning.clone.sodBody")}</p>
          <Checkbox label={t("provisioning.clone.sodAcknowledge")} checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />
          <Field label={t("provisioning.clone.sodReason")} htmlFor="clone-reason">
            <TextInput id="clone-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={!acknowledge} />
          </Field>
        </div>
      ) : null}
      <div>
        <Button variant="primary" disabled={clone.isPending || sourceId === "" || nameAr.trim() === "" || email.trim() === ""} onClick={submit}>
          {clone.isPending ? t("provisioning.clone.submitting") : t("provisioning.clone.submit")}
        </Button>
      </div>
    </div>
  );
}
