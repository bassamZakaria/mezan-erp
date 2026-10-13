import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";
import { allowBackorders, describeFailure, secondWarehouse, stockWalk } from "./test-helpers/stock-walk.js";

const REVIEW_SEEDS = [13, 100, 106, 215, 231, 237];
const SPREAD_SEEDS = Array.from({ length: 62 }, (_, index) => index + 1).filter((seed) => !REVIEW_SEEDS.includes(seed));
const REVIEW_STEPS = 60;
const SPREAD_STEPS = 24;

function seedsFromEnvironment(): number[] | null {
  const range = /^(\d+)-(\d+)$/.exec(process.env.STOCK_WALK_SEEDS ?? "");
  if (!range) return null;
  const first = Number(range[1]);
  const last = Number(range[2]);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

const seeds = seedsFromEnvironment() ?? [...REVIEW_SEEDS, ...SPREAD_SEEDS];
const stepsFor = (seed: number) => Number(process.env.STOCK_WALK_STEPS ?? (REVIEW_SEEDS.includes(seed) ? REVIEW_STEPS : SPREAD_STEPS));
const SEEDS_PER_TENANT = 34;

describe("a random walk over every stock path keeps each position and its control account true", () => {
  for (let start = 0; start < seeds.length; start += SEEDS_PER_TENANT) {
    const batch = seeds.slice(start, start + SEEDS_PER_TENANT);
    describe(`seeds ${batch[0]}…${batch[batch.length - 1]}`, () => {
      let kit: BackendKit;
      let otherWarehouse: string;

      const freshTenant = async () => {
        kit = await bootBackendKit();
        await allowBackorders(kit);
        otherWarehouse = await secondWarehouse(kit);
      };

      beforeAll(freshTenant, 120_000);

      afterAll(async () => {
        await kit.close();
      });

      for (const seed of batch) {
        it(`seed ${seed}: no position is left with value and no quantity or quantity below zero value, every control ties, and a rebuild changes nothing`, async () => {
          const outcome = await stockWalk(kit, otherWarehouse, seed, stepsFor(seed));
          await new Promise((resume) => setImmediate(resume));
          if (outcome.failure !== null) {
            await kit.close();
            await freshTenant();
          }
          expect(outcome.failure === null ? "" : describeFailure(outcome.failure)).toBe("");
        }, 300_000);
      }
    });
  }
});
