/**
 * The symbologies the stock lookup scans for — a closed set, so it is
 * declared once here instead of as raw string literals passed straight to
 * `expo-camera`'s `barcodeScannerSettings`.
 */
export enum BarcodeSymbology {
  Ean13 = "ean13",
  Ean8 = "ean8",
  UpcA = "upc_a",
  UpcE = "upc_e",
  Code128 = "code128",
  Code39 = "code39",
}

export const STOCK_BARCODE_TYPES: readonly BarcodeSymbology[] = [
  BarcodeSymbology.Ean13,
  BarcodeSymbology.Ean8,
  BarcodeSymbology.UpcA,
  BarcodeSymbology.UpcE,
  BarcodeSymbology.Code128,
  BarcodeSymbology.Code39,
];
