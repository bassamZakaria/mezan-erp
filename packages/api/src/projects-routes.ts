import { Hono, type Context } from "hono";
import {
  createProject,
  updateProject,
  Money,
  DuplicateProjectCodeError,
  ProjectNotFoundError,
  InvalidProjectError,
  InvalidProjectTransitionError,
  DuplicateCostCenterCodeError,
  computeProjectPnL,
  contractValueAsOf,
  deriveProjectStatusFlags,
  routedAccountId,
  type AccountRoutingRepository,
  type ProjectContractingAccountIds,
  type ProjectFlagContract,
  type ProjectStatusFlag,
  type Project,
  type ProjectRepository,
  type CostCenterRepository,
  type LedgerRepository,
  type AccountRepository,
  type RevenueRecognitionRunRepository,
  type WorksContractStore,
} from "@mezan/domain";
import { createProjectSchema, updateProjectSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { branchLineViewOf, lineInView } from "./branch-view.js";
import { tenantToday } from "./tenant-day.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";

function serialize(project: Project) {
  return {
    id: project.id,
    code: project.code,
    nameAr: project.nameAr,
    nameEn: project.nameEn,
    status: project.status,
    customerId: project.customerId,
    managerId: project.managerId,
    startDate: project.startDate,
    endDate: project.endDate,
    budget: project.budget.toString(),
    siteAddress: project.siteAddress,
    notes: project.notes,
    costCenterId: project.costCenterId,
  };
}

function withMessageEn(err: { readonly code: string; readonly message: string }) {
  const messageEn = (err as { readonly messageEn?: string }).messageEn;
  return { error: err.code, message: err.message, ...(messageEn ? { messageEn } : {}) };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof ProjectNotFoundError) {
    return c.json(withMessageEn(err), 404);
  }
  if (err instanceof DuplicateProjectCodeError || err instanceof DuplicateCostCenterCodeError) {
    return c.json(withMessageEn(err), 409);
  }
  if (err instanceof InvalidProjectError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof InvalidProjectTransitionError) {
    return c.json({ error: err.code, message: err.message, from: err.from, to: err.to }, 409);
  }
  throw err;
}

export interface ProjectsRoutesDeps {
  /** Refuses a project naming a customer no master record holds (D310). */
  readonly masterData?: MasterDataChecks;
  readonly projects: ProjectRepository;
  readonly costCenters: CostCenterRepository;
  /** The posted ledger and its accounts, for the project P&L. Omitted, the report answers with no rows. */
  readonly ledger?: Pick<LedgerRepository, "listLines">;
  readonly accounts?: Pick<AccountRepository, "list">;
  /** Where the contracting balance-sheet figures land. Omitted, the shipped defaults are used. */
  readonly routing?: Pick<AccountRoutingRepository, "get">;
  /** The works contracts behind the derived status flags. Omitted, no project is flagged. */
  readonly worksContracts?: Pick<WorksContractStore, "listContracts" | "listBoqLines" | "listVariationOrders">;
  /** The recognition runs, for the billings they have already reclassified out of 2165. */
  readonly recognitionRuns?: Pick<RevenueRecognitionRunRepository, "list">;
  /** ISO `YYYY-MM-DD` "today", for the late-penalty flag. Overridable for deterministic tests. */
  readonly today?: () => string;
}

const CONTRACTING_ACCOUNT_SLOTS: Readonly<Record<keyof ProjectContractingAccountIds, [string, string]>> = {
  wip: ["contracting.wip", "1230"],
  contractAsset: ["contracting.contract_asset", "1170"],
  contractLiability: ["contracting.contract_liability", "2175"],
  billings: ["contracting.billings", "2165"],
  revenue: ["contracting.revenue", "4150"],
  customerAdvances: ["contracting.customer_advances", "2160"],
  retentionReceivable: ["contracting.retention_receivable", "1150"],
};

/**
 * Project routes (docs/archive/catalog/07 "المشاريع والمقاولات"): list, get one,
 * create (auto-creates a linked `PRJ-{code}` cost center), edit.
 *
 * PERMISSION NOTE: the permission catalog (packages/domain/src/permissions/
 * catalog.ts) has no "projects" module at all yet — unlike cost centers,
 * there is no existing sibling entry to reuse here, so this router mints two
 * new route-level-only permission codes, `projects.project.view` and
 * `projects.project.manage`. `can()` only string-matches against the
 * caller's granted permission set — it does not require catalog
 * registration to function — so this works fine until the catalog is
 * formally extended with a "projects" module.
 */
