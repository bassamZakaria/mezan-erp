/**
 * The first worksheet of an .xlsx file, as rows of strings (R5.8).
 *
 * An .xlsx is a ZIP of XML parts. Reading one needs DEFLATE, which the browser
 * already provides as `DecompressionStream("deflate-raw")` — so this carries no
 * dependency, which matters for an app that ships offline and is audited as a
 * whole.
 *
 * Deliberately partial: it reads cell VALUES from the first sheet and nothing
 * else. Formulas are read at their cached value (what the file was last saved
 * showing), and styles, dates-as-serials and merged cells are not interpreted.
 * That covers the import this exists for — a column of item codes and a column
 * of quantities — and anything richer belongs in a real spreadsheet library.
 */
export async function readXlsxFirstSheet(file: ArrayBuffer): Promise<string[][]> {
  const entries = await unzip(file);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml"));
  const sheet = firstSheet(entries);
  if (sheet === null) return [];
  return parseSheet(sheet, sharedStrings);
}

/** The workbook's first sheet by part name, falling back to sheet1.xml. */
function firstSheet(entries: Map<string, string>): string | null {
  const named = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));
  return named.length > 0 ? (entries.get(named[0] as string) ?? null) : null;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  // A <si> may hold several <t> runs when part of the text is styled
  // differently; the cell's value is all of them joined.
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    [...(si[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1] ?? "")).join(""),
  );
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      // The column letter places the cell: a blank column emits no <c> at all,
      // so reading them in order alone would shift every later value left.
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const index = ref ? columnIndex(ref) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "");
      else value = decodeXml(raw ?? "");
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    if (cells.some((c) => c.trim() !== "")) rows.push(cells);
  }
  return rows;
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/**
 * The ZIP central directory, then each entry's bytes as text.
 *
 * Read from the central directory rather than by walking local headers: a local
 * header may declare sizes of zero and defer them to a data descriptor, and
 * the directory always carries the real ones.
 */
async function unzip(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error("not a zip file");

  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) out.set(name, new TextDecoder().decode(compressed));
    else if (method === 8) out.set(name, new TextDecoder().decode(await inflateRaw(compressed)));

    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/** Scans back for the EOCD signature — the archive comment makes it variable-length. */
function findEndOfCentralDirectory(view: DataView): number {
  for (let i = view.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  // `data` is a view into the whole file buffer; the writer wants a standalone
  // buffer, and slicing gives it one without copying the rest of the archive.
  void writer.write(data.slice());
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.length;
  }
  return merged;
}
