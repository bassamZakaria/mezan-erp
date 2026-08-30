import { describe, expect, it } from "vitest";
import { DEFAULT_ETA_CONFIG, computeEtaReadiness, type EtaConfig } from "./config.js";

const address = {
  governorate: "القاهرة",
  city: "مدينة نصر",
  street: "شارع مصطفى النحاس",
  buildingNumber: "12",
  postalCode: "11762",
};

function configWith(overrides: Partial<EtaConfig> = {}): EtaConfig {
  return { ...DEFAULT_ETA_CONFIG, ...overrides };
}

const complete = configWith({
  taxRegistrationNumber: "123456789",
  activityCode: "4711",
  address,
  clientId: "client-1",
  hasClientSecret: true,
});

describe("the default configuration", () => {
  it("starts on pre-production with nothing registered and no secret on file", () => {
    expect(DEFAULT_ETA_CONFIG.environment).toBe("preproduction");
    expect(DEFAULT_ETA_CONFIG.taxRegistrationNumber).toBeNull();
    expect(DEFAULT_ETA_CONFIG.activityCode).toBeNull();
    expect(DEFAULT_ETA_CONFIG.address).toBeNull();
    expect(DEFAULT_ETA_CONFIG.clientId).toBeNull();
    expect(DEFAULT_ETA_CONFIG.hasClientSecret).toBe(false);
  });

  it("carries the legal buyer-data threshold and the signed document version", () => {
    expect(DEFAULT_ETA_CONFIG.buyerDataThreshold).toBe(25000);
    expect(DEFAULT_ETA_CONFIG.documentVersion).toBe("1.0");
  });

  it("never exposes a secret, only whether one is on file", () => {
    expect(Object.keys(DEFAULT_ETA_CONFIG)).not.toContain("clientSecret");
  });
});

describe("computeEtaReadiness — configuration only", () => {
  it("reports 0% for an untouched tenant, with every item incomplete", () => {
    const readiness = computeEtaReadiness(DEFAULT_ETA_CONFIG);
    expect(readiness.percent).toBe(0);
    expect(readiness.items).toHaveLength(5);
    expect(readiness.items.every((i) => !i.complete && i.missing === 1)).toBe(true);
  });

  it("reports 100% once every configuration field is filled in", () => {
    const readiness = computeEtaReadiness(complete);
    expect(readiness.percent).toBe(100);
    expect(readiness.items.every((i) => i.complete && i.missing === 0)).toBe(true);
  });

  it("counts each field as it lands, and rounds the percentage", () => {
    expect(computeEtaReadiness(configWith({ taxRegistrationNumber: "123" })).percent).toBe(20);
    expect(computeEtaReadiness(configWith({ taxRegistrationNumber: "123", activityCode: "4711" })).percent).toBe(40);
    expect(
      computeEtaReadiness(configWith({ taxRegistrationNumber: "123", activityCode: "4711", address })).percent,
    ).toBe(60);
  });

  it("treats an empty registration number as missing, not as filled in", () => {
    const readiness = computeEtaReadiness(configWith({ taxRegistrationNumber: "" }));
    expect(readiness.items.find((i) => i.key === "taxRegistrationNumber")?.complete).toBe(false);
  });

  it("names every item in Arabic, which is what the readiness panel renders", () => {
    for (const item of computeEtaReadiness(DEFAULT_ETA_CONFIG).items) {
      expect(item.labelAr.trim().length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(item.labelAr)).toBe(true);
    }
  });
});

describe("computeEtaReadiness — with the master-data counts", () => {
  const clean = { branchesMissingCode: 0, itemsMissingCode: 0, unitsMissingMapping: 0, taxRatesMissingSubType: 0 };

  it("adds the four master-data prerequisites to the checklist", () => {
    const readiness = computeEtaReadiness(complete, clean);
    expect(readiness.items).toHaveLength(9);
    expect(readiness.items.map((i) => i.key)).toEqual([
      "taxRegistrationNumber",
      "activityCode",
      "address",
      "branchCodes",
      "itemCodes",
      "unitMappings",
      "taxSubTypes",
      "clientId",
      "clientSecret",
    ]);
    expect(readiness.percent).toBe(100);
  });

  it("reports how many records still lack a code, not merely that some do", () => {
    const readiness = computeEtaReadiness(complete, { ...clean, itemsMissingCode: 47 });
    const items = readiness.items.find((i) => i.key === "itemCodes");
    expect(items).toMatchObject({ complete: false, missing: 47 });
    expect(readiness.percent).toBe(89);
  });

  it("a single unregistered branch is enough to hold the tenant back", () => {
    const readiness = computeEtaReadiness(complete, { ...clean, branchesMissingCode: 1 });
    expect(readiness.percent).toBeLessThan(100);
    expect(readiness.items.find((i) => i.key === "branchCodes")?.complete).toBe(false);
  });

  it("reports 0% when nothing at all is registered", () => {
    const readiness = computeEtaReadiness(DEFAULT_ETA_CONFIG, {
      branchesMissingCode: 3,
      itemsMissingCode: 120,
      unitsMissingMapping: 8,
      taxRatesMissingSubType: 4,
    });
    expect(readiness.percent).toBe(0);
    expect(readiness.items.every((i) => !i.complete)).toBe(true);
  });

  it("never reports a percentage outside 0–100, whatever the counts", () => {
    for (const missing of [0, 1, 5, 1000]) {
      const readiness = computeEtaReadiness(complete, {
        branchesMissingCode: missing,
        itemsMissingCode: missing,
        unitsMissingMapping: missing,
        taxRatesMissingSubType: missing,
      });
      expect(readiness.percent).toBeGreaterThanOrEqual(0);
      expect(readiness.percent).toBeLessThanOrEqual(100);
    }
  });
});
