import { useState } from "react";
import { Button, Card, EmptyState, Skeleton, StatusPill, useFormat, type PillTone } from "@mezan/ui";
import type { EvidencePackRecordDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";
import { Notice, NoticeTone, type NoticeState } from "../provisioning/Notice";
import { saveTextFile, useBuildEvidencePack, useEvidencePacks, useEvidencePublicKey } from "./hooks";
import { EvidenceCode, PeriodFields, defaultPeriod, isValidPeriod, useGrants } from "./PeriodFields";

const PEM_TYPE = "application/x-pem-file";
const PEM_FILE = "mezan-evidence-public-key.pem";
const BYTES_PER_KB = 1024;
const SKELETON_LINES = 3;

enum ChainState {
  Ok = "ok",
  Broken = "broken",
}

const CHAIN_TONE: Readonly<Record<ChainState, PillTone>> = {
  [ChainState.Ok]: "success",
  [ChainState.Broken]: "danger",
};

function PublicKeyCard() {
  const { t } = useAppTranslation();
  const key = useEvidencePublicKey();
  const [copied, setCopied] = useState(false);
  if (key.isPending) return <Skeleton lines={SKELETON_LINES} />;
  if (key.isError) return <Notice notice={{ tone: NoticeTone.Danger, message: key.error.message }} />;
  const copy = async () => {
    await navigator.clipboard?.writeText(key.data.publicKeyHex);
    setCopied(true);
  };
  return (
    <Card className="flex flex-col gap-[10px] p-[16px]">
      <h2 className="text-[15px] font-bold text-ink">{t("evidence.key.title")}</h2>
      <p className="text-[12.5px] text-ink-muted">{t("evidence.key.body")}</p>
      <dl className="grid grid-cols-1 gap-[6px] text-[12.5px] sm:grid-cols-[max-content_1fr]">
        <dt className="text-ink-muted">{t("evidence.key.id")}</dt>
        <dd className="font-mono text-ink" dir="ltr">{key.data.keyId}</dd>
        <dt className="text-ink-muted">{t("evidence.key.hex")}</dt>
        <dd className="break-all font-mono text-ink" dir="ltr">{key.data.publicKeyHex}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button size="sm" onClick={() => void copy()}>{t("evidence.key.copy")}</Button>
        <Button size="sm" variant="ghost" onClick={() => saveTextFile(PEM_FILE, key.data.publicKeyPem, PEM_TYPE)}>{t("evidence.key.downloadPem")}</Button>
        {copied ? <span role="status" className="text-[12px] text-success-ink">{t("evidence.key.copied")}</span> : null}
      </div>
    </Card>
  );
}

function VerifyCard() {
  const { t } = useAppTranslation();
  return (
    <Card className="flex flex-col gap-[8px] p-[16px]">
      <h2 className="text-[15px] font-bold text-ink">{t("evidence.verify.title")}</h2>
      <ol className="list-decimal space-y-[6px] ps-[18px] text-[12.5px] text-ink">
        <li>{t("evidence.verify.step1")}</li>
        <li>
          {t("evidence.verify.step2")}
          <pre className="mt-[4px] overflow-x-auto rounded-md bg-surface-3 p-[8px] font-mono text-[11.5px]" dir="ltr">
            {"pnpm evidence:verify mezan-evidence.zip <public-key-hex>\nbase64 -d manifest.sig > manifest.sig.bin\nopenssl pkeyutl -verify -pubin -inkey mezan-evidence-public-key.pem -rawin -in manifest.json -sigfile manifest.sig.bin"}
          </pre>
        </li>
        <li>{t("evidence.verify.step3")}</li>
      </ol>
      <p className="text-[12px] text-warning-ink">{t("evidence.verify.notice")}</p>
    </Card>
  );
}

function HistoryTable() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const packs = useEvidencePacks();
  if (packs.isPending) return <Skeleton lines={SKELETON_LINES} />;
  if (packs.isError) return <Notice notice={{ tone: NoticeTone.Danger, message: packs.error.message }} />;
  if (packs.data.length === 0) return <EmptyState title={t("evidence.historyEmpty")} />;
  const chain = (pack: EvidencePackRecordDTO) => (pack.auditChainOk ? ChainState.Ok : ChainState.Broken);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-start text-ink-muted">
            <th className="px-[8px] py-[6px] text-start font-medium">{t("evidence.col.builtAt")}</th>
            <th className="px-[8px] py-[6px] text-start font-medium">{t("evidence.col.period")}</th>
            <th className="px-[8px] py-[6px] text-start font-medium">{t("evidence.col.builtBy")}</th>
            <th className="px-[8px] py-[6px] text-end font-medium">{t("evidence.col.files")}</th>
            <th className="px-[8px] py-[6px] text-end font-medium">{t("evidence.col.size")}</th>
            <th className="px-[8px] py-[6px] text-start font-medium">{t("evidence.col.chain")}</th>
            <th className="px-[8px] py-[6px] text-start font-medium">{t("evidence.col.manifest")}</th>
          </tr>
        </thead>
        <tbody>
          {packs.data.map((pack) => (
            <tr key={pack.id} className="border-b border-border">
              <td className="px-[8px] py-[6px]">{format.dateTime(pack.builtAt)}</td>
              <td className="px-[8px] py-[6px]">
                <span className="mz-num">{format.date(pack.periodFrom)}</span> — <span className="mz-num">{format.date(pack.periodTo)}</span>
              </td>
              <td className="px-[8px] py-[6px]">{pack.builtByName}</td>
              <td className="px-[8px] py-[6px] text-end mz-num">{format.number(pack.fileCount)}</td>
              <td className="px-[8px] py-[6px] text-end mz-num">{t("evidence.sizeKb", { size: format.number(Math.ceil(pack.totalBytes / BYTES_PER_KB)) })}</td>
              <td className="px-[8px] py-[6px]">
                <StatusPill tone={CHAIN_TONE[chain(pack)]} label={pack.auditChainOk ? t("evidence.chainOk") : t("evidence.chainBroken")} />
              </td>
              <td className="max-w-[260px] truncate px-[8px] py-[6px] font-mono text-[11.5px]" dir="ltr" title={pack.manifestSha256}>
                {pack.manifestSha256}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EvidencePackScreen() {
  const { t } = useAppTranslation();
  const [mayView, mayBuild] = useGrants(EvidenceCode.View, EvidenceCode.Build);
  const build = useBuildEvidencePack();
  const [period, setPeriod] = useState(defaultPeriod);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  if (!mayView) return <EmptyState title={t("evidence.noAccessTitle")} description={t("evidence.noAccessBody")} />;

  const submit = () => {
    if (!isValidPeriod(period)) {
      setNotice({ tone: NoticeTone.Danger, message: t("evidence.invalidPeriod") });
      return;
    }
    if (build.isPending) return;
    setNotice(null);
    build.mutate(period, {
      onSuccess: (built) => {
        if (built.cancelled) return;
        setNotice({ tone: NoticeTone.Success, message: t("evidence.built", { sha: built.manifestSha256 }) });
      },
      onError: (error) => setNotice({ tone: NoticeTone.Danger, message: error.message }),
    });
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-[16px]">
      <div>
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("evidence.title")}</h1>
        <p className="mt-[5px] max-w-[80ch] text-[12.5px] text-ink-muted">{t("evidence.subtitle")}</p>
      </div>
      <Card className="flex flex-col gap-[12px] p-[16px]">
        <PeriodFields value={period} onChange={setPeriod} />
        {mayBuild ? (
          <div className="flex flex-wrap items-center gap-[10px]">
            <Button variant="primary" disabled={build.isPending} aria-busy={build.isPending} onClick={submit}>
              {build.isPending ? t("evidence.building") : t("evidence.build")}
            </Button>
            <p className="text-[12px] text-ink-muted">{t("evidence.buildHint")}</p>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("evidence.noBuild")}</p>
        )}
        <Notice notice={notice} />
      </Card>
      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <PublicKeyCard />
        <VerifyCard />
      </div>
      <section className="flex flex-col gap-[8px]">
        <h2 className="text-[15px] font-bold text-ink">{t("evidence.history")}</h2>
        <HistoryTable />
      </section>
    </div>
  );
}
