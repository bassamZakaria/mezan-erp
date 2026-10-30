import { useState } from "react";
import { Button } from "@mezan/ui";
import { useAppTranslation } from "../i18n";

export function TemporaryPasswordField({ label, password, fallback }: { label: string; password: string | null; fallback?: string }) {
  const { t } = useAppTranslation();
  const [copied, setCopied] = useState(false);
  const clipboard = navigator.clipboard as Clipboard | undefined;
  return (
    <div>
      <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-[10px]">
        <code dir="ltr" className="mz-num select-all break-all rounded-[6px] bg-surface px-[10px] py-[6px] text-[16px] font-bold text-ink">
          {password ?? fallback}
        </code>
        {clipboard && password ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void clipboard
                .writeText(password)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {t("common.copy")}
          </Button>
        ) : null}
        {copied ? <span className="text-[12px] text-ink-muted">{t("common.copied")}</span> : null}
      </div>
    </div>
  );
}
