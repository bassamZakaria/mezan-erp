import { describe, expect, it } from "vitest";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";
import { AS_OF_DAYS, PostingOrder, balanceDifferences, generate, generateWide, order, play, type Trial } from "./test-helpers/fx-order-probe.js";

enum Generator {
  Dated = "dated",
  Routed = "routed",
  Wide = "wide",
  WideReplacing = "wide, bounced cheques replaced",
}

const REVIEWED: Record<Generator, readonly number[]> = {
  [Generator.Dated]: [13, 38, 119, 254, 256, 268, 288],
  [Generator.Routed]: [1105, 1178, 1234, 1287, 2019, 2031, 2199],
  [Generator.Wide]: [5068, 5075, 5080, 5087, 5095, 5104, 5123, 5151],
  [Generator.WideReplacing]: [6145],
};
const SWEEP_CHUNK = 25;
const WIDE_SWEEP = Number(process.env.FX_ORDER_SWEEP ?? 0);
const sweep = (from: number, chunks: number) => Array.from({ length: chunks }, (_unused, chunk) => ({ from: from + chunk * SWEEP_CHUNK, to: from + (chunk + 1) * SWEEP_CHUNK - 1 }));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_unused, index) => from + index);

function trialOf(seed: number, generator: Generator): Trial {
  if (generator === Generator.Wide) return generateWide(seed, { replaceBounced: false });
  if (generator === Generator.WideReplacing) return generateWide(seed, { replaceBounced: true });
  return generate(seed, { routeAllocs: generator === Generator.Routed });
}

async function findings(seed: number, generator: Generator): Promise<string[]> {
  const trial = trialOf(seed, generator);
  const chronological = await play(trial, order(trial, PostingOrder.Chronological));
  const runsLast = await play(trial, order(trial, PostingOrder.RunsLast));
  const out: string[] = [];
  for (const [name, outcome] of [[PostingOrder.Chronological, chronological], [PostingOrder.RunsLast, runsLast]] as const) {
    if (JSON.stringify(outcome.inv) !== JSON.stringify(INVARIANTS_ZERO)) out.push(`invariants[${name}] ${JSON.stringify(outcome.inv)}`);
    if (outcome.residue.length > 0) out.push(`residue[${name}] ${JSON.stringify(outcome.residue)}`);
    for (const line of outcome.oracle) out.push(`carrying[${name}] ${line}`);
  }
  const sameRefusals = JSON.stringify([...chronological.refused].sort()) === JSON.stringify([...runsLast.refused].sort());
  if (!sameRefusals) out.push(`refusals ${JSON.stringify(chronological.refused)} vs ${JSON.stringify(runsLast.refused)}`);
  for (const line of balanceDifferences(chronological.tb, runsLast.tb)) out.push(`books ${line}`);
  for (const day of AS_OF_DAYS) for (const line of balanceDifferences(chronological.asOf[day]!, runsLast.asOf[day]!)) out.push(`books as of ${day} ${line}`);
  return out.map((line) => `seed ${seed} ${generator}: ${line}`);
}

async function findingsOver(seeds: readonly number[], generator: Generator): Promise<string[]> {
  const out: string[] = [];
  for (const seed of seeds) out.push(...(await findings(seed, generator)));
  return out;
}

describe("month-end runs posted after the documents they restate leave the books the chronological order leaves", () => {
  it.each(Object.values(Generator).filter((generator) => REVIEWED[generator].length > 0))("the sequences the reviews found, %s: same balances to the micro-unit at the end and at each month end, no residue, every invariant zero", async (generator) => {
    expect(await findingsOver(REVIEWED[generator], generator)).toEqual([]);
  }, 120_000);

  it.each(sweep(1, 1))("dated settlements, seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), Generator.Dated)).toEqual([]);
  }, 120_000);

  it.each(sweep(1001, 1))("allocations through the voucher route, seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), Generator.Routed)).toEqual([]);
  }, 120_000);

  it.each(sweep(6001, 1))("up to three items, redo after undo, reliefs on run days, a run reversed and posted again, bounced cheques replaced — seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), Generator.WideReplacing)).toEqual([]);
  }, 180_000);
});

describe.runIf(WIDE_SWEEP > 0)(`the wide sweep (FX_ORDER_SWEEP=${WIDE_SWEEP})`, () => {
  it.each(sweep(26, 2))("dated settlements, seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), Generator.Dated)).toEqual([]);
  }, 180_000);

  it.each(sweep(1026, 2))("allocations through the voucher route, seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), Generator.Routed)).toEqual([]);
  }, 180_000);

  it.each(sweep(6026, Math.ceil(WIDE_SWEEP / SWEEP_CHUNK)))("wide sequences with bounced cheques replaced, seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), Generator.WideReplacing)).toEqual([]);
  }, 300_000);

  it.each(sweep(5001, 8))("wide sequences as the review generated them, seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), Generator.Wide)).toEqual([]);
  }, 300_000);
});
