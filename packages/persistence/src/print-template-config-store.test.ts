import { describe, it, expect } from "vitest";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, type PrintTemplateConfig } from "@mezan/domain";
import { createSqlitePrintTemplateConfigStore } from "./print-template-config-store.js";

describe("SqlitePrintTemplateConfigStore", () => {
  it("returns null before any config is saved", async () => {
    const store = createSqlitePrintTemplateConfigStore();
    try {
      expect(await store.get()).toBeNull();
    } finally {
      store.close();
    }
  });

  it("round-trips a full config object", async () => {
    const store = createSqlitePrintTemplateConfigStore();
    try {
      const config: PrintTemplateConfig = {
        ...DEFAULT_PRINT_TEMPLATE_CONFIG,
        identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, primaryColor: "#ff0000" },
      };
      await store.save(config);
      expect(await store.get()).toEqual(config);
    } finally {
      store.close();
    }
  });

  it("overwrites the single config row on repeated saves", async () => {
    const store = createSqlitePrintTemplateConfigStore();
    try {
      const first: PrintTemplateConfig = {
        ...DEFAULT_PRINT_TEMPLATE_CONFIG,
        identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, primaryColor: "#111111" },
      };
      await store.save(first);
      const second: PrintTemplateConfig = {
        ...first,
        pageSize: "A5",
        identity: { ...first.identity, primaryColor: "#222222" },
      };
      await store.save(second);
      const loaded = await store.get();
      expect(loaded?.pageSize).toBe("A5");
      expect(loaded?.identity.primaryColor).toBe("#222222");
    } finally {
      store.close();
    }
  });
});
