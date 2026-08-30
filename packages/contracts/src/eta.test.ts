import { describe, it, expect } from "vitest";
import {
  etaEnvironmentSchema,
  etaDocumentVersionSchema,
  etaSigningMethodSchema,
  etaDocumentTypeSchema,
  etaSubmissionStatusSchema,
  etaCompanyAddressSchema,
  etaConfigSchema,
  updateEtaConfigSchema,
  etaReadinessSchema,
  etaSubmissionSchema,
  excludeEtaSubmissionSchema,
  etaActivityCodeSchema,
  etaTestConnectionResultSchema,
  etaBranchCodeRowSchema,
  updateEtaBranchCodeSchema,
  etaItemMappingRowSchema,
  updateEtaItemMappingSchema,
  etaUnitCodeSchema,
  etaUnitMappingRowSchema,
  updateEtaUnitMappingSchema,
  applyEtaUnitSuggestionsResultSchema,
  etaTaxSubTypeRowSchema,
} from "./eta.js";

describe("etaEnvironmentSchema", () => {
  it("accepts preproduction and production", () => {
    expect(etaEnvironmentSchema.safeParse("preproduction").success).toBe(true);
    expect(etaEnvironmentSchema.safeParse("production").success).toBe(true);
  });

  it("rejects an environment outside the enum", () => {
    expect(etaEnvironmentSchema.safeParse("sandbox").success).toBe(false);
  });
});

describe("etaSubmissionStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["ready", "pending_signature", "submitted", "accepted", "error", "excluded"]) {
      expect(etaSubmissionStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(etaSubmissionStatusSchema.safeParse("rejected").success).toBe(false);
  });
});

describe("etaCompanyAddressSchema", () => {
  const address = { governorate: "القاهرة", city: "مدينة نصر", street: "شارع عباس العقاد", buildingNumber: "10", postalCode: null };

  it("accepts a minimal valid address and preserves every field verbatim", () => {
    const result = etaCompanyAddressSchema.safeParse(address);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(address);
  });

  it("rejects an address missing buildingNumber", () => {
    const { buildingNumber, ...rest } = address;
    const result = etaCompanyAddressSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("buildingNumber");
  });
});

describe("etaConfigSchema", () => {
  const config = {
    environment: "preproduction" as const,
    taxRegistrationNumber: "123456789",
    activityCode: "4610",
    address: null,
    buyerDataThreshold: 25000,
    documentVersion: "1.0" as const,
    autoSubmitOnConfirm: false,
    signingMethod: "none" as const,
    clientId: null,
    hasClientSecret: false,
  };

  it("accepts a minimal valid config and preserves every field verbatim", () => {
    const result = etaConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(config);
  });

  it("never carries the plaintext client secret — only hasClientSecret", () => {
    expect(config).not.toHaveProperty("clientSecret");
  });

  it("silently strips a caller-supplied clientSecret if smuggled into the read shape", () => {
    const result = etaConfigSchema.safeParse({ ...config, clientSecret: "shh" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("clientSecret");
  });

  it("rejects an out-of-enum documentVersion", () => {
    const result = etaConfigSchema.safeParse({ ...config, documentVersion: "2.0" });
    expect(result.success).toBe(false);
  });
});

describe("updateEtaConfigSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateEtaConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a plaintext clientSecret on write — unlike the read shape", () => {
    const result = updateEtaConfigSchema.safeParse({ clientSecret: "new-secret" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clientSecret).toBe("new-secret");
  });

  it("rejects an out-of-enum signingMethod when supplied", () => {
    const result = updateEtaConfigSchema.safeParse({ signingMethod: "hsm" });
    expect(result.success).toBe(false);
  });
});

describe("etaReadinessSchema", () => {
  const readiness = { percent: 80, items: [{ key: "tax-number", labelAr: "الرقم الضريبي", complete: true, missing: 0 }] };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = etaReadinessSchema.safeParse(readiness);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(readiness);
  });

  it("rejects a readiness item missing complete", () => {
    const result = etaReadinessSchema.safeParse({ percent: 80, items: [{ key: "tax-number", labelAr: "x", missing: 0 }] });
    expect(result.success).toBe(false);
  });
});

describe("etaSubmissionSchema", () => {
  const submission = {
    id: "sub-1",
    internalId: "SI-2026-001",
    documentType: "invoice" as const,
    status: "submitted" as const,
    etaUuid: "uuid-1",
    errors: [],
    exclusionReason: null,
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:05:00.000Z",
    submittedAt: "2026-08-30T10:05:00.000Z",
  };

  it("accepts a minimal valid submission and preserves every field verbatim", () => {
    const result = etaSubmissionSchema.safeParse(submission);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(submission);
  });

  it("rejects an out-of-enum documentType", () => {
    const result = etaSubmissionSchema.safeParse({ ...submission, documentType: "receipt" });
    expect(result.success).toBe(false);
  });
});

