import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `pnpm trails` — turns docs/scenarios/10-posting-trails.md into the tickable
 * page published as an Artifact. The markdown is the source of truth; this
 * script never edits it, and the page is regenerated whole on every run.
 *
 * The parser is deliberately strict, so a malformed trail fails the build
 * instead of silently disappearing from the page:
 *
 *   ## T01 · Sales — Quote to collection
 *   Modules: Sales · Inventory
 *   Executable: cross-module.ts x40
 *
 *   1. [ok] The action, named as the screen names it.
 *      - Where: what must be true afterwards.
 *      - !Where: what is wrong today.
 *   Done: the pair that must agree.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SOURCE = join(root, "docs/scenarios/10-posting-trails.md");
const OUT = process.argv[2] ?? join(root, "docs/scenarios/trail-pack.html");

function parse(md) {
  const trails = [];
  let trail = null;
  let step = null;
  let fenced = false;

  const push = () => {
    if (!trail) return;
    if (!trail.steps.length) throw new Error(`${trail.id} has no steps`);
    if (!trail.done) throw new Error(`${trail.id} has no "Done:" line`);
    trails.push(trail);
  };

  for (const raw of md.split("\n")) {
    if (raw.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) continue;

    const head = /^## (T\d+) · ([^—]+?) — (.+)$/.exec(raw);
    if (head) {
      push();
      trail = { id: head[1], group: head[2].trim(), title: head[3].trim(), mods: [], exec: "", steps: [], done: "" };
      step = null;
      continue;
    }
    if (!trail) continue;

    if (raw.startsWith("Modules: ")) { trail.mods = raw.slice(9).split("·").map((m) => m.trim()).filter(Boolean); continue; }
    if (raw.startsWith("Executable: ")) { trail.exec = raw.slice(12).trim(); continue; }
    if (raw.startsWith("Done: ")) { trail.done = raw.slice(6).trim(); step = null; continue; }

    const stepLine = /^\d+\. \[(ok|open|stop)(?: ([^\]]+))?\] (.+)$/.exec(raw);
    if (stepLine) {
      step = { flag: stepLine[1], code: stepLine[2] ?? "", act: stepLine[3].trim(), fx: [] };
      trail.steps.push(step);
      continue;
    }

    const fx = /^ {3}- (!?)([^:]+): (.+)$/.exec(raw);
    if (fx && step) { step.fx.push([fx[2].trim(), fx[3].trim(), fx[1] === "!"]); continue; }

    if (/^## /.test(raw)) { push(); trail = null; step = null; }
  }
  push();

  for (const t of trails) {
    if (t.flagless) continue;
    for (const s of t.steps) {
      if (s.flag === "stop" && !s.code) throw new Error(`${t.id}: a [stop] step must name its defect`);
    }
  }
  return trails;
}

const trails = parse(readFileSync(SOURCE, "utf8"));
const steps = trails.reduce((n, t) => n + t.steps.length, 0);
const stops = trails.reduce((n, t) => n + t.steps.filter((s) => s.flag === "stop").length, 0);

const TEMPLATE = readFileSync(join(here, "trail-pack.template.html"), "utf8");
const page = TEMPLATE
  .replace("/*__TRAILS__*/null", JSON.stringify(trails))
  .replace("__COUNT_TRAILS__", String(trails.length))
  .replace("__COUNT_STEPS__", String(steps));

writeFileSync(OUT, page);
console.log(`${trails.length} trails · ${steps} steps · ${stops} known stops → ${OUT}`);
