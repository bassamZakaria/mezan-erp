import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contracts from "./index.js";
import { CLIENT_SUPPLIED_ID_DESCRIPTION } from "./client-supplied-id.js";

const REQUEST_SCHEMA_NAME = /^(create|post|reverse|generate|repay|import|issue|open|record|start|add|build|convert|replace|save|upsert|put|patch|update|confirm|submit|selfCreate)[A-Z]\w*Schema$/;
const NEW_RECORD_KEYS = new Set(["id", "allocationId", "adjustmentId", "transferId", "reversalId", "repaymentId", "requestId"]);

const NOT_A_NEW_RECORD: Readonly<Record<string, string>> = {
  "updateBarcodeConfigSchema.embeddedRules[].id": "a rule inside one settings document, never a record or an entry of its own",
  "upsertConfigurableProductSchema.inputs[].id": "an input inside one product definition, never a record or an entry of its own",
  "updatePosSettingsSchema.mealSections[].id": "a section inside one settings document, never a record or an entry of its own",
  "recordRecentSchema.id": "names an existing record of any kind, system-minted journal entries included",
  "patchUserPreferencesSchema.recentRecords[].id": "names an existing record of any kind",
  "putUserPreferencesSchema.recentRecords[].id": "names an existing record of any kind",
  "patchUserPreferencesSchema.pinnedScreens[].id": "a screen key from the navigation catalog",
  "putUserPreferencesSchema.pinnedScreens[].id": "a screen key from the navigation catalog",
  "patchUserPreferencesSchema.dashboard.widgets[].id": "a widget key from the dashboard catalog",
  "putUserPreferencesSchema.dashboard.widgets[].id": "a widget key from the dashboard catalog",
  "patchUserPreferencesSchema.shortcutTiles[].id": "a tile key from the navigation catalog",
  "putUserPreferencesSchema.shortcutTiles[].id": "a tile key from the navigation catalog",
};

type Def = { typeName?: string; innerType?: z.ZodTypeAny; type?: z.ZodTypeAny; schema?: z.ZodTypeAny; options?: readonly z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny>; left?: z.ZodTypeAny; right?: z.ZodTypeAny; valueType?: z.ZodTypeAny; in?: z.ZodTypeAny; description?: string };
const defOf = (schema: z.ZodTypeAny): Def => schema._def as Def;

function isClientSuppliedId(schema: z.ZodTypeAny): boolean {
  let current: z.ZodTypeAny | undefined = schema;
  while (current) {
    const def = defOf(current);
    if (def.description === CLIENT_SUPPLIED_ID_DESCRIPTION) return schema.safeParse("owner:role").success === false;
    current = def.innerType ?? def.schema;
  }
  return false;
}

function newRecordFields(schema: z.ZodTypeAny, path: string, found: { path: string; schema: z.ZodTypeAny }[], seen: Set<z.ZodTypeAny>): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const def = defOf(schema);
  if (schema instanceof z.ZodObject) {
    for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      if (NEW_RECORD_KEYS.has(key)) found.push({ path: `${path}.${key}`, schema: field });
      else newRecordFields(field, `${path}.${key}`, found, new Set(seen));
    }
    return;
  }
  if (schema instanceof z.ZodArray) return newRecordFields(def.type as z.ZodTypeAny, `${path}[]`, found, seen);
  if (def.options) {
    for (const option of def.options instanceof Map ? def.options.values() : def.options) newRecordFields(option, path, found, seen);
    return;
  }
  for (const inner of [def.innerType, def.schema, def.left, def.right, def.valueType, def.in]) if (inner) newRecordFields(inner, path, found, seen);
}

const RESPONSE_SCHEMA_NAME = /(Result|Report|Row)Schema$|^openInvoiceSchema$/;
const requestSchemas = Object.entries(contracts as unknown as Record<string, unknown>).filter((entry): entry is [string, z.ZodTypeAny] => REQUEST_SCHEMA_NAME.test(entry[0]) && !RESPONSE_SCHEMA_NAME.test(entry[0]) && entry[1] instanceof z.ZodType);

describe("every id a request names a new record with passes the one client-supplied-id schema", () => {
  it("the walk sees the request schemas and their id fields", () => {
    expect(requestSchemas.length).toBeGreaterThan(150);
    const found: { path: string; schema: z.ZodTypeAny }[] = [];
    for (const [name, schema] of requestSchemas) newRecordFields(schema, name, found, new Set());
    expect(found.length).toBeGreaterThan(100);
  });

  it("no create, post or reverse schema carries a bare id", () => {
    const bare: string[] = [];
    for (const [name, schema] of requestSchemas) {
      const found: { path: string; schema: z.ZodTypeAny }[] = [];
      newRecordFields(schema, name, found, new Set());
      for (const field of found) if (!(field.path in NOT_A_NEW_RECORD) && !isClientSuppliedId(field.schema)) bare.push(field.path);
    }
    expect(bare).toEqual([]);
  });

  it.each([
    ["createAllocationSchema", "allocationId"],
    ["createChequeAllocationSchema", "allocationId"],
    ["postAdjustmentSchema", "adjustmentId"],
    ["postTransferSchema", "transferId"],
    ["reverseVoucherSchema", "reversalId"],
    ["reverseGlJournalEntrySchema", "reversalId"],
    ["createVoucherSchema", "id"],
    ["createGlJournalEntrySchema", "id"],
  ])("%s.%s refuses an id in the system's namespace", (name, key) => {
    const schema = (contracts as unknown as Record<string, z.ZodTypeAny>)[name];
    const field = (schema as z.ZodObject<z.ZodRawShape>).shape[key] as z.ZodTypeAny;
    expect(field.safeParse("release:inv:1").success).toBe(false);
    expect(field.safeParse("inv:void").success).toBe(false);
    expect(field.safeParse("ADJ1:REVERSAL").success).toBe(false);
    expect(field.safeParse("adj-1").success).toBe(true);
  });

  it("every exemption still names a field that exists", () => {
    const all = new Set<string>();
    for (const [name, schema] of requestSchemas) {
      const found: { path: string; schema: z.ZodTypeAny }[] = [];
      newRecordFields(schema, name, found, new Set());
      for (const field of found) all.add(field.path);
    }
    expect(Object.keys(NOT_A_NEW_RECORD).filter((path) => !all.has(path))).toEqual([]);
  });
});
