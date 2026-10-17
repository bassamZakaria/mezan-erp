import type { ReactNode } from "react";
import { Card } from "@mezan/ui";
import type { IntegrationsCatalogDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { scopeLabelKey } from "./ApiKeysTab";

const VERIFY_SAMPLE = `import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMezanWebhook(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(\`\${parts.t}.\${rawBody}\`).digest("hex");
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === 32 && timingSafeEqual(given, Buffer.from(expected, "hex"));
}`;

const CURL_SAMPLE = (base: string) => `curl -H "Authorization: Bearer mzn_…" ${base}/customers

curl -X POST -H "Authorization: Bearer mzn_…" \\
     -H "Content-Type: application/json" \\
     -H "Idempotency-Key: order-1001" \\
     -d '{"nameAr":"عميل المتجر","phone":"01000000000"}' \\
     ${base}/customers`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[14px] font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Code({ text }: { text: string }) {
  return (
    <pre dir="ltr" className="overflow-x-auto rounded-md bg-surface-2 p-3 text-start font-mono text-[11.5px] leading-relaxed text-ink">
      {text}
    </pre>
  );
}

export function DeveloperGuideTab({ catalog }: { catalog: IntegrationsCatalogDTO }) {
  const { t } = useAppTranslation();
  const base = catalog.apiBasePath;
  const paragraph = (key: AppTranslationKey, params: Record<string, string | number> = {}) => <p className="text-[13px] leading-relaxed text-ink-muted">{t(key, params)}</p>;

  return (
    <Card className="flex flex-col gap-5 p-[18px_20px]">
      <div className="flex flex-col gap-2">
        {paragraph("integrations.docs.intro", { base, openapi: catalog.openApiPath })}
        <a className="text-[13px] font-semibold text-brand underline" href={catalog.openApiPath} target="_blank" rel="noreferrer">
          {t("integrations.docs.openapi")}
        </a>
      </div>
      <Section title={t("integrations.docs.authTitle")}>
        {paragraph("integrations.docs.authBody", { base })}
        <Code text={CURL_SAMPLE(base)} />
      </Section>
      <Section title={t("integrations.docs.scopesTitle")}>
        {paragraph("integrations.docs.scopesBody")}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <tbody>
              {catalog.scopes.map((option) => (
                <tr key={option.scope} className="border-b border-border">
                  <td className="p-2">
                    <code dir="ltr" className="font-mono">{option.scope}</code>
                  </td>
                  <td className="p-2">{t(scopeLabelKey(option.scope))}</td>
                  <td className="p-2">
                    <code dir="ltr" className="font-mono text-[11.5px] text-ink-faint">{option.permissions.join(", ")}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={t("integrations.docs.endpointsTitle")}>{paragraph("integrations.docs.endpointsBody")}</Section>
      <Section title={t("integrations.docs.idempotencyTitle")}>{paragraph("integrations.docs.idempotencyBody")}</Section>
      <Section title={t("integrations.docs.limitsTitle")}>{paragraph("integrations.docs.limitsBody", { limit: catalog.rateLimitPerMinute })}</Section>
      <Section title={t("integrations.docs.webhooksTitle")}>
        {paragraph("integrations.docs.webhooksBody", { header: catalog.signatureHeader, tolerance: catalog.signatureToleranceSeconds })}
        <Code text={VERIFY_SAMPLE} />
      </Section>
    </Card>
  );
}
