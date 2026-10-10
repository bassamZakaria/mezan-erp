import { describe, expect, it } from "vitest";
import {
  DOMAIN_EVENT_CATALOG,
  GATEABLE_ACTION_TYPES,
  MODULES,
  SALES_INVOICE_STATUS_LABELS_AR,
  SEQUENCE_DEFINITIONS,
  WAREHOUSE_TYPE_DEFINITIONS,
} from "@mezan/domain";
import { webCatalogs } from "./i18n/catalog";

const ar = webCatalogs.ar as Record<string, string>;
const en = webCatalogs.en as Record<string, string>;

function unlabelled(prefix: string, codes: readonly string[]): string[] {
  return codes.flatMap((code) => {
    const key = `${prefix}.${code}`;
    return [ar[key] ? null : `ar ${key}`, en[key] ? null : `en ${key}`].filter((m): m is string => m !== null);
  });
}

describe("domain-labels catalogue", () => {
  it("names every numbering sequence the domain defines, in Arabic and English", () => {
    expect(unlabelled("sequence", SEQUENCE_DEFINITIONS.map((d) => d.code))).toEqual([]);
  });

  it("names every event in the domain event catalog, in Arabic and English", () => {
    expect(unlabelled("event", DOMAIN_EVENT_CATALOG.map((e) => e.code))).toEqual([]);
  });

  it("names every licensable module, in Arabic and English", () => {
    expect(unlabelled("module", MODULES.map((m) => m.id))).toEqual([]);
  });

  it("names every warehouse type, in Arabic and English", () => {
    expect(unlabelled("warehouseType", WAREHOUSE_TYPE_DEFINITIONS.map((d) => d.code))).toEqual([]);
  });

  it("names every gateable action type, in Arabic and English", () => {
    expect(unlabelled("actionType", GATEABLE_ACTION_TYPES.map((a) => a.code))).toEqual([]);
  });

  it("names every sales-invoice status, in Arabic and English", () => {
    expect(unlabelled("salesInvoiceStatus", Object.keys(SALES_INVOICE_STATUS_LABELS_AR))).toEqual([]);
  });
});
