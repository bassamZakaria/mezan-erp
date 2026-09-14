/**
 * QR Code (ISO/IEC 18004), byte mode, error-correction level M — enough to
 * carry the authority's e-receipt share URL and nothing more.
 *
 * A printed receipt's QR is the only thing a tax inspector can act on at the
 * counter, so it has to be a real symbol rather than a picture of one. The
 * encoder lives here for the same reason `Barcode128` does: @mezan/ui stays
 * dependency-free, and the symbol renders into the same DOM the print
 * pipeline already produces — no canvas, no image, no external library.
 *
 * Versions 1–10 are supported, which is 213 bytes at level M. Anything longer
 * returns null rather than a truncated symbol: a QR that scans to the wrong
 * URL is worse than no QR.
 */

/** [ecCodewordsPerBlock, blocksInGroup1, dataCodewordsInGroup1, blocksInGroup2, dataCodewordsInGroup2] at level M. */
const EC_BLOCKS_M: readonly (readonly [number, number, number, number, number])[] = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

/** Row/column centres of the alignment patterns, per version. */
const ALIGNMENT_CENTRES: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const MAX_VERSION = EC_BLOCKS_M.length;

/* ---------------------------------------------------------------- */
/* GF(256) — the field the Reed-Solomon parity is computed in.       */
/* ---------------------------------------------------------------- */

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

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[((LOG[a] as number) + (LOG[b] as number)) % 255] as number;
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] as number) ^ (poly[j] as number);
      next[j + 1] = (next[j + 1] as number) ^ gfMul(poly[j] as number, EXP[i] as number);
    }
    poly = next;
  }
  return poly;
}

export function rsEncode(data: readonly number[], ecCount: number): number[] {
  const generator = rsGenerator(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number);
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i += 1) {
      remainder[i] = (remainder[i] as number) ^ gfMul(generator[i + 1] as number, factor);
    }
  }
  return remainder;
}

/* ---------------------------------------------------------------- */
/* BCH — format and version information.                             */
/* ---------------------------------------------------------------- */

function bch(value: number, generator: number, generatorBits: number): number {
  let out = value << (generatorBits - 1);
  const top = 1 << (generatorBits + generatorBits - 2);
  for (let bit = top; bit >= 1 << (generatorBits - 1); bit >>= 1) {
    if (out & bit) out ^= generator * (bit / (1 << (generatorBits - 1)));
  }
  return out;
}

/** 15-bit format information: EC level M (0b00) plus the mask, BCH-protected and XOR-masked. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  return ((data << 10) | bch(data, 0x537, 11)) ^ 0x5412;
}

/** 18-bit version information, present from version 7 upward. */
function versionBits(version: number): number {
  return (version << 12) | bch(version, 0x1f25, 13);
}

/* ---------------------------------------------------------------- */
/* Encoding                                                          */
/* ---------------------------------------------------------------- */

function dataCapacityCodewords(version: number): number {
  const [, blocks1, data1, blocks2, data2] = EC_BLOCKS_M[version - 1] as readonly [
    number,
    number,
    number,
    number,
    number,
  ];
  return blocks1 * data1 + blocks2 * data2;
}

function utf8Bytes(value: string): number[] {
  const out: number[] = [];
  for (const byte of new TextEncoder().encode(value)) out.push(byte);
  return out;
}

function chooseVersion(byteLength: number): number | null {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + byteLength * 8) / 8);
    if (needed <= dataCapacityCodewords(version)) return version;
  }
  return null;
}

function buildDataCodewords(bytes: readonly number[], version: number): number[] {
  const capacity = dataCapacityCodewords(version);
  const countBits = version <= 9 ? 8 : 16;
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);
  push(bytes.length, countBits);
  for (const byte of bytes) push(byte, 8);

  const capacityBits = capacity * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number);
    codewords.push(byte);
  }
  const PAD = [0xec, 0x11];
  while (codewords.length < capacity) codewords.push(PAD[codewords.length % 2] as number);
  return codewords;
}

