import type { BackendArea, BackendModuleContext } from "../module-context.js";
import { area as e1_01 } from "./e1-01.js";
import { area as e1_02, CASH_FORECAST_ALERT_EVENT } from "./e1-02.js";
import { area as e1_03 } from "./e1-03.js";
import { area as e1_04 } from "./e1-04.js";
import { area as e1_05 } from "./e1-05.js";
import { area as e1_06 } from "./e1-06.js";
import { area as e2_01 } from "./e2-01.js";
import { area as e2_02 } from "./e2-02.js";
import { area as e2_03 } from "./e2-03.js";
import { area as e2_04 } from "./e2-04.js";
import { area as e2_08 } from "./e2-08.js";
import { area as e2_09 } from "./e2-09.js";
import { area as e2_10 } from "./e2-10.js";
import { area as e2_11 } from "./e2-11.js";
import { area as e3_01 } from "./e3-01.js";
import { area as e3_02 } from "./e3-02.js";
import { area as e3_03, LOW_STOCK_EVENT } from "./e3-03.js";
import { area as e3_04 } from "./e3-04.js";
import { area as e3_06 } from "./e3-06.js";
import { area as e3_07 } from "./e3-07.js";
import { area as e3_08 } from "./e3-08.js";
import { area as e3_09 } from "./e3-09.js";
import { area as e3_10 } from "./e3-10.js";

/**
 * Event codes the enhancement areas publish. Read by `createBackend` into
 * `/notification-rules/triggers`' `emitted` flag, so an event a rule author can
 * subscribe to is never listed as one nothing raises.
 */
export const ENH_EMITTED_EVENT_CODES = [CASH_FORECAST_ALERT_EVENT, LOW_STOCK_EVENT] as const;

export const ENH_AREAS: readonly (readonly [string, BackendArea])[] = [
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

export async function mountEnhancements(ctx: BackendModuleContext): Promise<void> {
  for (const [, area] of ENH_AREAS) await area.mount?.(ctx);
}
