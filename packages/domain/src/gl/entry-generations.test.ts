import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../journal.js";
import { nextEntryGenerationId, standingEntryGeneration } from "./entry-generations.js";

function ledgerOf(statuses: Record<string, JournalEntry["status"]>) {
  return { findById: async (id: string) => (id in statuses ? ({ id, status: statuses[id] } as JournalEntry) : null) };
}

describe("entry generations — a deterministic entry id is reused only after its entry is reversed", () => {
  it("a first posting takes the id itself", async () => {
    expect(await nextEntryGenerationId(ledgerOf({}), "DEP:2026-08")).toBe("DEP:2026-08");
  });

  it("while the entry stands the same id comes back, so a second posting collides instead of posting twice", async () => {
    expect(await nextEntryGenerationId(ledgerOf({ "DEP:2026-08": "posted" }), "DEP:2026-08")).toBe("DEP:2026-08");
    expect(await nextEntryGenerationId(ledgerOf({ "DEP:2026-08": "reversed", "DEP:2026-08#2": "posted" }), "DEP:2026-08")).toBe("DEP:2026-08#2");
  });

  it("once it is reversed the next generation is free, and the one after once that is reversed too", async () => {
    expect(await nextEntryGenerationId(ledgerOf({ "DEP:2026-08": "reversed" }), "DEP:2026-08")).toBe("DEP:2026-08#2");
    expect(await nextEntryGenerationId(ledgerOf({ "DEP:2026-08": "reversed", "DEP:2026-08#2": "reversed" }), "DEP:2026-08")).toBe("DEP:2026-08#3");
  });

  it("the standing generation is the one not reversed, or none", async () => {
    expect((await standingEntryGeneration(ledgerOf({ "DEP:2026-08": "reversed", "DEP:2026-08#2": "posted" }), "DEP:2026-08"))?.id).toBe("DEP:2026-08#2");
    expect(await standingEntryGeneration(ledgerOf({ "DEP:2026-08": "reversed" }), "DEP:2026-08")).toBeNull();
  });
});
