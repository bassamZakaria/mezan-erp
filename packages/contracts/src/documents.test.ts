import { describe, it, expect } from "vitest";
import {
  documentStatusSchema,
  documentEffectKindSchema,
  documentEffectSchema,
  documentEffectsSchema,
  journalDocumentLineSchema,
  createJournalDocumentSchema,
  journalDocumentEffectsRequestSchema,
} from "./documents.js";

describe("documentStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["draft", "pending", "confirmed", "posted", "cancelled", "reversed"]) {
      expect(documentStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(documentStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("documentEffectSchema", () => {
  const effect = { kind: "gl" as const, description: "posts a journal entry", detail: "2 lines" };

  it("accepts a minimal valid effect and preserves every field verbatim", () => {
    const result = documentEffectSchema.safeParse(effect);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(effect);
  });

  it("accepts an effect without the optional detail", () => {
    const { detail, ...rest } = effect;
    const result = documentEffectSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum kind", () => {
    const result = documentEffectSchema.safeParse({ ...effect, kind: "audit" });
    expect(result.success).toBe(false);
  });
});

describe("documentEffectsSchema", () => {
  const effects = {
    effects: [{ kind: "gl" as const, description: "posts a journal entry" }],
    balanced: true,
    totalDebit: "1000.000000",
    totalCredit: "1000.000000",
    blocked: false,
  };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = documentEffectsSchema.safeParse(effects);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(effects);
  });

  it("accepts a blocked document with only blocked and blockedReason set", () => {
    const result = documentEffectsSchema.safeParse({ effects: [], blocked: true, blockedReason: "period closed" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing blocked", () => {
    const { blocked, ...rest } = effects;
    const result = documentEffectsSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("blocked");
  });

  it("never coerces totalDebit to a float — high-precision decimal string survives verbatim", () => {
    const result = documentEffectsSchema.safeParse({ ...effects, totalDebit: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totalDebit).toBe("0.100001");
  });

  it("rejects totalDebit sent as a JS number instead of a string", () => {
    const result = documentEffectsSchema.safeParse({ ...effects, totalDebit: 1000 });
    expect(result.success).toBe(false);
  });
});

describe("journalDocumentLineSchema", () => {
  const line = { accountId: "acc-1", debit: "1000.123456", credit: "0", memo: "opening" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = journalDocumentLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces debit to a float — high-precision decimal string survives verbatim", () => {
    const result = journalDocumentLineSchema.safeParse({ ...line, debit: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.debit).toBe("0.100001");
  });

  it("rejects debit sent as a JS number instead of a string", () => {
    const result = journalDocumentLineSchema.safeParse({ ...line, debit: 1000 });
    expect(result.success).toBe(false);
  });

  it("carries the cost centre and the two contracting dimensions — it used to strip costCenterId (D-01 threading)", () => {
    const result = journalDocumentLineSchema.safeParse({ ...line, costCenterId: "cc-1", projectId: "prj-1", costCategory: "materials" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.costCenterId).toBe("cc-1");
      expect(result.data.projectId).toBe("prj-1");
      expect(result.data.costCategory).toBe("materials");
    }
  });

  it("refuses a cost category outside the enum", () => {
    expect(journalDocumentLineSchema.safeParse({ ...line, projectId: "prj-1", costCategory: "overheads" }).success).toBe(false);
  });
});

describe("createJournalDocumentSchema", () => {
  const document = {
    id: "jd-1",
    date: "2026-08-30",
    memo: "opening balances",
    lines: [
      { accountId: "acc-1", debit: "1000.000000", credit: "0" },
      { accountId: "acc-2", debit: "0", credit: "1000.000000" },
    ],
  };

  it("accepts a minimal valid document and preserves every field verbatim", () => {
    const result = createJournalDocumentSchema.safeParse(document);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(document);
  });

  it("rejects a document with fewer than two lines", () => {
    const result = createJournalDocumentSchema.safeParse({ ...document, lines: [document.lines[0]] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });

  it("rejects a document missing id", () => {
    const { id, ...rest } = document;
    const result = createJournalDocumentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("id");
  });
});

describe("journalDocumentEffectsRequestSchema", () => {
  it("accepts a single-line preview request — unlike create, one line is enough to preview", () => {
    const result = journalDocumentEffectsRequestSchema.safeParse({
      lines: [{ accountId: "acc-1", debit: "1000.000000", credit: "0" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty lines array", () => {
    const result = journalDocumentEffectsRequestSchema.safeParse({ lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });
});