/** Split into blocks, add parity, then interleave data and parity as the standard requires. */
function interleave(dataCodewords: readonly number[], version: number): number[] {
  const [ecCount, blocks1, data1, blocks2, data2] = EC_BLOCKS_M[version - 1] as readonly [
    number,
    number,
    number,
    number,
    number,
  ];
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blocks1 + blocks2; i += 1) {
    const size = i < blocks1 ? data1 : data2;
    const block = dataCodewords.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecCount));
  }

  const out: number[] = [];
  const maxData = Math.max(data1, data2);
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i] as number);
  }
  for (let i = 0; i < ecCount; i += 1) {
    for (const block of ecBlocks) out.push(block[i] as number);
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Matrix                                                            */
/* ---------------------------------------------------------------- */

type Grid = (0 | 1 | null)[][];

function placeFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.length;

  const finder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        (grid[rr] as (0 | 1 | null)[])[cc] = inRing && (onBorder || inCore) ? 1 : 0;
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    const bit: 0 | 1 = i % 2 === 0 ? 1 : 0;
    (grid[6] as (0 | 1 | null)[])[i] = bit;
    (grid[i] as (0 | 1 | null)[])[6] = bit;
  }

  const centres = ALIGNMENT_CENTRES[version - 1] as readonly number[];
  for (const row of centres) {
    for (const col of centres) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const outer = Math.abs(r) === 2 || Math.abs(c) === 2;
          const centre = r === 0 && c === 0;
          (grid[row + r] as (0 | 1 | null)[])[col + c] = outer || centre ? 1 : 0;
        }
      }
    }
  }

  // The dark module: always set, always at this position.
  (grid[size - 8] as (0 | 1 | null)[])[8] = 1;

  // Reserve the format-information strips so data placement skips them.
  for (let i = 0; i <= 8; i += 1) {
    if ((grid[8] as (0 | 1 | null)[])[i] === null) (grid[8] as (0 | 1 | null)[])[i] = 0;
    if ((grid[i] as (0 | 1 | null)[])[8] === null) (grid[i] as (0 | 1 | null)[])[8] = 0;
  }
  for (let i = 0; i < 8; i += 1) {
    if ((grid[8] as (0 | 1 | null)[])[size - 1 - i] === null) (grid[8] as (0 | 1 | null)[])[size - 1 - i] = 0;
    if ((grid[size - 1 - i] as (0 | 1 | null)[])[8] === null) (grid[size - 1 - i] as (0 | 1 | null)[])[8] = 0;
  }

  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const row = Math.floor(i / 3);
      const col = size - 11 + (i % 3);
      (grid[row] as (0 | 1 | null)[])[col] = 0;
      (grid[col] as (0 | 1 | null)[])[row] = 0;
    }
  }
}

function functionMask(version: number, size: number): boolean[][] {
  const probe: Grid = Array.from({ length: size }, () => new Array<0 | 1 | null>(size).fill(null));
  placeFunctionPatterns(probe, version);
  return probe.map((row) => row.map((cell) => cell !== null));
}

function placeData(grid: Grid, reserved: boolean[][], codewords: readonly number[]): void {
  const size = grid.length;
  let bitIndex = 0;
  const nextBit = (): 0 | 1 => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex += 1;
    return bit as 0 | 1;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    const col = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if ((reserved[row] as boolean[])[c]) continue;
        (grid[row] as (0 | 1 | null)[])[c] = nextBit();
      }
    }
    upward = !upward;
  }
}

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

