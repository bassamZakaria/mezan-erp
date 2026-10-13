import { describe, expect, it } from "vitest";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";
import { AS_OF_DAYS, Cur, OpKind, PostingOrder, Side, balanceDifferences, generate, generateWide, order, play, type Trial } from "./test-helpers/fx-order-probe.js";

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
const DEFAULT_SWEEP: Record<Generator, readonly number[]> = {
  [Generator.Dated]: [1, 2, 3, 4, 5],
  [Generator.Routed]: [1001, 1002, 1003, 1004, 1005],
  [Generator.Wide]: [],
  [Generator.WideReplacing]: [6001, 6002, 6003, 6004, 6005],
};
const WIDE_SWEEP = Number(process.env.FX_ORDER_SWEEP ?? 0);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_unused, index) => from + index);
const WIDE_SWEEP_SEEDS: Record<Generator, readonly number[]> = {
  [Generator.Dated]: range(6, 75),
  [Generator.Routed]: range(1006, 1075),
  [Generator.Wide]: range(5001, 5200),
  [Generator.WideReplacing]: range(6006, 6025 + WIDE_SWEEP),
};
const cases = (seeds: Record<Generator, readonly number[]>) => Object.values(Generator).flatMap((generator) => seeds[generator].map((seed) => ({ generator, seed })));

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

describe("month-end runs posted after the documents they restate leave the books the chronological order leaves", () => {
  it.each(cases(REVIEWED))("a sequence a review found — $generator, seed $seed: same balances to the micro-unit at the end and at each month end, no residue, every invariant zero", async ({ generator, seed }) => {
    expect(await findings(seed, generator)).toEqual([]);
  }, 60_000);

  it.each(cases(DEFAULT_SWEEP))("$generator, seed $seed", async ({ generator, seed }) => {
    expect(await findings(seed, generator)).toEqual([]);
  }, 60_000);
});

describe("a run posted late dates each release on the day of the relief that caused it", () => {
  const trial: Trial = {
    seed: 0,
    items: [{ id: "it0", side: Side.Receivable, cur: Cur.Usd, units: 10, price: "100", date: "2026-08-03" }],
    ops: [
      { k: OpKind.SettleRoute, item: 0, pct: 40, date: "2026-09-12", id: "c1", foreign: true },
      { k: OpKind.SettleRoute, item: 0, pct: 50, date: "2026-10-04", id: "c2", foreign: true },
    ],
    runs: [
      { k: OpKind.Run, date: "2026-08-31", auto: false, idx: 0 },
      { k: OpKind.Run, date: "2026-09-05", auto: false, idx: 1 },
    ],
    runrevs: [],
  };
  const DAYS = ["2026-08-31", "2026-09-05", "2026-09-12", "2026-09-30", "2026-10-04"] as const;

  it("USD 1,000 invoiced 3 Aug, 400 collected 12 Sep, 300 collected 4 Oct, runs of 31 Aug @48.45 and 5 Sep @48.20: the receivable reads the same on 12 Sep and on 30 Sep whichever order they were posted in", async () => {
    const chronological = await play(trial, order(trial, PostingOrder.Chronological), DAYS);
    const runsLast = await play(trial, order(trial, PostingOrder.RunsLast), DAYS);

    expect(chronological.refused).toEqual([]);
    expect(runsLast.refused).toEqual([]);
    expect(chronological.asOf["2026-09-30"]!.get("1105")).toBe(28_920_000_000n);
    for (const day of ["2026-09-12", "2026-09-30"]) expect(runsLast.asOf[day]!.get("1105"), day).toBe(chronological.asOf[day]!.get("1105"));
    for (const day of DAYS) expect(balanceDifferences(chronological.asOf[day]!, runsLast.asOf[day]!), day).toEqual([]);
    expect(balanceDifferences(chronological.tb, runsLast.tb)).toEqual([]);
    expect(runsLast.inv).toEqual(INVARIANTS_ZERO);
  }, 120_000);
});

describe.runIf(WIDE_SWEEP > 0)(`the wide sweep (FX_ORDER_SWEEP=${WIDE_SWEEP})`, () => {
  it.each(cases(WIDE_SWEEP_SEEDS))("$generator, seed $seed", async ({ generator, seed }) => {
    expect(await findings(seed, generator)).toEqual([]);
  }, 60_000);
});
