import { describe, expect, it } from "vitest";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";
import { PostingOrder, balanceDifferences, generate, order, play } from "./test-helpers/fx-order-probe.js";

const REVIEWED_DATED = [13, 38, 119, 254, 256, 268, 288];
const REVIEWED_ROUTED = [1105, 1178, 1234, 1287];
const SWEEP_CHUNK = 25;
const sweep = (from: number, chunks: number) => Array.from({ length: chunks }, (_unused, chunk) => ({ from: from + chunk * SWEEP_CHUNK, to: from + (chunk + 1) * SWEEP_CHUNK - 1 }));

async function findings(seed: number, routeAllocs: boolean): Promise<string[]> {
  const trial = generate(seed, { routeAllocs });
  const chronological = await play(trial, order(trial, PostingOrder.Chronological));
  const runsLast = await play(trial, order(trial, PostingOrder.RunsLast));
  const out: string[] = [];
  for (const [name, outcome] of [[PostingOrder.Chronological, chronological], [PostingOrder.RunsLast, runsLast]] as const) {
    if (JSON.stringify(outcome.inv) !== JSON.stringify(INVARIANTS_ZERO)) out.push(`invariants[${name}] ${JSON.stringify(outcome.inv)}`);
    if (outcome.residue.length > 0) out.push(`residue[${name}] ${JSON.stringify(outcome.residue)}`);
    for (const line of outcome.oracle) out.push(`carrying[${name}] ${line}`);
  }
  if (JSON.stringify([...chronological.refused].sort()) !== JSON.stringify([...runsLast.refused].sort())) out.push(`refusals ${JSON.stringify(chronological.refused)} vs ${JSON.stringify(runsLast.refused)}`);
  for (const line of balanceDifferences(chronological.tb, runsLast.tb)) out.push(`books ${line}`);
  return out.map((line) => `seed ${seed}${routeAllocs ? " routed" : " dated"}: ${line}`);
}

async function findingsOver(seeds: readonly number[], routeAllocs: boolean): Promise<string[]> {
  const out: string[] = [];
  for (const seed of seeds) out.push(...(await findings(seed, routeAllocs)));
  return out;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_unused, index) => from + index);

describe("month-end runs posted after the documents they restate leave the books the chronological order leaves", () => {
  it("the sequences the review found: same control balances, same net realised and unrealised, no residue, every invariant zero", async () => {
    expect([...(await findingsOver(REVIEWED_DATED, false)), ...(await findingsOver(REVIEWED_ROUTED, true))]).toEqual([]);
  }, 120_000);

  it.each(sweep(1, 3))("dated settlements, seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), false)).toEqual([]);
  }, 120_000);

  it.each(sweep(1001, 3))("allocations through the voucher route, seeds $from–$to", async ({ from, to }) => {
    expect(await findingsOver(range(from, to), true)).toEqual([]);
  }, 120_000);
});
