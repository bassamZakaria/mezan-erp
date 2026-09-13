import { Button } from "../primitives/atoms";
import { useTranslation } from "../i18n";
import { useElectronPrintToPdf } from "./useElectronPrintToPdf";

/**
 * The on-screen print controls shared by every printable view (`PrintView`,
 * `LabelSheetView`). It is `print:hidden`, so it never reaches paper, and it
 * owns the ONE pair of output paths: `window.print()` in the browser and
 * `webContents.printToPDF` on the desktop.
 */
export function PrintToolbar({ pageSize, landscape = false }: { pageSize: "A4" | "A5"; landscape?: boolean }) {
  const { t } = useTranslation();
  const { isAvailable, printToPdf } = useElectronPrintToPdf();

  return (
    <div className="mb-[14px] flex items-center gap-[9px] print:hidden">
      <Button variant="primary" onClick={() => window.print()}>
        {t("print.toolbar.print")}
      </Button>
      {isAvailable ? (
        <Button
          variant="default"
          onClick={() => {
            void printToPdf({ pageSize, landscape });
          }}
        >
          {t("print.toolbar.savePdf")}
        </Button>
      ) : null}
    </div>
  );
}
