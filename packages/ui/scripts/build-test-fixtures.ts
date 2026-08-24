import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { STEPS } from "../../../apps/web/src/settings/data-migration-steps.js";

/**
 * Generates the files under `test-fixtures/`.
 *
 * The workbooks are built from the SAME `STEPS` spec the wizard parses uploads
 * against, so a column rename cannot leave a stale fixture that fails the
 * import for a reason resembling a product bug. Re-run after changing a step.
 *
 * Local/test material only — nothing here ships.
 */

const ROOT = new URL("../../..", import.meta.url).pathname;
const OUT = join(ROOT, "test-fixtures");

/**
 * Rows per step, keyed by step id. Values are keyed by the spec's column `key`,
 * so a renamed column surfaces as a missing value rather than a silent
 * mismatch. Every step gets at least one deliberately invalid row: an import
 * preview that reports nothing is not evidence the validation works.
 */
const ROWS: Record<string, Record<string, string>[]> = {
  departments: [
    { code: "SALES", nameAr: "المبيعات", nameEn: "Sales" },
    { code: "FIN", nameAr: "المالية", nameEn: "Finance" },
    { code: "OPS", nameAr: "العمليات", nameEn: "Operations" },
    { code: "SALES", nameAr: "مكرر — كود موجود بالفعل", nameEn: "Duplicate" },
  ],
  // hireDate and baseUnitCode below are REQUIRED columns. Leaving them blank on
  // every row made these two workbooks reject themselves wholesale — the commit
  // gate is all-or-nothing per file, so a fixture meant to demonstrate one bad
  // row imported nothing at all.
  employees: [
    { code: "E-101", nameAr: "أحمد سيد", departmentCode: "SALES", hireDate: "2026-01-05" },
    { code: "E-102", nameAr: "منى رضا", departmentCode: "FIN", hireDate: "2026-02-17" },
    { code: "E-103", nameAr: "بدون قسم", departmentCode: "NOPE", hireDate: "2026-03-01" },
  ],
  customers: [
    { code: "C-9001", nameAr: "شركة النيل للتوريدات", phone: "01005550001", paymentTermsDays: "30", openingBalance: "12500" },
    { code: "C-9002", nameAr: "مؤسسة البركة", phone: "01005550002", paymentTermsDays: "45", openingBalance: "0" },
    { code: "C-9003", nameAr: "رصيد سالب غير صالح", phone: "01005550003", paymentTermsDays: "-5", openingBalance: "-100" },
  ],
  suppliers: [
    { code: "S-9001", nameAr: "مصنع الدلتا للأغذية", phone: "01115550001", paymentTermsDays: "30", openingBalance: "8000" },
    { code: "S-9002", nameAr: "شركة الشرق للتغليف", phone: "01115550002", paymentTermsDays: "60", openingBalance: "0" },
  ],
  items: [
    { code: "IT-9001", nameAr: "دقيق فاخر ١ كجم", type: "stock", baseUnitCode: "PCS", salePrice: "28", costPrice: "19" },
    { code: "IT-9002", nameAr: "عسل نحل ٥٠٠ جم", type: "stock", baseUnitCode: "PCS", salePrice: "185", costPrice: "132" },
    { code: "IT-9003", nameAr: "سعر غير رقمي", type: "stock", baseUnitCode: "PCS", salePrice: "غير رقمي", costPrice: "10" },
  ],
};

function rowsFor(stepId: string, columns: readonly { key: string; example?: string }[]): Record<string, string>[] {
  const defined = ROWS[stepId];
  if (defined) return defined;
  // A step with no hand-written rows still gets the spec's own example row, so
  // every template is importable rather than an empty sheet.
  return [Object.fromEntries(columns.map((c) => [c.key, c.example ?? ""]))];
}

async function buildWorkbook(spec: { id: string; sheetName: string; columns: readonly { key: string; header: string; example?: string }[] }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(spec.sheetName);
  sheet.addRow(spec.columns.map((c) => c.header));
  for (const row of rowsFor(spec.id, spec.columns)) {
    sheet.addRow(spec.columns.map((c) => row[c.key] ?? ""));
  }
  sheet.columns.forEach((c) => { c.width = 24; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main() {
  await mkdir(join(OUT, "data-migration"), { recursive: true });
  await mkdir(join(OUT, "bank-statements"), { recursive: true });
  await mkdir(join(OUT, "images"), { recursive: true });

  const written: string[] = [];
  const seen = new Set<string>();
  for (const step of STEPS) {
    if (seen.has(step.spec.id)) continue;
    seen.add(step.spec.id);
    const buf = await buildWorkbook(step.spec);
    const name = `${step.spec.id}.xlsx`;
    await writeFile(join(OUT, "data-migration", name), buf);
    written.push(`data-migration/${name} (${step.spec.columns.length} cols)`);
  }

  // Bank statement CSV — the reconciliation screen parses the header row
  // locally to build its column mapping, so the headers matter more than the
  // filename. One row is deliberately unmatchable.
  const csv = [
    "date,description,debit,credit,balance",
    "2026-08-04,تحصيل فاتورة INV-000001,,13953.60,113953.60",
    "2026-08-11,تحصيل فاتورة INV-000002,,9747.00,123700.60",
    "2026-08-14,رسوم خدمات بنكية,150.00,,123550.60",
    "2026-08-18,تحويل غير معروف,,2500.00,126050.60",
    "2026-08-20,سداد مورد PI-000001,8000.00,,118050.60",
  ].join("\n");
  await writeFile(join(OUT, "bank-statements", "august-2026.csv"), csv, "utf8");
  written.push("bank-statements/august-2026.csv (5 rows)");

  // A 1x1 transparent PNG is enough to exercise an upload path without
  // committing a binary of any size.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(OUT, "images", "pixel.png"), png);
  written.push("images/pixel.png");

  console.log(`test fixtures written to test-fixtures/:`);
  for (const w of written) console.log("  " + w);
}

await main();
