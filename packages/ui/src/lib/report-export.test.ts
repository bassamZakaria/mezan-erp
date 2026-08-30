import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildReportExport, type ReportExportColumn } from "./report-export";

interface Row {
  code: string;
  amount: number;
}

const rows: Row[] = [
  { code: "1100", amount: 122000 },
  { code: "4100", amount: -35000 },
];

const columns: ReportExportColumn<Row>[] = [
  { key: "code", header: "رقم الحساب", value: (r) => r.code },
  { key: "amount", header: "الرصيد", value: (r) => r.amount },
];

describe("buildReportExport", () => {
  it("produces a non-empty XLSX workbook with the given sheet name, headers, and rows", async () => {
    const file = await buildReportExport(columns, rows, { format: "xlsx", baseFilename: "trial-balance", sheetName: "ميزان المراجعة" });
    expect(file.filename).toBe("trial-balance.xlsx");
    expect(file.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(file.data.byteLength).toBeGreaterThan(0);

    const readBack = new ExcelJS.Workbook();
    await readBack.xlsx.load(file.data);
    const sheet = readBack.getWorksheet("ميزان المراجعة");
    expect(sheet).toBeDefined();
    expect(sheet?.getRow(1).getCell(1).value).toBe("رقم الحساب");
    expect(sheet?.getRow(2).getCell(1).value).toBe("1100");
    expect(sheet?.getRow(2).getCell(2).value).toBe(122000);
    expect(sheet?.getRow(3).getCell(2).value).toBe(-35000);
  });

  it("produces a non-empty CSV with a header row and one row per data row", async () => {
    const file = await buildReportExport(columns, rows, { format: "csv", baseFilename: "trial-balance" });
    expect(file.filename).toBe("trial-balance.csv");
    expect(file.mimeType).toBe("text/csv;charset=utf-8");

    const text = new TextDecoder().decode(file.data);
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("رقم الحساب");
    expect(lines[1]).toContain("1100");
    expect(lines[1]).toContain("122000");
  });

  it("produces an empty-body export when there are no rows", async () => {
    const file = await buildReportExport(columns, [], { format: "csv", baseFilename: "empty" });
    const text = new TextDecoder().decode(file.data);
    expect(text.trim().split("\n")).toHaveLength(1); // header only
  });
});

describe("the CSV export's byte order mark", () => {
  it("starts with the UTF-8 BOM, which is what stops Excel rendering Arabic as mojibake", async () => {
    const file = await buildReportExport(columns, rows, { format: "csv", baseFilename: "trial-balance" });
    const bytes = new Uint8Array(file.data);

    // The decoded string contains the Arabic header either way — only the first
    // three bytes decide whether Excel reads the file as UTF-8 or as the
    // system codepage.
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
  });

  it("carries the BOM even when there are no rows to export", async () => {
    const file = await buildReportExport(columns, [], { format: "csv", baseFilename: "empty" });
    const bytes = new Uint8Array(file.data);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("writes the Arabic headers after the mark, in order", async () => {
    const file = await buildReportExport(columns, rows, { format: "csv", baseFilename: "trial-balance" });
    const text = new TextDecoder("utf-8").decode(new Uint8Array(file.data).slice(3));
    expect(text.split("\n")[0]).toContain("رقم الحساب");
    expect(text.split("\n")[0]).toContain("الرصيد");
  });
});
