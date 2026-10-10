import { afterEach, expect } from "vitest";
import { drainTurnYields } from "../turn-yields.js";

afterEach(() => {
  expect(drainTurnYields(), "handlers that awaited work outside the database while holding a tenant's connection").toEqual([]);
});
