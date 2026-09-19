import type { ScenarioFragment } from "./fragments.js";
import { scenario as e1_01 } from "./enh-e1-01.js";
import { scenario as e1_02 } from "./enh-e1-02.js";
import { scenario as e1_03 } from "./enh-e1-03.js";
import { scenario as e1_04 } from "./enh-e1-04.js";
import { scenario as e1_05 } from "./enh-e1-05.js";
import { scenario as e1_06 } from "./enh-e1-06.js";
import { scenario as e2_01 } from "./enh-e2-01.js";
import { scenario as e2_02 } from "./enh-e2-02.js";
import { scenario as e2_03 } from "./enh-e2-03.js";
import { scenario as e2_04 } from "./enh-e2-04.js";
import { scenario as e2_08 } from "./enh-e2-08.js";
import { scenario as e2_09 } from "./enh-e2-09.js";
import { scenario as e2_10 } from "./enh-e2-10.js";
import { scenario as e2_11 } from "./enh-e2-11.js";
import { scenario as e3_01 } from "./enh-e3-01.js";
import { scenario as e3_02 } from "./enh-e3-02.js";
import { scenario as e3_03 } from "./enh-e3-03.js";
import { scenario as e3_04 } from "./enh-e3-04.js";
import { scenario as e3_06 } from "./enh-e3-06.js";
import { scenario as e3_07 } from "./enh-e3-07.js";
import { scenario as e3_08 } from "./enh-e3-08.js";
import { scenario as e3_09 } from "./enh-e3-09.js";
import { scenario as e3_10 } from "./enh-e3-10.js";

export const ENH_SCENARIOS: readonly (readonly [string, ScenarioFragment])[] = [
  ["enh-e1-01", e1_01],
  ["enh-e1-02", e1_02],
  ["enh-e1-03", e1_03],
  ["enh-e1-04", e1_04],
  ["enh-e1-05", e1_05],
  ["enh-e1-06", e1_06],
  ["enh-e2-01", e2_01],
  ["enh-e2-02", e2_02],
  ["enh-e2-03", e2_03],
  ["enh-e2-04", e2_04],
  ["enh-e2-08", e2_08],
  ["enh-e2-09", e2_09],
  ["enh-e2-10", e2_10],
  ["enh-e2-11", e2_11],
  ["enh-e3-01", e3_01],
  ["enh-e3-02", e3_02],
  ["enh-e3-03", e3_03],
  ["enh-e3-04", e3_04],
  ["enh-e3-06", e3_06],
  ["enh-e3-07", e3_07],
  ["enh-e3-08", e3_08],
  ["enh-e3-09", e3_09],
  ["enh-e3-10", e3_10],
];

export const ENH_SMOKE_PATHS: readonly string[] = ENH_SCENARIOS.flatMap(([, s]) => s.smokePaths ?? []);