function penalty(grid: readonly (readonly (0 | 1)[])[]): number {
  const size = grid.length;
  let score = 0;

  const runScore = (line: readonly (0 | 1)[]) => {
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  };
  for (let i = 0; i < size; i += 1) {
    runScore(grid[i] as readonly (0 | 1)[]);
    runScore(grid.map((row) => (row as readonly (0 | 1)[])[i] as 0 | 1));
  }

  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const a = (grid[r] as readonly (0 | 1)[])[c];
      if (
        a === (grid[r] as readonly (0 | 1)[])[c + 1] &&
        a === (grid[r + 1] as readonly (0 | 1)[])[c] &&
        a === (grid[r + 1] as readonly (0 | 1)[])[c + 1]
      ) {
        score += 3;
      }
    }
  }

  const FINDER = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const matches = (line: readonly (0 | 1)[], at: number, pattern: readonly number[]) =>
    pattern.every((bit, i) => line[at + i] === bit);
  const lineScore = (line: readonly (0 | 1)[]) => {
    for (let i = 0; i + 11 <= line.length; i += 1) {
      if (matches(line, i, FINDER) || matches(line, i, [...FINDER].reverse())) score += 40;
    }
  };
  for (let i = 0; i < size; i += 1) {
    lineScore(grid[i] as readonly (0 | 1)[]);
    lineScore(grid.map((row) => (row as readonly (0 | 1)[])[i] as 0 | 1));
  }

  let dark = 0;
  for (const row of grid) for (const cell of row) dark += cell;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function writeFormat(grid: (0 | 1)[][], mask: number): void {
  const size = grid.length;
  const bits = formatBits(mask);
  const bit = (i: number): 0 | 1 => ((bits >> i) & 1) as 0 | 1;

  for (let i = 0; i <= 5; i += 1) (grid[8] as (0 | 1)[])[i] = bit(i);
  (grid[8] as (0 | 1)[])[7] = bit(6);
  (grid[8] as (0 | 1)[])[8] = bit(7);
  (grid[7] as (0 | 1)[])[8] = bit(8);
  for (let i = 9; i <= 14; i += 1) (grid[14 - i] as (0 | 1)[])[8] = bit(i);

  // Bits 0-6 run up the left column; 7-14 run along row 8. The dark module at
  // [size-8][8] sits between them and is NOT part of the strip.
  for (let i = 0; i <= 6; i += 1) (grid[size - 1 - i] as (0 | 1)[])[8] = bit(i);
  for (let i = 7; i <= 14; i += 1) (grid[8] as (0 | 1)[])[size - 15 + i] = bit(i);
}

function writeVersion(grid: (0 | 1)[][], version: number): void {
  if (version < 7) return;
  const size = grid.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const value = ((bits >> i) & 1) as 0 | 1;
    const row = Math.floor(i / 3);
    const col = size - 11 + (i % 3);
    (grid[row] as (0 | 1)[])[col] = value;
    (grid[col] as (0 | 1)[])[row] = value;
  }
}

/**
 * Which modules carry structure rather than data — the finders, timing,
 * alignment, dark module and the reserved format/version strips. Everything
 * else, in zigzag order, is the codeword stream, which is what makes a symbol
 * readable back out of its own matrix.
 */
export function qrReservedModules(version: number): boolean[][] {
  return functionMask(version, version * 4 + 17);
}

export interface QrSymbol {
  readonly version: number;
  readonly size: number;
  /** `modules[row][col]` — 1 is dark. Excludes the quiet zone. */
  readonly modules: readonly (readonly (0 | 1)[])[];
}

/** Null when the value is empty or longer than version 10 at level M can carry. */
export function encodeQr(value: string): QrSymbol | null {
  if (value === "") return null;
  const bytes = utf8Bytes(value);
  const version = chooseVersion(bytes.length);
  if (version === null) return null;

  const codewords = interleave(buildDataCodewords(bytes, version), version);
  const size = version * 4 + 17;
  const reserved = functionMask(version, size);

  const base: Grid = Array.from({ length: size }, () => new Array<0 | 1 | null>(size).fill(null));
  placeFunctionPatterns(base, version);
  placeData(base, reserved, codewords);

  let best: (0 | 1)[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate: (0 | 1)[][] = base.map((row, r) =>
      row.map((cell, c) => {
        const bit = (cell ?? 0) as 0 | 1;
        if ((reserved[r] as boolean[])[c]) return bit;
        return (maskBit(mask, r, c) ? bit ^ 1 : bit) as 0 | 1;
      }),
    );
    writeFormat(candidate, mask);
    writeVersion(candidate, version);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return { version, size, modules: best as (0 | 1)[][] };
}
