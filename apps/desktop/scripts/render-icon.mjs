// Regenerates build/icon.png (and, on macOS, build/icon.icns) from
// build/icon.svg. The outputs are COMMITTED — this is a designer-side tool run
// by hand when the mark changes, not a build step, so nothing in CI or in
// `pnpm desktop:package` depends on Chrome being installed.
//
// Chrome rasterizes rather than Electron because Electron's `app.whenReady()`
// never resolves under the sandboxed shells this repo is usually driven from,
// and a generator that hangs is worse than one that needs a browser on PATH.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const buildDir = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
const svg = readFileSync(join(buildDir, "icon.svg"), "utf8");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error(`No Chrome found. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}\nSet CHROME_PATH.`);

// The member sizes an .icns carries. 1024 also becomes the .png that
// electron-builder turns into the Windows .ico and the Linux images.
const SIZES = [16, 32, 64, 128, 256, 512, 1024];

const scratch = join(tmpdir(), `mezan-icon-${process.pid}`);
mkdirSync(scratch, { recursive: true });

function render(size) {
  const html = join(scratch, `${size}.html`);
  const png = join(scratch, `${size}.png`);
  writeFileSync(
    html,
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
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

const rendered = new Map(SIZES.map((size) => [size, render(size)]));

writeFileSync(join(buildDir, "icon.png"), rendered.get(1024));

if (process.platform === "darwin") {
  // electron-builder can derive an .icns from the .png on its own, but it does
  // that by downsampling one bitmap. Packing the per-size renders means the
  // 16px menu-bar member was actually laid out at 16px.
  const iconset = join(scratch, "icon.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const [base, retina] of [[16, 32], [32, 64], [128, 256], [256, 512], [512, 1024]]) {
    writeFileSync(join(iconset, `icon_${base}x${base}.png`), rendered.get(base));
    writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), rendered.get(retina));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(buildDir, "icon.icns")]);
}

rmSync(scratch, { recursive: true, force: true });

const png = readFileSync(join(buildDir, "icon.png"));
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== 1024 || height !== 1024) throw new Error(`icon.png rendered at ${width}x${height}, expected 1024x1024`);
console.log(`icon.png ${width}x${height}${process.platform === "darwin" ? " + icon.icns" : ""}`);
