import { describe, expect, it } from "vitest";
import { readXlsxFirstSheet } from "./xlsx";

interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly deflated?: Uint8Array;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  void writer.write(data.slice());
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.length;
  }
  return merged;
}

/** A minimal ZIP writer — enough for the reader under test, which ignores CRCs. */
function buildZip(entries: readonly ZipEntry[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const payload = entry.deflated ?? entry.bytes;
    const method = entry.deflated ? 8 : 0;

    const local = new Uint8Array(30 + name.length + payload.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(payload, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, payload.length, true);
    centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

const encoder = new TextEncoder();

function workbook(sheetXml: string, sharedStringsXml?: string, sheetName = "xl/worksheets/sheet1.xml"): ArrayBuffer {
  const entries: ZipEntry[] = [{ name: sheetName, bytes: encoder.encode(sheetXml) }];
  if (sharedStringsXml) entries.push({ name: "xl/sharedStrings.xml", bytes: encoder.encode(sharedStringsXml) });
  return buildZip(entries);
}

const sheet = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;

describe("readXlsxFirstSheet", () => {
  it("reads inline numbers out of the first sheet", async () => {
    const xml = sheet(
      `<row r="1"><c r="A1"><v>5</v></c><c r="B1"><v>12.5</v></c></row>` +
        `<row r="2"><c r="A2"><v>7</v></c><c r="B2"><v>0.25</v></c></row>`,
    );
    expect(await readXlsxFirstSheet(workbook(xml))).toEqual([
      ["5", "12.5"],
      ["7", "0.25"],
    ]);
  });

  it("resolves shared strings, which is how Excel stores Arabic item names", async () => {
    const shared = `<sst><si><t>الصنف</t></si><si><t>الكمية</t></si></sst>`;
    const xml = sheet(`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`);
    expect(await readXlsxFirstSheet(workbook(xml, shared))).toEqual([["الصنف", "الكمية"]]);
  });

  it("joins the runs of a shared string that Excel styled in pieces", async () => {
    const shared = `<sst><si><r><t>قلم </t></r><r><t>أزرق</t></r></si></sst>`;
    const xml = sheet(`<row r="1"><c r="A1" t="s"><v>0</v></c></row>`);
    expect(await readXlsxFirstSheet(workbook(xml, shared))).toEqual([["قلم أزرق"]]);
  });

  it("reads an inline string cell", async () => {
    const xml = sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>IT-1</t></is></c></row>`);
    expect(await readXlsxFirstSheet(workbook(xml))).toEqual([["IT-1"]]);
  });

  it("keeps a blank column in place instead of shifting later values left", async () => {
    const xml = sheet(`<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>`);
    expect(await readXlsxFirstSheet(workbook(xml))).toEqual([["1", "", "3"]]);
  });

  it("places a cell past column Z correctly", async () => {
    const xml = sheet(`<row r="1"><c r="AA1"><v>27</v></c></row>`);
    const rows = await readXlsxFirstSheet(workbook(xml));
    expect(rows[0]).toHaveLength(27);
    expect(rows[0]?.[26]).toBe("27");
  });

  it("drops a row that is entirely blank", async () => {
    const xml = sheet(
      `<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v> </v></c></row><row r="3"><c r="A3"><v>3</v></c></row>`,
    );
    expect(await readXlsxFirstSheet(workbook(xml))).toEqual([["1"], ["3"]]);
  });

  it("decodes the XML entities Excel escapes, including a literal ampersand", async () => {
    const shared = `<sst><si><t>&lt;قلم&gt; &amp;amp; &quot;كبير&quot;</t></si></sst>`;
    const xml = sheet(`<row r="1"><c r="A1" t="s"><v>0</v></c></row>`);
    expect(await readXlsxFirstSheet(workbook(xml, shared))).toEqual([['<قلم> &amp; "كبير"']]);
  });

  it("reads a formula cell at the value the file was last saved showing", async () => {
    const xml = sheet(`<row r="1"><c r="A1"><f>SUM(B1:B2)</f><v>42</v></c></row>`);
    expect(await readXlsxFirstSheet(workbook(xml))).toEqual([["42"]]);
  });

  it("reads a deflated sheet, which is what a real .xlsx contains", async () => {
    const xml = sheet(`<row r="1"><c r="A1"><v>5</v></c></row>`);
    const bytes = encoder.encode(xml);
    const zip = buildZip([{ name: "xl/worksheets/sheet1.xml", bytes, deflated: await deflateRaw(bytes) }]);
    expect(await readXlsxFirstSheet(zip)).toEqual([["5"]]);
  });

  it("takes sheet1 when the workbook holds several, whatever order they are stored in", async () => {
    const zip = buildZip([
      { name: "xl/worksheets/sheet10.xml", bytes: encoder.encode(sheet(`<row r="1"><c r="A1"><v>10</v></c></row>`)) },
      { name: "xl/worksheets/sheet2.xml", bytes: encoder.encode(sheet(`<row r="1"><c r="A1"><v>2</v></c></row>`)) },
      { name: "xl/worksheets/sheet1.xml", bytes: encoder.encode(sheet(`<row r="1"><c r="A1"><v>1</v></c></row>`)) },
    ]);
    expect(await readXlsxFirstSheet(zip)).toEqual([["1"]]);
  });

  it("returns nothing for an archive that holds no worksheet", async () => {
    const zip = buildZip([{ name: "docProps/app.xml", bytes: encoder.encode("<Properties/>") }]);
    expect(await readXlsxFirstSheet(zip)).toEqual([]);
  });

  it("returns nothing for an empty sheet rather than a row of blanks", async () => {
    expect(await readXlsxFirstSheet(workbook(sheet("")))).toEqual([]);
  });

  it("refuses something that is not a zip at all", async () => {
    const notAZip = encoder.encode("this is a csv, not a workbook").buffer;
    await expect(readXlsxFirstSheet(notAZip)).rejects.toThrow("not a zip file");
  });

  it("survives an archive comment, which moves the end-of-directory record", async () => {
    const xml = sheet(`<row r="1"><c r="A1"><v>9</v></c></row>`);
    const base = new Uint8Array(workbook(xml));
    const commented = new Uint8Array(base.length + 5);
    commented.set(base, 0);
    new DataView(commented.buffer).setUint16(base.length - 2, 5, true);
    commented.set(encoder.encode("hello"), base.length);
    expect(await readXlsxFirstSheet(commented.buffer)).toEqual([["9"]]);
  });

  it("reads a shared-string index that does not exist as blank rather than crashing", async () => {
    const shared = `<sst><si><t>only</t></si></sst>`;
    const xml = sheet(`<row r="1"><c r="A1" t="s"><v>7</v></c><c r="B1"><v>1</v></c></row>`);
    expect(await readXlsxFirstSheet(workbook(xml, shared))).toEqual([["", "1"]]);
  });
});
