import { useState, type ChangeEvent } from "react";
import { Button, Checkbox, Field, StatusPill, TextArea, TextInput } from "@mezan/ui";
import { USER_IMPORT_MAX_CSV_CHARS, UserImportRowStatusDTO, type OneTimeCredentialDTO, type UserImportProblemDTO, type UserImportReportDTO } from "@mezan/contracts";
import { USER_IMPORT_ROW_LIMIT, UserImportRowProblemCode } from "@mezan/domain";
import { useAppTranslation } from "../../../i18n";
import { useImportUsers } from "./hooks";
import { Notice, NoticeTone, type NoticeState } from "./Notice";

const SAMPLE_CSV = "name_ar,name_en,email,phone,role,branches,warehouses\nسلمى حسن,Salma Hassan,salma@example.com,01000000000,CASHIER,MAIN,WH-1\n";
const CSV_FILE_NAME = "users-import-sample.csv";

interface CheckedWith {
  readonly csv: string;
  readonly acknowledge: boolean;
  readonly reason: string;
}

export interface UserImportPanelProps {
  readonly onIssued: (credentials: readonly OneTimeCredentialDTO[], message: string) => void;
}

export function UserImportPanel({ onIssued }: UserImportPanelProps) {
  const { t, locale } = useAppTranslation();
  const importer = useImportUsers();
  const [csv, setCsv] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [reason, setReason] = useState("");
  const [report, setReport] = useState<UserImportReportDTO | null>(null);
  const [checkedWith, setCheckedWith] = useState<CheckedWith | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const pending = importer.isPending;
  const committing = pending && importer.variables?.dryRun === false;
  const arabic = locale === "ar";

  const problemText = (problem: UserImportProblemDTO) => (arabic ? problem.messageAr : problem.messageEn);
  const acknowledged = acknowledge && reason.trim() !== "";
  const ackFields = acknowledged ? { acknowledge: true, reason: reason.trim() } : {};
  const needsAcknowledgement = report?.rows.some((row) => row.problems.some((problem) => problem.code === UserImportRowProblemCode.SodConflict)) ?? false;
  const unchanged =
    checkedWith !== null && checkedWith.csv === csv && checkedWith.acknowledge === acknowledged && checkedWith.reason === (acknowledged ? reason.trim() : "");
  const canCommit = report !== null && report.digest !== null && unchanged && !pending;

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (text.length > USER_IMPORT_MAX_CSV_CHARS) {
        setNotice({ tone: NoticeTone.Danger, message: t("provisioning.import.fileTooLarge") });
        return;
      }
      setNotice(null);
      setCsv(text);
      setReport(null);
    };
    reader.readAsText(file);
  }

  function downloadSample() {
    const url = URL.createObjectURL(new Blob(["﻿", SAMPLE_CSV], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = CSV_FILE_NAME;
    link.click();
    URL.revokeObjectURL(url);
  }

  function check() {
    if (pending || csv.trim() === "") return;
    setNotice(null);
    importer.mutate(
      { csv, dryRun: true, ...ackFields },
      {
        onSuccess: (result) => {
          setReport(result);
          setCheckedWith({ csv, acknowledge: acknowledged, reason: acknowledged ? reason.trim() : "" });
        },
        onError: (error) => setNotice({ tone: NoticeTone.Danger, message: error.message }),
      },
    );
  }

  function commit() {
    if (!canCommit || report?.digest == null) return;
    importer.mutate(
      { csv, dryRun: false, digest: report.digest, ...ackFields },
      {
        onSuccess: (result) => {
          if (result.credentials.length > 0) {
            setCsv("");
            setReport(null);
            setCheckedWith(null);
            setNotice(null);
            onIssued(result.credentials, t("provisioning.import.done", { count: String(result.created) }));
            return;
          }
          setReport(result);
          setCheckedWith(null);
        },
        onError: (error) => setNotice({ tone: NoticeTone.Danger, message: error.message }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="max-w-[70ch] text-[12.5px] text-ink-muted">{t("provisioning.import.intro")}</p>
      <p className="max-w-[70ch] text-[12px] text-ink-faint">{t("provisioning.import.limit", { limit: String(USER_IMPORT_ROW_LIMIT) })}</p>
      <Notice notice={notice} />

      <Field label={t("provisioning.import.csvLabel")} htmlFor="user-import-csv">
        <TextArea
          id="user-import-csv"
          dir="ltr"
          rows={8}
          className="font-mono text-[12px]"
          value={csv}
          onChange={(event) => {
            setCsv(event.target.value);
            setNotice(null);
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-[9px]">
        <label className="text-[12.5px] font-semibold text-ink">
          {t("provisioning.import.chooseFile")}
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="ms-[8px] text-[12.5px] text-ink" />
        </label>
        <Button variant="ghost" size="sm" onClick={downloadSample}>
          {t("provisioning.import.downloadTemplate")}
        </Button>
      </div>

      {needsAcknowledgement || acknowledge ? (
        <div className="flex flex-col gap-[8px] rounded-md border border-warning bg-warning-soft p-[12px]">
          <p className="text-[13px] font-bold text-warning-ink">{t("provisioning.import.sodTitle")}</p>
          <p className="text-[12.5px] text-warning-ink">{t("provisioning.import.sodBody")}</p>
          <Checkbox label={t("provisioning.import.sodAcknowledge")} checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />
          <Field label={t("provisioning.import.sodReason")} htmlFor="user-import-reason">
            <TextInput id="user-import-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={!acknowledge} />
          </Field>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-[9px]">
        <Button disabled={pending || csv.trim() === ""} onClick={check}>
          {pending && !committing ? t("provisioning.import.checking") : t("provisioning.import.dryRun")}
        </Button>
        <Button variant="primary" disabled={!canCommit} onClick={commit}>
          {committing ? t("provisioning.import.committing") : t("provisioning.import.commit")}
        </Button>
      </div>
      {report !== null && !unchanged && checkedWith !== null ? (
        <p role="status" className="text-[12.5px] text-ink-muted">
          {t("provisioning.import.fileChanged")}
        </p>
      ) : null}

      {report ? <ImportReport report={report} problemText={problemText} /> : null}
    </div>
  );
}

interface ImportReportProps {
  readonly report: UserImportReportDTO;
  readonly problemText: (problem: UserImportProblemDTO) => string;
}

function ImportReport({ report, problemText }: ImportReportProps) {
  const { t } = useAppTranslation();
  const clean = report.digest !== null;
  return (
    <section aria-label={t("provisioning.import.rows")} className="flex flex-col gap-[10px]">
      {report.fileProblems.length > 0 ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          <p className="font-bold">{t("provisioning.import.fileProblems")}</p>
          <ul className="list-disc ps-[18px]">
            {report.fileProblems.map((problem, index) => (
              <li key={`${problem.code}-${index}`}>{problemText(problem)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p className="text-[13px] font-semibold text-ink">
            {t("provisioning.import.summary", {
              valid: String(report.summary.valid),
              total: String(report.summary.total),
              invalid: String(report.summary.invalid),
            })}
          </p>
          <p className="text-[12px] text-ink-muted">
            {report.seats.available === null
              ? t("provisioning.import.seatsUnlimited", { active: String(report.seats.active) })
              : t("provisioning.import.seats", { active: String(report.seats.active), available: String(report.seats.available) })}
          </p>
          <p className="text-[12.5px] text-ink-muted">{clean ? t("provisioning.import.ready") : t("provisioning.import.fixFirst")}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-ink-muted">
                  <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">{t("provisioning.import.col.row")}</th>
                  <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">{t("provisioning.import.col.name")}</th>
                  <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">{t("provisioning.import.col.email")}</th>
                  <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">{t("provisioning.import.col.role")}</th>
                  <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">{t("provisioning.import.col.status")}</th>
                  <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">{t("provisioning.import.col.problems")}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-b border-border align-top">
                    <td className="px-[8px] py-[6px]">{row.rowNumber}</td>
                    <td className="px-[8px] py-[6px]">{row.nameAr}</td>
                    <td className="px-[8px] py-[6px]" dir="ltr">{row.email}</td>
                    <td className="px-[8px] py-[6px]" dir="ltr">{row.roleCode}</td>
                    <td className="px-[8px] py-[6px]">
                      <StatusPill
                        tone={row.status === UserImportRowStatusDTO.Ok ? "success" : "danger"}
                        label={row.status === UserImportRowStatusDTO.Ok ? t("provisioning.import.status.ok") : t("provisioning.import.status.error")}
                      />
                    </td>
                    <td className="px-[8px] py-[6px] text-danger-ink">
                      {row.problems.map((problem, index) => (
                        <p key={`${problem.code}-${index}`}>{problemText(problem)}</p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
