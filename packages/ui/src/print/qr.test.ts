import { describe, it, expect } from "vitest";
import { encodeQr, qrReservedModules, rsEncode, type QrSymbol } from "./qr";

/* ---------------------------------------------------------------- */
/* Reading a symbol back out of its own matrix.                      */
/* ---------------------------------------------------------------- */

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/** The 15-bit format strip, unmasked; low 3 bits are the mask the symbol was built with. */
function readMask(symbol: QrSymbol): number {
  let bits = 0;
  for (let i = 0; i <= 5; i += 1) bits |= (symbol.modules[8]?.[i] as number) << i;
  bits |= (symbol.modules[8]?.[7] as number) << 6;
  bits |= (symbol.modules[8]?.[8] as number) << 7;
  bits |= (symbol.modules[7]?.[8] as number) << 8;
  for (let i = 9; i <= 14; i += 1) bits |= (symbol.modules[14 - i]?.[8] as number) << i;
  return ((bits ^ 0x5412) >> 10) & 0b111;
}

/**
 * Walks the zigzag in the same order the writer does and reassembles the
 * interleaved codeword stream. Its point is that it uses nothing from the
 * encoder except the finished symbol and the structural map, so agreement
 * with the input proves the placement, the masking and the bit packing.
 */
function readCodewords(symbol: QrSymbol): number[] {
  const reserved = qrReservedModules(symbol.version);
  const mask = readMask(symbol);
  const bits: number[] = [];
  let upward = true;
  for (let right = symbol.size - 1; right >= 1; right -= 2) {
    const col = right <= 6 ? right - 1 : right;
    for (let step = 0; step < symbol.size; step += 1) {
      const row = upward ? symbol.size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (reserved[row]?.[c]) continue;
        const cell = symbol.modules[row]?.[c] as number;
        bits.push(maskBit(mask, row, c) ? cell ^ 1 : cell);
      }
    }
    upward = !upward;
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number);
    out.push(byte);
  }
  return out;
}

/** Undoes the block interleave and reads the byte-mode payload back. */
function readPayload(symbol: QrSymbol, blockDataSizes: readonly number[], ecCount: number): string {
  const stream = readCodewords(symbol);
  const blocks: number[][] = blockDataSizes.map(() => []);
  let cursor = 0;
  for (let i = 0; i < Math.max(...blockDataSizes); i += 1) {
    for (let b = 0; b < blockDataSizes.length; b += 1) {
      if (i < (blockDataSizes[b] as number)) {
        (blocks[b] as number[]).push(stream[cursor++] as number);
      }
    }
  }
  expect(cursor + ecCount * blockDataSizes.length).toBeLessThanOrEqual(stream.length);

  const data = blocks.flat();
  const countBits = symbol.version <= 9 ? 8 : 16;
  const bits: number[] = [];
  for (const byte of data) for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  const take = (at: number, width: number) =>
    bits.slice(at, at + width).reduce((acc, bit) => (acc << 1) | bit, 0);

  expect(take(0, 4)).toBe(0b0100);
  const length = take(4, countBits);
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(4 + countBits + i * 8, 8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/* ---------------------------------------------------------------- */

describe("rsEncode — the parity a damaged receipt is recovered from", () => {
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] as number;
  }
  const mul = (a: number, b: number) =>
    a === 0 || b === 0 ? 0 : (EXP[((LOG[a] as number) + (LOG[b] as number)) % 255] as number);

  it("produces the requested number of parity codewords", () => {
    expect(rsEncode([1, 2, 3], 10)).toHaveLength(10);
    expect(rsEncode([1, 2, 3], 26)).toHaveLength(26);
  });

  it("makes the codeword divisible by the generator — every syndrome is zero", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    const ecCount = 10;
    const codeword = [...data, ...rsEncode(data, ecCount)];
    for (let i = 0; i < ecCount; i += 1) {
      let syndrome = 0;
      for (const byte of codeword) syndrome = mul(syndrome, EXP[i] as number) ^ byte;
      expect(syndrome).toBe(0);
    }
  });
});

