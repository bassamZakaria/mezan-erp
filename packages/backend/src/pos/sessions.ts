import { createSqlitePosSessionStore } from "@mezan/persistence";
import type { BackendArea } from "../module-context.js";

/** Creates the `pos_session` schema; the sessions lane adds its routes here. */
export const area: BackendArea = {
  mount(ctx) {
    ctx.addCloser(createSqlitePosSessionStore(ctx.sqlite));
  },
};
