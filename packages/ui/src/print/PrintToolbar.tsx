import { useState } from "react";
import { Button } from "../primitives/atoms";
import { useTranslation } from "../i18n";
import { useElectronSavePdf } from "./useElectronSavePdf";

enum PdfNoticeKind {
  Saved = "saved",
  Failed = "failed",
}

interface PdfNotice {
  readonly kind: PdfNoticeKind;
  readonly text: string;
}

export interface PrintToolbarProps {
  pageSize: "A4" | "A5";
  landscape?: boolean;
  defaultFileName?: string;
}

export function PrintToolbar({ pageSize, landscape = false, defaultFileName }: PrintToolbarProps) {
  const { t } = useTranslation();
  const { isAvailable, savePdf } = useElectronSavePdf();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<PdfNotice | null>(null);

  async function handleSavePdf() {
    setNotice(null);
    setSaving(true);
    try {
      const outcome = await savePdf({ pageSize, landscape, ...(defaultFileName ? { defaultFileName } : {}) });
      if (outcome.ok) setNotice({ kind: PdfNoticeKind.Saved, text: t("ui.report.pdfSaved", { path: outcome.path }) });
      else if (!outcome.cancelled) setNotice({ kind: PdfNoticeKind.Failed, text: outcome.message });
    } catch {
      setNotice({ kind: PdfNoticeKind.Failed, text: t("print.toolbar.pdfFailed") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-[14px] print:hidden">
      <div className="flex items-center gap-[9px]">
        <Button variant="primary" onClick={() => window.print()}>
          {t("print.toolbar.print")}
        </Button>
        {isAvailable ? (
          <Button variant="default" disabled={saving} onClick={() => void handleSavePdf()}>
            {saving ? t("ui.report.savingPdf") : t("print.toolbar.savePdf")}
          </Button>
        ) : null}
      </div>
      {notice ? (
        <p
          role={notice.kind === PdfNoticeKind.Failed ? "alert" : "status"}
          className={notice.kind === PdfNoticeKind.Failed ? "mt-[8px] text-[13px] text-danger" : "mt-[8px] text-[13px] text-ink-muted"}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
