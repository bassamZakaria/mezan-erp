import { useCallback } from "react";

/**
 * Save-to-PDF on the desktop edition (P-6).
 *
 * `useElectronPrintToPdf` hands the RENDERER the PDF bytes, and the renderer
 * has nowhere to put them: the app's sandbox makes an `<a download>` inert, so
 * every "PDF" button in the product either did nothing or silently reopened
 * the print dialog. `window.mezan.savePDF` renders the same DOM in the main
 * process, asks the operator where to save, and writes the file there.
 *
 * @mezan/ui declares the shape it needs locally rather than importing the
 * desktop app's types (the same rule `useElectronPrintToPdf` follows), so the
 * browser build carries no desktop dependency and `isAvailable` is false.
 */

export interface SavePdfOptions {
  pageSize?: "A4" | "A5";
  landscape?: boolean;
  /** Suggested file name, without extension or path. */
  defaultFileName?: string;
}

export type SavePdfOutcome =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

interface MezanSavePdfBridge {
  savePDF?(options?: SavePdfOptions): Promise<SavePdfOutcome>;
}

function getBridge(): MezanSavePdfBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { mezan?: MezanSavePdfBridge }).mezan;
}

export interface UseElectronSavePdfResult {
  /** True only inside the desktop edition, once the preload bridge has installed `savePDF`. */
  isAvailable: boolean;
  savePdf: (options?: SavePdfOptions) => Promise<SavePdfOutcome>;
}

export function useElectronSavePdf(): UseElectronSavePdfResult {
  const bridge = getBridge();
  const isAvailable = typeof bridge?.savePDF === "function";

  const savePdf = useCallback(async (options?: SavePdfOptions): Promise<SavePdfOutcome> => {
    const current = getBridge();
    if (typeof current?.savePDF !== "function") {
      throw new Error(
        "useElectronSavePdf: window.mezan.savePDF is unavailable — this is a desktop-only capability, guard calls with isAvailable first.",
      );
    }
    return current.savePDF(options);
  }, []);

  return { isAvailable, savePdf };
}
