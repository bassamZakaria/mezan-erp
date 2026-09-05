// Regenerates build/icon.png, build/icon.ico and (on macOS) build/icon.icns
// from the two source SVGs. The outputs are COMMITTED — this is a by-hand tool run
// when the mark changes, not a build step, so nothing in CI or in
// `pnpm desktop:package` depends on Chrome being installed.
//
// Chrome rasterizes rather than Electron: the obvious implementation, an
// offscreen BrowserWindow and capturePage, hangs forever under the sandboxed
// shells this repo is usually driven from, because app.whenReady() never
// resolves there, and a generator that hangs is worse than one that needs a
// browser on PATH.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const buildDir = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
// TWO drawings of the same mark, not one drawing at two scales.
//
// icon.svg is the stroked balance-beam glyph the UI draws
// (packages/ui/src/shell/BrandMark.tsx). Below about 48px its strokes and the
// gaps between them fall under one pixel: at 16px the beam, the two pans and
// the base merge into a blob with no readable silhouette, which is the size
// Windows puts in the title bar and in Explorer's list views.
//
// icon-small.svg redraws the same object in solid fills on a 16-unit grid, so
// every edge lands on a whole pixel at 16px and on a half pixel at 24px. It is
// the same scale — beam, post, two pans, base — with the detail that cannot
// survive removed, not a different logo.
const ART = {
  detail: readFileSync(join(buildDir, "icon.svg"), "utf8"),
  small: readFileSync(join(buildDir, "icon-small.svg"), "utf8"),
};

// Below this, the stroked drawing stops being legible. Verified by eye at each
// size, not guessed: 48 is the smallest at which the pans still read as pans.
const SMALL_ART_MAX = 32;
const artFor = (size) => (size <= SMALL_ART_MAX ? ART.small : ART.detail);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error(`No Chrome found. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}\nSet CHROME_PATH.`);

// Union of what the three containers want: 16/32/64/128/256/512/1024 for the
// .icns members, 16/24/32/48/64/128/256 for the .ico, 1024 for the .png.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICNS_PAIRS = [[16, 32], [32, 64], [128, 256], [256, 512], [512, 1024]];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const scratch = join(tmpdir(), `mezan-icon-${process.pid}`);
mkdirSync(scratch, { recursive: true });

function render(size) {
  const html = join(scratch, `${size}.html`);
  const png = join(scratch, `${size}.png`);
  writeFileSync(
    html,
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${artFor(size)}`,
  );
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      // Without this the shot lands on opaque white and the rounded corners of
      // the tile come back as white wedges on every platform.
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${png}`,
      html,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  const bytes = readFileSync(png);
  unlinkSync(html);
  unlinkSync(png);
  return bytes;
}

/**
 * Minimal PNG reader, enough for what Chrome writes here: 8-bit RGBA,
 * non-interlaced. Returns straight RGBA rows. Asserts the format rather than
 * handling every PNG, so a Chrome that started emitting something else fails
 * loudly instead of producing a scrambled icon.
 */
function decodePng(buf) {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const [bitDepth, colorType, , , interlace] = [buf[24], buf[25], buf[26], buf[27], buf[28]];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`Unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }

  const chunks = [];
  for (let off = 8; off + 8 <= buf.length; ) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") chunks.push(buf.subarray(off + 8, off + 8 + length));
    if (type === "IEND") break;
    off += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let value;
      switch (filter) {
        case 0: value = line[x]; break;
        case 1: value = line[x] + a; break;
        case 2: value = line[x] + b; break;
        case 3: value = line[x] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          value = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Unknown PNG filter ${filter} on row ${y}`);
      }
      out[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, rgba: out };
}

/**
 * One ICO member in the classic DIB form: a BITMAPINFOHEADER whose biHeight is
 * doubled to cover the colour rows plus the AND mask, then bottom-up BGRA rows,
 * then the 1-bit mask.
 *
 * The 32-bit alpha channel is what modern Windows actually composites, but the
 * AND mask is NOT vestigial — Explorer still consults it in some list views,
 * and a mask of all zeros there paints the transparent corners of the tile as
 * black squares. It is written from the alpha channel for that reason.
 */
function dibEntry(png) {
  const { width, height, rgba } = decodePng(png);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);

  const colors = Buffer.alloc(width * height * 4);
  const maskStride = (((width + 31) >> 5) * 4);
  const mask = Buffer.alloc(maskStride * height);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const o = (y * width + x) * 4;
      colors[o] = rgba[i + 2];
      colors[o + 1] = rgba[i + 1];
      colors[o + 2] = rgba[i];
      colors[o + 3] = rgba[i + 3];
      if (rgba[i + 3] === 0) mask[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, colors, mask]);
}

function buildIco(rendered) {
  // 256 stays PNG-compressed: that is the form Vista introduced the size in,
  // and a 256x256 DIB member would add ~256KB of uncompressed pixels on its own.
  const members = ICO_SIZES.map((size) => ({
    size,
    data: size === 256 ? rendered.get(256) : dibEntry(rendered.get(size)),
  }));

  const dir = Buffer.alloc(6 + members.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(members.length, 4);

  let offset = dir.length;
  members.forEach((member, index) => {
    const at = 6 + index * 16;
    // 0 means 256 in an ICONDIRENTRY — the field is one byte.
    dir.writeUInt8(member.size === 256 ? 0 : member.size, at);
    dir.writeUInt8(member.size === 256 ? 0 : member.size, at + 1);
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(member.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += member.data.length;
  });

  return Buffer.concat([dir, ...members.map((m) => m.data)]);
}

const rendered = new Map(SIZES.map((size) => [size, render(size)]));

writeFileSync(join(buildDir, "icon.png"), rendered.get(1024));
writeFileSync(join(buildDir, "icon.ico"), buildIco(rendered));

if (process.platform === "darwin") {
  // electron-builder can derive an .icns from the .png on its own, but it does
  // that by downsampling one bitmap. Packing the per-size renders means the
  // 16px menu-bar member was actually laid out at 16px.
  const iconset = join(scratch, "icon.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const [base, retina] of ICNS_PAIRS) {
    writeFileSync(join(iconset, `icon_${base}x${base}.png`), rendered.get(base));
    writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), rendered.get(retina));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(buildDir, "icon.icns")]);
}

rmSync(scratch, { recursive: true, force: true });

const png = readFileSync(join(buildDir, "icon.png"));
if (png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) {
  throw new Error(`icon.png rendered at ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, expected 1024x1024`);
}
const small = SIZES.filter((s) => s <= SMALL_ART_MAX).join("/");
const detail = SIZES.filter((s) => s > SMALL_ART_MAX).join("/");
console.log(`icon.png 1024x1024, icon.ico ${ICO_SIZES.join("/")}${process.platform === "darwin" ? ", icon.icns" : ""}`);
console.log(`  icon-small.svg at ${small}; icon.svg at ${detail}`);
