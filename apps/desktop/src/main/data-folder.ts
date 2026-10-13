import { closeSync, existsSync, openSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/**
 * EXTERNAL CONTRACT with every install in the field and with docs/INSTALL.md:
 * the books live in `<appData>/Mezan`. Installs made before this did not say
 * so and landed in `<appData>/desktop`, the package's own name.
 *
 * INVARIANT: this module never copies and never merges. An existing folder is
 * either renamed whole — one atomic step on the same volume — or used exactly
 * where it is. Anything short of certainty resolves to the folder that holds
 * the books today.
 *
 * Free of any `electron` import, and every path is an argument: it is only
 * ever exercised against temporary directories.
 */
export const PRODUCT_DATA_FOLDER_NAME = "Mezan";
export const LEGACY_DATA_FOLDER_NAME = "desktop";

const BOOKS_FILES = ["mezan.db", "client.json"] as const;
const MOVE_LOCK_NAME = ".mezan-data-folder.lock";

export enum DataFolderChoice {
  Current = "current",
  MovedLegacy = "moved-legacy",
  Legacy = "legacy",
  NewerOfBoth = "newer-of-both",
}

export interface DataFolderResolution {
  readonly choice: DataFolderChoice;
  readonly dir: string;
  readonly noticeAr: string | null;
  readonly detail: string;
}

export interface ResolveDataFolderParams {
  readonly legacyDir: string;
  readonly currentDir: string;
  readonly rename?: (from: string, to: string) => void;
  readonly verify?: (movedTo: string, expected: readonly FolderEntry[]) => boolean;
}

interface FolderEntry {
  readonly name: string;
  readonly size: number;
}

const holdsBooks = (dir: string): boolean => BOOKS_FILES.some((file) => existsSync(path.join(dir, file)));

function booksModifiedAt(dir: string): number {
  return Math.max(
    0,
    ...BOOKS_FILES.flatMap((file) => [file, `${file}-wal`]).map((file) => {
      try {
        return statSync(path.join(dir, file)).mtimeMs;
      } catch {
        return 0;
      }
    }),
  );
}

function entriesOf(dir: string): FolderEntry[] {
  return readdirSync(dir)
    .sort()
    .map((name) => {
      const stats = statSync(path.join(dir, name));
      return { name, size: stats.isFile() ? stats.size : -1 };
    });
}

const arrivedWhole = (movedTo: string, expected: readonly FolderEntry[]): boolean =>
  JSON.stringify(entriesOf(movedTo)) === JSON.stringify(expected);

export function dataFolderOverridden(argv: readonly string[] = process.argv): boolean {
  return argv.some((arg) => arg === "--user-data-dir" || arg.startsWith("--user-data-dir="));
}

export function resolveDataFolder(params: ResolveDataFolderParams): DataFolderResolution {
  const { legacyDir, currentDir } = params;
  const stayOnLegacy = (detail: string): DataFolderResolution => ({ choice: DataFolderChoice.Legacy, dir: legacyDir, noticeAr: null, detail });

  if (!existsSync(legacyDir) || !holdsBooks(legacyDir)) {
    return { choice: DataFolderChoice.Current, dir: currentDir, noticeAr: null, detail: "no earlier data folder holds books" };
  }

  if (existsSync(currentDir)) {
    if (!holdsBooks(currentDir)) return stayOnLegacy(`${currentDir} exists without books; using ${legacyDir} as it is`);
    const useLegacy = booksModifiedAt(legacyDir) > booksModifiedAt(currentDir);
    const dir = useLegacy ? legacyDir : currentDir;
    const other = useLegacy ? currentDir : legacyDir;
    return {
      choice: DataFolderChoice.NewerOfBoth,
      dir,
      noticeAr:
        "يوجد مجلدان لبيانات ميزان على هذا الجهاز، وكلٌّ منهما يحتوي على دفاتر. لم يُدمج أي منهما في الآخر.\n" +
        `المجلد المستخدم الآن (الأحدث): ${dir}\n` +
        `المجلد الآخر (لم يُمَسّ): ${other}\n` +
        "تواصل مع الدعم قبل حذف أي منهما.",
      detail: `both ${legacyDir} and ${currentDir} hold books; using the newer, ${dir}`,
    };
  }

  const lockPath = path.join(path.dirname(currentDir), MOVE_LOCK_NAME);
  let lock: number;
  try {
    lock = openSync(lockPath, "wx");
  } catch (err) {
    return stayOnLegacy(`could not take ${lockPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const expected = entriesOf(legacyDir);
    (params.rename ?? renameSync)(legacyDir, currentDir);
    if (!(params.verify ?? arrivedWhole)(currentDir, expected) || existsSync(legacyDir)) {
      if (existsSync(currentDir) && !existsSync(legacyDir)) renameSync(currentDir, legacyDir);
      return stayOnLegacy(`the move to ${currentDir} did not arrive whole and was undone`);
    }
    return { choice: DataFolderChoice.MovedLegacy, dir: currentDir, noticeAr: null, detail: `moved ${legacyDir} to ${currentDir}` };
  } catch (err) {
    return stayOnLegacy(`could not move ${legacyDir} to ${currentDir}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}