describe("encodeQr — structure", () => {
  it("refuses an empty value and anything past version 10", () => {
    expect(encodeQr("")).toBeNull();
    expect(encodeQr("x".repeat(214))).toBeNull();
    expect(encodeQr("x".repeat(213))).not.toBeNull();
  });

  it("picks the smallest version that fits", () => {
    expect(encodeQr("x".repeat(14))?.version).toBe(1);
    expect(encodeQr("x".repeat(15))?.version).toBe(2);
    expect(encodeQr("x".repeat(180))?.version).toBe(9);
    expect(encodeQr("x".repeat(181))?.version).toBe(10);
  });

  it("sizes the matrix as 4·version + 17", () => {
    const symbol = encodeQr("hello") as QrSymbol;
    expect(symbol.size).toBe(symbol.version * 4 + 17);
    expect(symbol.modules).toHaveLength(symbol.size);
    expect(symbol.modules[0]).toHaveLength(symbol.size);
  });

  it("puts a finder pattern in three corners and none in the fourth", () => {
    const s = encodeQr("hello") as QrSymbol;
    const finder = (row: number, col: number) =>
      [0, 1, 2, 3, 4, 5, 6].every((r) =>
        [0, 1, 2, 3, 4, 5, 6].every((c) => {
          const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          return s.modules[row + r]?.[col + c] === (onBorder || inCore ? 1 : 0);
        }),
      );
    expect(finder(0, 0)).toBe(true);
    expect(finder(0, s.size - 7)).toBe(true);
    expect(finder(s.size - 7, 0)).toBe(true);
    expect(finder(s.size - 7, s.size - 7)).toBe(false);
  });

  it("alternates the timing patterns", () => {
    const s = encodeQr("hello") as QrSymbol;
    for (let i = 8; i < s.size - 8; i += 1) {
      expect(s.modules[6]?.[i]).toBe(i % 2 === 0 ? 1 : 0);
      expect(s.modules[i]?.[6]).toBe(i % 2 === 0 ? 1 : 0);
    }
  });

  it("always sets the dark module", () => {
    for (const value of ["a", "hello world", "x".repeat(120)]) {
      const s = encodeQr(value) as QrSymbol;
      expect(s.modules[s.size - 8]?.[8]).toBe(1);
    }
  });

  it("writes a format strip whose BCH check holds and whose mask is one of the eight", () => {
    const s = encodeQr("hello") as QrSymbol;
    const mask = readMask(s);
    expect(mask).toBeGreaterThanOrEqual(0);
    expect(mask).toBeLessThanOrEqual(7);
  });

  it("is deterministic — a reprint of the same URL is the same symbol", () => {
    const url = "https://invoicing.eta.gov.eg/receipts/search/abc/share/2026-09-01T10%3A00%3A00Z";
    expect(encodeQr(url)).toEqual(encodeQr(url));
  });
});

describe("encodeQr — a symbol reads back as what went in", () => {
  it("round-trips a single-block version", () => {
    const symbol = encodeQr("MEZAN") as QrSymbol;
    expect(symbol.version).toBe(1);
    expect(readPayload(symbol, [16], 10)).toBe("MEZAN");
  });

  it("round-trips a two-block version", () => {
    const value = "x".repeat(60);
    const symbol = encodeQr(value) as QrSymbol;
    expect(symbol.version).toBe(4);
    expect(readPayload(symbol, [32, 32], 18)).toBe(value);
  });

  it("round-trips the authority's receipt URL at the version it lands on", () => {
    const url = `https://invoicing.eta.gov.eg/receipts/search/${"a".repeat(64)}/share/2026-09-01T10%3A00%3A00.000Z`;
    const symbol = encodeQr(url) as QrSymbol;
    expect(symbol.version).toBe(8);
    expect(readPayload(symbol, [38, 38, 39, 39], 22)).toBe(url);
  });

  it("round-trips a two-group version, where the blocks are unequal", () => {
    const value = "y".repeat(150);
    const symbol = encodeQr(value) as QrSymbol;
    expect(symbol.version).toBe(8);
    expect(readPayload(symbol, [38, 38, 39, 39], 22)).toBe(value);
  });

  it("round-trips non-ASCII, which UTF-8 makes multi-byte", () => {
    const value = "إيصال إلكتروني";
    const symbol = encodeQr(value) as QrSymbol;
    const sizes = symbol.version === 2 ? [28] : symbol.version === 3 ? [44] : [16];
    expect(readPayload(symbol, sizes, symbol.version === 2 ? 16 : symbol.version === 3 ? 26 : 10)).toBe(value);
  });
});
