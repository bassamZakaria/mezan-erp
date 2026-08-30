import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildDataMigrationTemplate, parseDataMigrationFile, type DataMigrationStepSpec } from "./data-migration-file";

const spec: DataMigrationStepSpec = {
  id: "customers",
  sheetName: "العملاء",
  columns: [
    { key: "code", header: "الكود", example: "C-001" },
    { key: "name", header: "الاسم", example: "شركة الأمل" },
    { key: "openingBalance", header: "الرصيد الافتتاحي", example: "1000.00" },
  ],
};

describe("buildDataMigrationTemplate", () => {
  it("produces a non-empty XLSX workbook with the header row and one filled example row", async () => {
    const file = await buildDataMigrationTemplate(spec);
    expect(file.filename).toBe("customers-template.xlsx");
    expect(file.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(file.data.byteLength).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.data);
    const sheet = workbook.worksheets[0];
    expect(sheet?.name).toBe("العملاء");
    expect(sheet?.getRow(1).getCell(1).value).toBe("الكود");
    expect(sheet?.getRow(1).getCell(2).value).toBe("الاسم");
    expect(sheet?.getRow(2).getCell(1).value).toBe("C-001");
    expect(sheet?.getRow(2).getCell(3).value).toBe("1000.00");
  });

  it("leaves an example-less column's sample cell blank", async () => {
    const noExample: DataMigrationStepSpec = {
      id: "items",
      sheetName: "s",
      columns: [{ key: "code", header: "code" }],
    };
    const file = await buildDataMigrationTemplate(noExample);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.data);
    const sheet = workbook.worksheets[0];
    expect(sheet?.getRow(2).getCell(1).value).toBe("");
  });
});

describe("parseDataMigrationFile", () => {
  async function buildFile(rows: (string | number)[][], headers = spec.columns.map((c) => c.header)): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("s");
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    return await workbook.xlsx.writeBuffer();
  }

  it("round-trips the built template back into a parsed row, tagged with its sheet row number", async () => {
    const file = await buildDataMigrationTemplate(spec);
    const result = await parseDataMigrationFile(file.data, spec);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      code: "C-001",
      name: "شركة الأمل",
      openingBalance: "1000.00",
      rowNumber: "2",
    });
  });

  it("skips a fully-blank row silently", async () => {
    const buf = await buildFile([
      ["C-001", "شركة الأمل", "1000.00"],
      ["", "", ""],
    ]);
    const result = await parseDataMigrationFile(buf, spec);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it("parses multiple data rows in sheet order", async () => {
    const buf = await buildFile([
      ["C-001", "شركة الأمل", "1000.00"],
      ["C-002", "مؤسسة النور", "500.00"],
    ]);
    const result = await parseDataMigrationFile(buf, spec);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.code).toBe("C-001");
    expect(result.rows[1]?.code).toBe("C-002");
    expect(result.rows[1]?.rowNumber).toBe("3");
  });

  it("returns the Arabic 'no sheet' error, via the default Arabic translator, when the workbook has no worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const buf = await workbook.xlsx.writeBuffer();
    const result = await parseDataMigrationFile(buf, spec);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toEqual([{ rowNumber: 0, reason: "الملف لا يحتوي على أي ورقة بيانات" }]);
  });

  it("uses a caller-supplied translator for the no-sheet error message", async () => {
    const workbook = new ExcelJS.Workbook();
    const buf = await workbook.xlsx.writeBuffer();
    const result = await parseDataMigrationFile(buf, spec, () => "no sheet in this file");
    expect(result.errors).toEqual([{ rowNumber: 0, reason: "no sheet in this file" }]);
  });

  it("treats a cell holding a formula result as its computed text", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("s");
    sheet.addRow(spec.columns.map((c) => c.header));
    const row = sheet.addRow(["C-003", "شركة الفجر", ""]);
    row.getCell(3).value = { formula: "1000+500", result: 1500 } as unknown as ExcelJS.CellValue;
    const buf = await workbook.xlsx.writeBuffer();
    const result = await parseDataMigrationFile(buf, spec);
    expect(result.rows[0]?.openingBalance).toBe("1500");
  });
});
