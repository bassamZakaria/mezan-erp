import type { Ctx } from "./harness.js";

export interface ScenarioFragment {
  readonly run?: (ctx: Ctx) => Promise<void>;
  readonly smokePaths?: readonly string[];
}
