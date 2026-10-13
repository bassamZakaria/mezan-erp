export const IMPORT_ROW_LIMIT = 5000;

export enum ImportRefusal {
  TooLarge = "IMPORT_TOO_LARGE",
}

export interface BilingualSentence {
  readonly ar: string;
  readonly en: string;
}

// EXTERNAL CONTRACT: the server's 413 and every client's refusal before upload
// are this one sentence. A client that words its own drifts from the server's.
export function importTooLargeMessage(rows: number, limit: number = IMPORT_ROW_LIMIT): BilingualSentence {
  return {
    ar: `الملف يحتوي ${rows} صفًا، والحد الأقصى للاستيراد في المرة الواحدة ${limit} صف. قسّم الملف إلى أجزاء واستورد كل جزء على حدة.`,
    en: `The file holds ${rows} rows and one import takes at most ${limit}. Split the file and import each part separately.`,
  };
}

export function importLimitNotice(limit: number = IMPORT_ROW_LIMIT): BilingualSentence {
  return {
    ar: `الحد الأقصى للاستيراد في المرة الواحدة ${limit} صف. قسّم الملف الأكبر إلى أجزاء واستورد كل جزء على حدة.`,
    en: `One import takes at most ${limit} rows. Split a larger file and import each part separately.`,
  };
}

export function linesOfCsvImport(csv: string): number {
  return csv.split("\n").filter((line) => line.trim() !== "").length;
}
