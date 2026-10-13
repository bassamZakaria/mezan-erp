import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DataFolderChoice, LEGACY_DATA_FOLDER_NAME, PRODUCT_DATA_FOLDER_NAME, dataFolderOverridden, resolveDataFolder } from "./data-folder.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function appData(): { root: string; legacyDir: string; currentDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "mezan-appdata-"));
  roots.push(root);
  return { root, legacyDir: path.join(root, LEGACY_DATA_FOLDER_NAME), currentDir: path.join(root, PRODUCT_DATA_FOLDER_NAME) };
}

function books(dir: string, marker: string, modifiedAt?: Date): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "mezan.db"), `books:${marker}`);
  writeFileSync(path.join(dir, "database-key.txt"), `key:${marker}`);
  if (modifiedAt) utimesSync(path.join(dir, "mezan.db"), modifiedAt, modifiedAt);
}

const booksIn = (dir: string): string => readFileSync(path.join(dir, "mezan.db"), "utf8");

describe("where an install keeps its books", () => {
  it("the folder is named after the product, not after the package", () => {
    expect([PRODUCT_DATA_FOLDER_NAME, LEGACY_DATA_FOLDER_NAME]).toEqual(["Mezan", "desktop"]);
  });

  it("a new install uses the product folder and touches nothing else", () => {
    const { root, legacyDir, currentDir } = appData();
    const resolved = resolveDataFolder({ legacyDir, currentDir });
    expect(resolved).toMatchObject({ choice: DataFolderChoice.Current, dir: currentDir, noticeAr: null });
    expect(readdirSync(root)).toEqual([]);
  });

  it("an install already on the product folder stays there", () => {
    const { legacyDir, currentDir } = appData();
    books(currentDir, "current");
    expect(resolveDataFolder({ legacyDir, currentDir })).toMatchObject({ choice: DataFolderChoice.Current, dir: currentDir, noticeAr: null });
    expect(booksIn(currentDir)).toBe("books:current");
  });

  it("an existing install is moved once, whole, and the old folder is gone", () => {
    const { root, legacyDir, currentDir } = appData();
    books(legacyDir, "legacy");
    mkdirSync(path.join(legacyDir, "nested"));
    writeFileSync(path.join(legacyDir, "nested", "license.mezan"), "licence");

    const resolved = resolveDataFolder({ legacyDir, currentDir });

    expect(resolved).toMatchObject({ choice: DataFolderChoice.MovedLegacy, dir: currentDir, noticeAr: null });
    expect(existsSync(legacyDir)).toBe(false);
    expect(booksIn(currentDir)).toBe("books:legacy");
    expect(readFileSync(path.join(currentDir, "database-key.txt"), "utf8")).toBe("key:legacy");
    expect(readFileSync(path.join(currentDir, "nested", "license.mezan"), "utf8")).toBe("licence");
    expect(readdirSync(root)).toEqual([PRODUCT_DATA_FOLDER_NAME]);
    expect(resolveDataFolder({ legacyDir, currentDir })).toMatchObject({ choice: DataFolderChoice.Current, dir: currentDir });
  });

  it("a product folder the runtime created empty does not hide the books beside it: they are used where they are, never merged", () => {
    const { legacyDir, currentDir } = appData();
    books(legacyDir, "legacy");
    mkdirSync(path.join(currentDir, "Cache"), { recursive: true });

    const resolved = resolveDataFolder({ legacyDir, currentDir });

    expect(resolved).toMatchObject({ choice: DataFolderChoice.Legacy, dir: legacyDir });
    expect(booksIn(legacyDir)).toBe("books:legacy");
    expect(existsSync(path.join(currentDir, "mezan.db"))).toBe(false);
  });

  it.each([
    ["the old folder", "legacy"],
    ["the product folder", "current"],
  ] as const)("two populated folders are never merged: %s holding the newer books is used and the notice names both", (_label, newer) => {
    const { legacyDir, currentDir } = appData();
    const older = new Date("2026-09-05T10:00:00.000Z");
    const later = new Date("2026-10-13T10:00:00.000Z");
    books(legacyDir, "legacy", newer === "legacy" ? later : older);
    books(currentDir, "current", newer === "current" ? later : older);

    const resolved = resolveDataFolder({ legacyDir, currentDir });

    expect(resolved.choice).toBe(DataFolderChoice.NewerOfBoth);
    expect(resolved.dir).toBe(newer === "legacy" ? legacyDir : currentDir);
    expect(resolved.noticeAr).toContain(legacyDir);
    expect(resolved.noticeAr).toContain(currentDir);
    expect(resolved.noticeAr).toContain("يوجد مجلدان لبيانات ميزان");
    expect([booksIn(legacyDir), booksIn(currentDir)]).toEqual(["books:legacy", "books:current"]);
  });

  it("a move another launch is already making is left alone, and the books are used where they are", () => {
    const { root, legacyDir, currentDir } = appData();
    books(legacyDir, "legacy");
    writeFileSync(path.join(root, ".mezan-data-folder.lock"), "held");

    const resolved = resolveDataFolder({ legacyDir, currentDir });

    expect(resolved).toMatchObject({ choice: DataFolderChoice.Legacy, dir: legacyDir });
    expect(existsSync(currentDir)).toBe(false);
    expect(booksIn(legacyDir)).toBe("books:legacy");
  });

  it("a move that cannot be made leaves the books exactly where they were", () => {
    const { root, legacyDir, currentDir } = appData();
    books(legacyDir, "legacy");

    const resolved = resolveDataFolder({
      legacyDir,
      currentDir,
      rename: () => {
        throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
      },
    });

    expect(resolved).toMatchObject({ choice: DataFolderChoice.Legacy, dir: legacyDir });
    expect(booksIn(legacyDir)).toBe("books:legacy");
    expect(existsSync(currentDir)).toBe(false);
    expect(readdirSync(root)).toEqual([LEGACY_DATA_FOLDER_NAME]);
  });

  it("a move that did not arrive whole is undone", () => {
    const { legacyDir, currentDir } = appData();
    books(legacyDir, "legacy");

    const resolved = resolveDataFolder({
      legacyDir,
      currentDir,
      verify: () => false,
    });

    expect(resolved).toMatchObject({ choice: DataFolderChoice.Legacy, dir: legacyDir });
    expect(booksIn(legacyDir)).toBe("books:legacy");
    expect(existsSync(currentDir)).toBe(false);
  });

  it("a launch that names its own data directory is left alone", () => {
    expect(dataFolderOverridden(["/Applications/Mezan.app", "--user-data-dir=/tmp/scratch"])).toBe(true);
    expect(dataFolderOverridden(["/Applications/Mezan.app", "--user-data-dir", "/tmp/scratch"])).toBe(true);
    expect(dataFolderOverridden(["/Applications/Mezan.app", "--allow-unencrypted-database"])).toBe(false);
  });
});
