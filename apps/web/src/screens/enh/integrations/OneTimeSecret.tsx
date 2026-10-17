import { useState } from "react";
import { Button, Card } from "@mezan/ui";
import { useAppTranslation } from "../../../i18n";

export function OneTimeSecret({ title, body, secret, onDone }: { title: string; body: string; secret: string; onDone: () => void }) {
  const { t } = useAppTranslation();
  const [copied, setCopied] = useState(false);
  const clipboard = navigator.clipboard as Clipboard | undefined;

  function copy() {
    if (!clipboard) return;
    void clipboard.writeText(secret).then(() => setCopied(true));
  }

  return (
    <Card className="flex flex-col gap-3 border-warning p-[16px_18px]" role="status">
      <div>
        <h2 className="text-[14px] font-bold text-ink">{title}</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">{body}</p>
      </div>
      <code dir="ltr" className="block select-all break-all rounded-md bg-surface-2 p-3 text-start font-mono text-[12.5px] text-ink">
        {secret}
      </code>
      <div className="flex flex-wrap gap-2">
        {clipboard ? (
          <Button variant="default" onClick={copy}>
            {copied ? t("integrations.copied") : t("integrations.copy")}
          </Button>
        ) : null}
        <Button variant="primary" onClick={onDone}>
          {t("integrations.keys.tokenDone")}
        </Button>
      </div>
    </Card>
  );
}

export function ErrorNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-[13px] text-danger-ink">
      {message}
    </div>
  );
}
