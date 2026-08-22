import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildHistoricalImportTemplate, parseHistoricalImportFile } from "./historical-import-file";

describe("buildHistoricalImportTemplate", () => {
  it("produces a non-empty XLSX workbook with the header row and one example row", async () => {
    const file = await buildHistoricalImportTemplate();
    expect(file.filename).toBe("historical-purchase-invoices-template.xlsx");
    expect(file.data.byteLength).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.data);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    expect(sheet?.getRow(1).getCell(1).value).toBe("نوع المستند");
    expect(sheet?.getRow(2).getCell(1).value).toBe("فاتورة مشتريات");
    expect(sheet?.getRow(2).getCell(2).value).toBe("INV-1001");
  });
});

describe("parseHistoricalImportFile", () => {
  async function buildFile(rows: (string | number)[][]): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("s");
    sheet.addRow([
      "نوع المستند",
      "رقم المستند",
      "معرف المورد",
      "التاريخ",
      "تاريخ الاستحقاق",
      "معرف الصنف",
      "الوصف",
      "الكمية",
      "تكلفة الوحدة",
      "المبلغ المسدد من المستند بالكامل",
    ]);
    for (const row of rows) sheet.addRow(row);
    return await workbook.xlsx.writeBuffer();
  }

  it("round-trips the built template back into a parsed row", async () => {
    const file = await buildHistoricalImportTemplate();
    const result = await parseHistoricalImportFile(file.data);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      docType: "PURCHASE_INVOICE",
      documentNumber: "INV-1001",
      supplierId: "sup-1",
      date: "2026-01-15",
      dueDate: "2026-02-15",
      itemId: "item-cement",
      description: null,
      qty: "10",
      unitCost: "85.00",
      amountPaid: "500.00",
    });
  });

  it("parses multiple rows, mapping both PURCHASE_INVOICE and PURCHASE_RETURN labels", async () => {
    const buf = await buildFile([
      ["فاتورة مشتريات", "INV-1", "sup-1", "2026-01-01", "", "item-a", "", "5", "10.00", "0"],
      ["مرتجع مشتريات", "RET-1", "sup-2", "2026-01-02", "", "item-b", "تالف", "1", "20.00", "20.00"],
    ]);
    const result = await parseHistoricalImportFile(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    const [first, second] = result.rows;
    expect(first?.docType).toBe("PURCHASE_INVOICE");
    expect(first?.dueDate).toBeNull();
    expect(second?.docType).toBe("PURCHASE_RETURN");
    expect(second?.description).toBe("تالف");
  });

  it("skips fully-blank rows silently", async () => {
    const buf = await buildFile([
      ["فاتورة مشتريات", "INV-1", "sup-1", "2026-01-01", "", "item-a", "", "5", "10.00", "0"],
      ["", "", "", "", "", "", "", "", "", ""],
    ]);
    const result = await parseHistoricalImportFile(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it("reports a row with an unrecognized doc-type label as an error and excludes it", async () => {
    const buf = await buildFile([["نوع غريب", "INV-1", "sup-1", "2026-01-01", "", "item-a", "", "5", "10.00", "0"]]);
    const result = await parseHistoricalImportFile(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.rowNumber).toBe(2);
    expect(result.errors[0]?.reason).toContain("نوع غريب");
  });

  it("returns an error when the workbook has no worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const buf = await workbook.xlsx.writeBuffer();
    const result = await parseHistoricalImportFile(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
