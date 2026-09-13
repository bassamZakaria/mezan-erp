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
  type Project,
  type ProjectRepository,
  type CostCenterRepository,
  type LedgerRepository,
  type AccountRepository,
} from "@mezan/domain";
import { createProjectSchema, updateProjectSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

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

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof ProjectNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateProjectCodeError || err instanceof DuplicateCostCenterCodeError) {
    return c.json({ error: err.code, message: err.message }, 409);
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
  readonly projects: ProjectRepository;
  readonly costCenters: CostCenterRepository;
  /** The posted ledger and its accounts, for the project P&L. Omitted, the report answers with no rows. */
  readonly ledger?: Pick<LedgerRepository, "listLines">;
  readonly accounts?: Pick<AccountRepository, "list">;
}

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
    const [lines, accounts, projects] = await Promise.all([
      deps.ledger?.listLines?.({ fromDate, toDate }) ?? [],
      deps.accounts?.list() ?? [],
      deps.projects.list(),
    ]);
    const report = computeProjectPnL(lines, accounts, projects);
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
