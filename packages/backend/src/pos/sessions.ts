import { createSqlitePosSessionStore, createPosSessionStore } from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";

/** Creates the `pos_session` schema; the sessions lane adds its routes here. */
export const area: BackendArea = {
  mount(ctx) {
    ctx.addCloser(ctx.store((s) => createSqlitePosSessionStore(s), (d) => createPosSessionStore(d)));
  },
};
