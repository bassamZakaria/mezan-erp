import { useCallback } from "react";

/**
 * Desktop print-to-PDF capability hook (docs/plan.md §2.4 — "Desktop:
 * `webContents.printToPDF()` for silent PDF ... Identical DOM in both
 * [browser/desktop]"). apps/desktop exposes this over the same narrow
 * `window.mezan` IPC bridge used for `fetch` (see
 * apps/desktop/src/shared/ipc-contract.ts); @mezan/ui deliberately does NOT
 * import that app's types (same rule as PermissionMatrix.tsx keeping
 * @mezan/domain out) — it declares the minimal shape it needs locally and
 * checks for it at runtime, so the browser (`web`) build has zero desktop
 * dependency and `isAvailable` is false there.
 */

export interface PrintToPdfOptions {
  pageSize?: "A4" | "A5";
  landscape?: boolean;
}

interface MezanPrintBridge {
  printToPDF?(options?: PrintToPdfOptions): Promise<Uint8Array>;
}

function getBridge(): MezanPrintBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { mezan?: MezanPrintBridge }).mezan;
}

export interface UseElectronPrintToPdfResult {
  /** True only inside the Electron desktop edition, once the preload bridge has installed `printToPDF`. */
  isAvailable: boolean;
  /** Rejects if called when `isAvailable` is false — check it before offering a "Save as PDF" action. */
  printToPdf: (options?: PrintToPdfOptions) => Promise<Uint8Array>;
}

export function useElectronPrintToPdf(): UseElectronPrintToPdfResult {
  const bridge = getBridge();
  const isAvailable = typeof bridge?.printToPDF === "function";

  const printToPdf = useCallback(
    async (options?: PrintToPdfOptions): Promise<Uint8Array> => {
      const current = getBridge();
      if (typeof current?.printToPDF !== "function") {
        throw new Error(
          "useElectronPrintToPdf: window.mezan.printToPDF is unavailable — this is a desktop-only capability, guard calls with isAvailable first.",
        );
      }
      return current.printToPDF(options);
    },
    [],
  );

  return { isAvailable, printToPdf };
}