describe("excludeEtaSubmissionSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = excludeEtaSubmissionSchema.safeParse({ reason: "cash sale under threshold" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty reason", () => {
    const result = excludeEtaSubmissionSchema.safeParse({ reason: "" });
    expect(result.success).toBe(false);
  });
});

describe("etaTestConnectionResultSchema", () => {
  const result = { ok: false, reason: "offline" as const, checkedAt: "2026-08-30T10:00:00.000Z" };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const parsed = etaTestConnectionResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("accepts a null reason on success", () => {
    const parsed = etaTestConnectionResultSchema.safeParse({ ...result, ok: true, reason: null });
    expect(parsed.success).toBe(true);
  });

  it("rejects an out-of-enum reason", () => {
    const parsed = etaTestConnectionResultSchema.safeParse({ ...result, reason: "timeout" });
    expect(parsed.success).toBe(false);
  });
});

describe("etaActivityCodeSchema", () => {
  it("accepts a minimal valid code and preserves every field verbatim", () => {
    const code = { code: "4610", labelAr: "تجارة الجملة", labelEn: "Wholesale trade" };
    const result = etaActivityCodeSchema.safeParse(code);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(code);
  });

  it("rejects a code missing labelEn", () => {
    const result = etaActivityCodeSchema.safeParse({ code: "4610", labelAr: "تجارة الجملة" });
    expect(result.success).toBe(false);
  });
});

describe("etaUnitCodeSchema", () => {
  it("accepts a minimal valid unit code and preserves every field verbatim", () => {
    const unit = { code: "EA", labelAr: "قطعة", labelEn: "Each" };
    const result = etaUnitCodeSchema.safeParse(unit);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(unit);
  });
});

describe("etaBranchCodeRowSchema", () => {
  it("accepts a minimal valid row and preserves it verbatim", () => {
    const row = { branchId: "branch-1", branchCode: "CAI-01", branchName: "الفرع الرئيسي", etaBranchCode: null };
    const result = etaBranchCodeRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });
});

describe("updateEtaBranchCodeSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = updateEtaBranchCodeSchema.safeParse({ etaBranchCode: "0" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty etaBranchCode", () => {
    const result = updateEtaBranchCodeSchema.safeParse({ etaBranchCode: "" });
    expect(result.success).toBe(false);
  });
});

describe("etaItemMappingRowSchema", () => {
  const row = { itemId: "item-1", code: "ITM-1", nameAr: "منتج", nameEn: null, etaCodeType: "GPC" as const, etaItemCode: "10000000", gpcCode: "10000000" };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = etaItemMappingRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("rejects an out-of-enum etaCodeType", () => {
    const result = etaItemMappingRowSchema.safeParse({ ...row, etaCodeType: "SKU" });
    expect(result.success).toBe(false);
  });
});

describe("updateEtaItemMappingSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateEtaItemMappingSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum etaCodeType when supplied", () => {
    const result = updateEtaItemMappingSchema.safeParse({ etaCodeType: "SKU" });
    expect(result.success).toBe(false);
  });
});

describe("etaUnitMappingRowSchema", () => {
  const row = { unitCode: "PCS", nameAr: "قطعة", nameEn: null, etaUnitCode: "EA", suggestion: null };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = etaUnitMappingRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });
});

describe("updateEtaUnitMappingSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = updateEtaUnitMappingSchema.safeParse({ etaUnitCode: "EA" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty etaUnitCode", () => {
    const result = updateEtaUnitMappingSchema.safeParse({ etaUnitCode: "" });
    expect(result.success).toBe(false);
  });
});

describe("applyEtaUnitSuggestionsResultSchema", () => {
  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const payload = {
      applied: [{ unitCode: "PCS", nameAr: "قطعة", nameEn: null, etaUnitCode: "EA", suggestion: null }],
      unresolved: ["BOX"],
    };
    const result = applyEtaUnitSuggestionsResultSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });
});

describe("etaTaxSubTypeRowSchema", () => {
  const row = { taxRateId: "tax-1", code: "VAT14", name: "ضريبة القيمة المضافة", rate: 14, etaSubType: "V001", resolved: true };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = etaTaxSubTypeRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("rejects a row missing resolved", () => {
    const { resolved, ...rest } = row;
    const result = etaTaxSubTypeRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("resolved");
  });
});