export function createProjectsRoutes(
  deps: ProjectsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("projects.project.view"), async (c) => {
    const projects = await deps.projects.list();
    return c.json(projects.map(serialize));
  });

  app.get("/pnl", gate("projects.project.view"), async (c) => {
    const fromDate = c.req.query("fromDate");
    const toDate = c.req.query("toDate");
    const view = branchLineViewOf(c);
    const [allLines, accounts, projects, routing, contracts, runs] = await Promise.all([
      deps.ledger?.listLines?.({ fromDate, toDate }) ?? [],
      deps.accounts?.list() ?? [],
      deps.projects.list(),
      deps.routing?.get() ?? null,
      deps.worksContracts?.listContracts() ?? [],
      deps.recognitionRuns?.list() ?? [],
    ]);

    const contractingAccounts = Object.fromEntries(
      (Object.entries(CONTRACTING_ACCOUNT_SLOTS) as [keyof ProjectContractingAccountIds, [string, string]][]).map(
        ([field, [key, fallback]]) => [field, routedAccountId(routing, key) ?? fallback],
      ),
    ) as unknown as ProjectContractingAccountIds;

    // A balance-sheet figure is cumulative: the WIP and contract-position lines
    // are fetched to the report's end date only, never clipped to its start.
    const lines = allLines.filter((line) => lineInView(view, line.branchId));
    const contractingLines = (
      (await deps.ledger?.listLines?.({ toDate, accountIds: Object.values(contractingAccounts) })) ?? []
    ).filter((line) => lineInView(view, line.branchId));

    // Bounded by the report's own end date: a run for a month AFTER `toDate`
    // reclassified billings that had not happened yet as far as this report is
    // concerned, and adding it made billedToDate run ahead of the certificates.
    const billedReclassedByProject = new Map<string, Money>();
    for (const run of runs) {
      if (run.status !== "posted") continue;
      if (toDate && run.periodEnd > toDate) continue;
      const current = billedReclassedByProject.get(run.projectId) ?? Money.zero();
      billedReclassedByProject.set(run.projectId, current.add(run.billedInPeriod));
    }

    // استرداد تكلفة تشغيل المعدات is the contra of a cost already in WIP; it
    // carries the projectId so the recovery is traceable, and counting it as
    // cost nets the same plant hours out twice.
    const costExcludedAccountIds = new Set<string>([routedAccountId(routing, "contracting.plant_recovery") ?? "5160"]);

    const flagInputs: ProjectFlagContract[] = [];
    for (const contract of contracts) {
      const [boqLines, orders] = await Promise.all([
        deps.worksContracts!.listBoqLines(contract.id),
        deps.worksContracts!.listVariationOrders({ contractId: contract.id }),
      ]);
      flagInputs.push({
        projectId: contract.projectId,
        status: contract.status,
        plannedEndDate: contract.plannedEndDate,
        estimatedTotalCost: contract.estimatedTotalCost,
        contractValue: contractValueAsOf(boqLines, orders, "9999-12-31"),
      });
    }
    const today = await tenantToday(c, deps.today);
    const flagsByProject: ReadonlyMap<string, readonly ProjectStatusFlag[]> = deriveProjectStatusFlags(flagInputs, today);

    const report = computeProjectPnL(lines, accounts, projects, {
      lines: contractingLines,
      accounts: contractingAccounts,
      billedReclassedByProject,
      flagsByProject,
      costExcludedAccountIds,
    });
    return c.json({
      rows: report.rows.map((r) => ({
        projectId: r.projectId,
        code: r.code,
        name: r.name,
        budget: r.budget.toString(),
        revenue: r.revenue.toString(),
        cost: r.cost.toString(),
        costByCategory: Object.fromEntries(
          Object.entries(r.costByCategory).map(([k, v]) => [k, v.toString()]),
        ),
        margin: r.margin.toString(),
        budgetRemaining: r.budgetRemaining.toString(),
        wipBalance: r.wipBalance.toString(),
        contractAsset: r.contractAsset.toString(),
        contractLiability: r.contractLiability.toString(),
        billedToDate: r.billedToDate.toString(),
        revenueRecognised: r.revenueRecognised.toString(),
        advanceOutstanding: r.advanceOutstanding.toString(),
        retentionHeld: r.retentionHeld.toString(),
        flags: r.flags,
      })),
      totals: {
        revenue: report.totals.revenue.toString(),
        cost: report.totals.cost.toString(),
        margin: report.totals.margin.toString(),
      },
    });
  });

  app.get("/:id", gate("projects.project.view"), async (c) => {
    const project = await deps.projects.findById(c.req.param("id"));
    if (!project) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(project));
  });

  app.post("/", gate("projects.project.manage"), async (c) => {
    const parsed = createProjectSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const customerRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Customer, ids: [parsed.data.customerId] },
    ]);
    if (customerRefusal) return customerRefusal;
    try {
      const { budget, ...rest } = parsed.data;
      const project = await createProject(
        {
          ...rest,
          costCenterId: parsed.data.costCenterId ?? `cc-prj-${parsed.data.id}`,
          budget: budget !== undefined ? Money.fromMajor(budget) : undefined,
        },
        { projects: deps.projects, costCenters: deps.costCenters },
      );
      return c.json(serialize(project), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("projects.project.manage"), async (c) => {
    const parsed = updateProjectSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const current = await deps.projects.findById(c.req.param("id"));
    if (!current) return c.json({ error: "NOT_FOUND" }, 404);
    try {
      const { budget, ...rest } = parsed.data;
      const patch = { ...rest, ...(budget !== undefined ? { budget: Money.fromMajor(budget) } : {}) };
      const project = updateProject(current, patch);
      await deps.projects.update(project);
      return c.json(serialize(project));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
