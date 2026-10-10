import { afterEach, expect } from "vitest";
import { drainTurnYields } from "../turn-yields.js";

afterEach(() => {
  const routes = [...new Set(drainTurnYields())].sort().join(", ");
  expect(routes, "handlers that awaited work outside the database while holding a tenant's connection").toBe("");
});
