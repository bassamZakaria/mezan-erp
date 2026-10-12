import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCUMENT_REVERSAL_PATHS, ReversalDocumentType } from "@mezan/contracts";
import { REVERSAL_SCREENS } from "./reversal-screens";
import { reversalAr, reversalEn } from "./strings";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWN_HOOK = new Set<ReversalDocumentType>([ReversalDocumentType.LandedCost, ReversalDocumentType.DepreciationRun]);
const WITHOUT_SCREEN: Partial<Record<ReversalDocumentType, string>> = {
  [ReversalDocumentType.Adjustment]: "a direct stock post has no list in the web app; documents are reversed from the stock adjustments screen",
};

describe("every reversal route in the registry is reachable from its document's screen", () => {
  it.each(Object.values(ReversalDocumentType))("%s", (type) => {
    expect(DOCUMENT_REVERSAL_PATHS[type]).toBeDefined();
    const screen = REVERSAL_SCREENS[type];
    if (screen === null) {
      expect(WITHOUT_SCREEN[type], `${type} has no screen and no stated reason`).toBeTruthy();
      return;
    }
    const source = readFileSync(path.join(SRC, screen.file), "utf8");
    expect(source, `${screen.file} does not offer ${type}`).toContain(screen.marker);
    if (OWN_HOOK.has(type)) return;
    expect(source).toMatch(/useReverseDocumentAction\(|<ReverseDocumentAction\b/);
    for (const part of ["action", "title", "consequence"] as const) {
      const key = `reversal.${type}.${part}` as keyof typeof reversalAr;
      expect(reversalAr[key], key).toMatch(/[؀-ۿ]/);
      expect(reversalEn[key], key).not.toMatch(/[؀-ۿ]/);
    }
    expect(reversalAr[`reversal.${type}.consequence` as keyof typeof reversalAr]).toContain("{subject}");
  });

  it("names no screen for a type the registry does not hold", () => {
    expect(Object.keys(REVERSAL_SCREENS).sort()).toEqual(Object.keys(DOCUMENT_REVERSAL_PATHS).sort());
  });
});
