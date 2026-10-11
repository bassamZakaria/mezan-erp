import { afterEach, expect } from "vitest";
import { drainForeignWrites, drainUntransactedAudits } from "@mezan/persistence";
import { drainTurnYields } from "../turn-yields.js";

afterEach(() => {
  const routes = [...new Set(drainTurnYields())].sort().join(", ");
  const audits = [...new Set(drainUntransactedAudits())].sort().join(", ");
  expect(routes, "handlers that awaited work outside the database while holding a tenant's connection").toBe("");
  const lost = [...new Set(drainForeignWrites())].sort().join(" | ");
  expect(audits, "change-log events a mutating request appended outside any transaction").toBe("");
  expect(lost, "writes that landed inside another operation's open transaction").toBe("");
});
