import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATTACHMENT_ENTITY_OWNERS, AttachmentOwner, BRANCH_POLICY_TABLE, BranchPolicy, branchPolicyFor, undeclaredPolicyOf } from "@mezan/api";
import * as contracts from "@mezan/contracts";
import { ATTACHMENT_ENTITY_TYPES, createEntitlements, MODULE_CATALOG } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

const BOOT_TIMEOUT_MS = 240_000;

let handle: BackendHandle;
let mountedPaths: string[];
let familyGatePaths: string[];

beforeAll(async () => {
  const resolveEntitlements = () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });
  handle = await createBackend({
    dbPath: join(mkdtempSync(join(tmpdir(), "mezan-branch-policy-")), "books.db"),
    seedDemoData: false,
    lan: { resolveEntitlements },
    integrations: { tenantCode: "branch-policy" },
    resolveEntitlements,
  });
  const concrete = handle.app.routes.filter((route) => !route.path.endsWith("*"));
  mountedPaths = [...new Set(concrete.filter((route) => route.method !== "ALL").map((route) => route.path))].sort();
  familyGatePaths = [...new Set(concrete.filter((route) => route.method === "ALL").map((route) => route.path))].filter((path) => !mountedPaths.includes(path));
}, BOOT_TIMEOUT_MS);

afterAll(() => handle?.close());

describe("D111 · every mounted route declares what a branch-restricted session may do with it", () => {
  it("mounts the application's routes", () => {
    expect(mountedPaths.length).toBeGreaterThan(400);
  });

  it("no route family is without a branch policy, and no scoped route addresses a record it cannot resolve", () => {
    const undeclared = mountedPaths.flatMap((path) => {
      const reason = undeclaredPolicyOf(path);
      return reason ? [`${path} — ${reason}`] : [];
    });
    expect(undeclared).toEqual([]);
  });

  it("no handler is mounted on a wildcard path, where the enumeration above could not see what it serves", () => {
    const wildcardHandlers = handle.app.routes.filter((route) => route.method !== "ALL" && route.path.includes("*")).map((route) => `${route.method} ${route.path}`);
    expect(wildcardHandlers).toEqual([]);
  });

  it("an any-method registration is a family's gate, never a handler the enumeration would miss", () => {
    const orphaned = familyGatePaths.filter((gatePath) => !mountedPaths.some((path) => path.startsWith(`${gatePath}/`)));
    expect(orphaned).toEqual([]);
  });

  it("every declared prefix is still mounted, so the table cannot outlive the routes it opens", () => {
    const dead = BRANCH_POLICY_TABLE.filter((entry) => !mountedPaths.some((path) => branchPolicyFor(path) === entry)).map((entry) => entry.prefix);
    expect(dead).toEqual([]);
  });

  it("a route added under no declared family is refused to a branch-restricted session and open to an unrestricted one", () => {
    expect(undeclaredPolicyOf("/a-family-nobody-declared/:id")).toMatch(/no branch policy/);
    expect(undeclaredPolicyOf("/sales-invoices/:id/some-new-action")).toBeNull();
    expect(undeclaredPolicyOf("/sales-invoices/:otherId/x")).toMatch(/no stored-branch resolver/);
    expect(branchPolicyFor("/projects/:id")?.policy).toBe(BranchPolicy.CompanyWide);
  });
});

describe("D111 · every attachment entity type declares whose branch its files follow", () => {
  it("no entity type is undeclared, so one added later is closed to a branch-restricted session until it is", () => {
    const undeclared = ATTACHMENT_ENTITY_TYPES.filter((entityType) => !Object.values(AttachmentOwner).includes(ATTACHMENT_ENTITY_OWNERS[entityType]));
    expect(undeclared).toEqual([]);
  });

  it("only catalogue master data is shared; a person's and a document's files follow a branch", () => {
    const sharedTypes = ATTACHMENT_ENTITY_TYPES.filter((entityType) => ATTACHMENT_ENTITY_OWNERS[entityType] === AttachmentOwner.SharedMasterData);
    expect([...sharedTypes].sort()).toEqual(["customer", "item", "supplier"]);
  });
});

describe("D111 · a scoped family whose create lets the branch be left out says how the branch is filled in", () => {
  type Shaped = { shape?: Record<string, { isOptional(): boolean; isNullable(): boolean }>; _def?: { schema?: Shaped } };
  const shapeOf = (schema: Shaped): Shaped["shape"] => schema.shape ?? (schema._def?.schema ? shapeOf(schema._def.schema) : undefined);
  const branchMayBeLeftOut = (schema: unknown): boolean => {
    const branch = shapeOf(schema as Shaped)?.["branchId"];
    return branch !== undefined && (branch.isOptional() || branch.isNullable());
  };

  const CREATE_SCHEMA_FAMILY: Readonly<Record<string, string | null>> = {
    createAssetSchema: "/assets",
    createDepreciationRunSchema: "/assets/depreciation/runs",
    createOpportunitySchema: "/crm/opportunities",
    createPayrollRunSchema: "/hr/payroll/runs",
    createShiftTemplateSchema: "/shift-templates",
    openVanTripSchema: "/field/van-trips",
    createTreasuryAccountSchema: "/treasury-accounts",
    createCostCenterSchema: null,
    createCustomerSchema: null,
    // A bank charge takes its statement's branch; only on a company-level
    // statement may one be named, and none named leaves it «غير مخصص».
    createEntryFromLineSchema: null,
  };
  const createSchemas = Object.entries(contracts).filter(([name, schema]) => /^(create|open)\w+Schema$/.test(name) && branchMayBeLeftOut(schema));

  it("finds the create schemas that let the branch be left out", () => {
    expect(createSchemas.length).toBeGreaterThan(5);
  });

  it("every such schema is tied to its route family here, so a new one cannot pass unnoticed", () => {
    expect(createSchemas.map(([name]) => name).filter((name) => !(name in CREATE_SCHEMA_FAMILY))).toEqual([]);
  });

  it("every such scoped family defaults the branch, or holds a record no branch owns for the company", () => {
    const silent = createSchemas.flatMap(([name]) => {
      const prefix = CREATE_SCHEMA_FAMILY[name];
      if (!prefix) return [];
      const entry = BRANCH_POLICY_TABLE.find((candidate) => candidate.prefix === prefix);
      if (!entry) return [`${name}: ${prefix} is not a declared family`];
      if (entry.policy !== BranchPolicy.Scoped) return [];
      return entry.defaultsBranch || entry.unownedIsCompanys ? [] : [`${prefix} (${name})`];
    });
    expect(silent).toEqual([]);
  });
});
