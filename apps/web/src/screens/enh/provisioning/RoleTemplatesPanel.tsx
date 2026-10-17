import { useState } from "react";
import { Button, Card, EmptyState, Field, Skeleton, TextInput } from "@mezan/ui";
import type { RoleTemplateDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";
import { getPermission } from "@mezan/domain";
import { permissionLabel } from "../../../permission-labels";
import { useCreateRoleFromTemplate, useRoleTemplates } from "./hooks";
import { Notice, NoticeTone, type NoticeState } from "./Notice";

const SKELETON_LINES = 4;

interface TemplateCardProps {
  readonly template: RoleTemplateDTO;
  readonly active: boolean;
  readonly onUse: () => void;
}

function TemplateCard({ template, active, onUse }: TemplateCardProps) {
  const { t, locale } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const arabic = locale === "ar";
  return (
    <Card className="flex flex-col gap-[8px] p-[14px]">
      <h3 className="text-[15px] font-bold text-ink">{arabic ? template.nameAr : template.nameEn}</h3>
      <p className="text-[12.5px] text-ink-muted">{arabic ? template.descriptionAr : template.descriptionEn}</p>
      <p className="text-[12px] text-ink-muted">{t("provisioning.templates.permissionCount", { count: String(template.permissions.length) })}</p>
      {template.omittedPermissions.length > 0 ? (
        <p className="text-[12px] text-warning-ink">{t("provisioning.templates.omitted", { count: String(template.omittedPermissions.length) })}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button variant="primary" size="sm" disabled={active} onClick={onUse}>
          {t("provisioning.templates.use")}
        </Button>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? t("provisioning.templates.hide") : t("provisioning.templates.show")}
        </Button>
      </div>
      {open ? (
        <ul className="max-h-[220px] list-disc overflow-auto ps-[18px] text-[12px] text-ink">
          {template.permissions.map((code) => {
            const def = getPermission(code);
            return (
              <li key={code}>
                {def ? permissionLabel(def, t) : code} <span className="font-mono text-ink-muted" dir="ltr">{code}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}

export function RoleTemplatesPanel() {
  const { t, locale } = useAppTranslation();
  const query = useRoleTemplates();
  const create = useCreateRoleFromTemplate();
  const [chosen, setChosen] = useState<RoleTemplateDTO | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);

  function choose(template: RoleTemplateDTO) {
    setChosen(template);
    setName(locale === "ar" ? template.nameAr : template.nameEn);
    setCode("");
    setNotice(null);
  }

  function submit() {
    if (!chosen || create.isPending) return;
    const template = chosen;
    create.mutate(
      { templateId: template.id, ...(name.trim() ? { name: name.trim() } : {}), ...(code.trim() ? { code: code.trim().toUpperCase() } : {}) },
      {
        onSuccess: (role) => {
          setChosen(null);
          setNotice({
            tone: NoticeTone.Success,
            message:
              role.omittedPermissions.length > 0
                ? t("provisioning.templates.createdOmitted", { name: role.name, code: role.code, count: String(role.omittedPermissions.length) })
                : t("provisioning.templates.created", { name: role.name, code: role.code }),
          });
        },
        onError: (error) => setNotice({ tone: NoticeTone.Danger, message: error.message }),
      },
    );
  }

  if (query.isLoading) return <Skeleton lines={SKELETON_LINES} />;
  if (query.isError) return <Notice notice={{ tone: NoticeTone.Danger, message: query.error.message }} />;
  const templates = query.data ?? [];
  if (templates.length === 0) return <EmptyState title={t("provisioning.templates.empty")} />;

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="max-w-[70ch] text-[12.5px] text-ink-muted">{t("provisioning.templates.intro")}</p>
      <Notice notice={notice} />
      {chosen ? (
        <Card className="flex flex-col gap-[10px] p-[14px]">
          <h3 className="text-[14px] font-bold text-ink">
            {t("provisioning.templates.formTitle", { template: locale === "ar" ? chosen.nameAr : chosen.nameEn })}
          </h3>
          <div className="grid gap-[12px] sm:grid-cols-2">
            <Field label={t("provisioning.templates.roleName")} htmlFor="template-role-name">
              <TextInput id="template-role-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={t("provisioning.templates.roleCode")} hint={t("provisioning.templates.codeHint")} htmlFor="template-role-code">
              <TextInput id="template-role-code" dir="ltr" value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
          </div>
          <div className="flex gap-[9px]">
            <Button variant="primary" disabled={create.isPending} onClick={submit}>
              {create.isPending ? t("provisioning.templates.creating") : t("provisioning.templates.create")}
            </Button>
            <Button disabled={create.isPending} onClick={() => setChosen(null)}>
              {t("provisioning.templates.cancel")}
            </Button>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-[12px] md:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard key={template.id} template={template} active={chosen?.id === template.id} onUse={() => choose(template)} />
        ))}
      </div>
    </div>
  );
}
