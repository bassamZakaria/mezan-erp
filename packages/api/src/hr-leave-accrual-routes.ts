import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  DuplicateAccrualPeriodError,
  LeaveAccrualBatchNotDraftError,
  LeaveAccrualBatchNotFoundError,
  Money,
  NoAccruableEmployeesError,
  createAccrualBatch,
  postAccrualBatch,
  type EmployeeDirectory,
  type JournalPostingDeps,
  type LeaveAccrualBatchRepository,
  type LeavePolicyRepository,
} from "@mezan/domain";
import { createAccrualBatchSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

export interface HrLeaveAccrualRoutesDeps {
  readonly batches: LeaveAccrualBatchRepository;
  readonly employees: EmployeeDirectory;
  readonly policies: LeavePolicyRepository;
  readonly gl: JournalPostingDeps;
  readonly defaultAccounts: {
    readonly leaveExpenseAccountId: string;
    readonly accruedLeaveLiabilityAccountId: string;
  };
  /** Per-employee daily leave-value rate for the GL posting; defaults to zero (no salary source wired yet — see create-accrual-batch.ts's doc comment). */
  readonly dailyRate?: (employeeId: string) => Promise<Money>;
  readonly idGen?: () => string;
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof LeaveAccrualBatchNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateAccrualPeriodError || err instanceof LeaveAccrualBatchNotDraftError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof NoAccruableEmployeesError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/** Leave Accrual Batches routes (docs/catalog/06 §"استحقاقات الإجازات"), mounted under `/hr/leave-accrual`. */
export function createHrLeaveAccrualRoutes(
  deps: HrLeaveAccrualRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;
  const dailyRate = deps.dailyRate ?? (async () => Money.zero());

  app.get("/", gate("hr.leave_policy.view"), async (c) => {
    return c.json(await deps.batches.list());
  });

  app.get("/:id", gate("hr.leave_policy.view"), async (c) => {
    const batch = await deps.batches.findById(c.req.param("id"));
    if (!batch) return c.json({ error: "LEAVE_ACCRUAL_BATCH_NOT_FOUND" }, 404);
    return c.json(batch);
  });

  /**
   * "تشغيل استحقاق الآن" — one call that both credits balances (creates the
   * draft batch) AND posts its journal entry, matching the catalog's single-
   * button UX ("يحرر قيد محاسبي وتحدث الأرصدة فوراً"). The domain still
   * models draft→posted as two steps internally (create-accrual-batch.ts /
   * post-accrual-batch.ts) for the same reasons `fixed-assets` keeps
   * depreciation runs two-step — testability and an explicit audit point.
   */
  app.post("/run-now", gate("hr.leave_accrual.run"), async (c) => {
    const parsed = createAccrualBatchSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const authCtx = getAuthContext(c);
    try {
      const draft = await createAccrualBatch(
        {
          id: idGen(),
          runDate: parsed.data.runDate,
          runType: parsed.data.runType ?? "MANUAL",
          executedBy: authCtx?.userId ?? null,
        },
        { batches: deps.batches, employees: deps.employees, policies: deps.policies, dailyRate },
      );
      const posted = await postAccrualBatch(draft.id, {
        batches: deps.batches,
        gl: deps.gl,
        accounts: {
          leaveExpenseAccountId: deps.defaultAccounts.leaveExpenseAccountId,
          accruedLeaveLiabilityAccountId: deps.defaultAccounts.accruedLeaveLiabilityAccountId,
        },
      });
      return c.json(posted, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
