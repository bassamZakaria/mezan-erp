import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalOrTest } from "./shared.js";

describe("assertLocalOrTest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a production process that did not opt in with MEZAN_SEED_DEMO=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEZAN_SEED_DEMO", undefined);
    expect(() => assertLocalOrTest()).toThrow(/refusing to seed: NODE_ENV=production/);
  });

  it("lets the hosted demo seed in production when MEZAN_SEED_DEMO=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEZAN_SEED_DEMO", "1");
    expect(() => assertLocalOrTest()).not.toThrow();
  });

  it("lets a configured reviewer tenant seed in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEZAN_SEED_DEMO", undefined);
    vi.stubEnv("MEZAN_REVIEW_TENANT_CODE", "cyag");
    vi.stubEnv("MEZAN_REVIEW_PASSWORD", "pw-482913");
    expect(() => assertLocalOrTest()).not.toThrow();
  });

  it("still refuses production when only half of the reviewer config is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEZAN_SEED_DEMO", undefined);
    vi.stubEnv("MEZAN_REVIEW_TENANT_CODE", "cyag");
    vi.stubEnv("MEZAN_REVIEW_PASSWORD", undefined);
    expect(() => assertLocalOrTest()).toThrow(/refusing to seed: NODE_ENV=production/);
  });

  it("refuses a non-test, non-production process that did not opt in", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("VITEST", "false");
    vi.stubEnv("MEZAN_SEED_DEMO", undefined);
    expect(() => assertLocalOrTest()).toThrow(/MEZAN_SEED_DEMO unset/);
  });
});
