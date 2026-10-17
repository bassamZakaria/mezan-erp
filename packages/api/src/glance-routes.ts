import { Hono } from "hono";
import {
  Money,
  UNATTRIBUTED_BRANCH_ID,
  can,
  cockpitLineInView,
  routedAccountId,
  withinBranchScope,
  type AccountRoutingRepository,
  type ApprovalRequestRepository,
  type Branch,
  type LedgerRepository,
  type UserRepository,
} from "@mezan/domain";
import {
  OwnerDigestCadence,
  OwnerDigestExceptionKind,
  OwnerDigestLanguage,
  glanceQuerySchema,
  type GlanceApprovalsDTO,
  type GlanceBalanceDTO,
  type GlanceBranchDTO,
  type GlanceDTO,
} from "@mezan/contracts";
import { branchGrantOf, createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import type { OwnerDigestService } from "./owner-digest-service.js";
import { tenantToday } from "./tenant-day.js";

export const GLANCE_PERMISSION = "dashboard.glance.view";

enum GlanceRefusal {
  InvalidQuery = "INVALID_QUERY",
  Unauthenticated = "UNAUTHENTICATED",
  BranchOutOfScope = "BRANCH_OUT_OF_SCOPE",
}

enum ControlSlot {
  Receivable = "control.receivable",
  Payable = "control.payable",
}

const ALL_PENDING_ROLES = ["*"] as const;

export interface GlanceRoutesDeps {
  readonly digest: Pick<OwnerDigestService, "compose" | "recipientFromAuth" | "tenant">;
  readonly ledger: Pick<LedgerRepository, "listLines" | "accountBalance">;
  readonly accountRouting: Pick<AccountRoutingRepository, "get">;
  readonly branches: { findAll(): Promise<readonly Branch[]> };
  readonly approvals: Pick<ApprovalRequestRepository, "listPendingForRoles">;
  readonly users: Pick<UserRepository, "findById">;
  readonly today?: () => string;
}

interface GlanceView {
  readonly branchId: string;
  readonly scope: readonly string[] | undefined;
  readonly narrowed: boolean;
}

function refusal(error: GlanceRefusal, message: string, messageEn: string, extra: Record<string, unknown> = {}) {
  return { error, message, messageEn, ...extra };
}

async function controlBalance(deps: GlanceRoutesDeps, slot: ControlSlot, view: GlanceView, today: string): Promise<GlanceBalanceDTO | null> {
  const accountId = routedAccountId(await deps.accountRouting.get(), slot);
  if (!accountId) return null;
  let net: bigint;
  if (view.narrowed) {
    const lines = (await deps.ledger.listLines?.({ accountIds: [accountId], toDate: today })) ?? [];
    net = lines
      .filter((line) => cockpitLineInView(line.branchId, { branchId: view.branchId, scope: view.scope }))
      .reduce((sum, line) => sum + line.debit.scaled - line.credit.scaled, 0n);
  } else {
    net = (await deps.ledger.accountBalance(accountId, today)).balance.scaled;
  }
  const owed = slot === ControlSlot.Payable ? -net : net;
  return { amount: Money.fromScaled(owed).toString() };
}

async function waitingApprovals(deps: GlanceRoutesDeps, view: GlanceView): Promise<GlanceApprovalsDTO> {
  const pending = (await deps.approvals.listPendingForRoles([...ALL_PENDING_ROLES])).filter((request) => {
    const branchId = request.subject?.branchId ?? null;
    if (view.branchId !== "" && branchId !== view.branchId) return false;
    return withinBranchScope(branchId, view.scope);
  });
  const oldest = pending.reduce<string | null>((min, request) => (min === null || request.createdAt < min ? request.createdAt : min), null);
  return { waiting: pending.length, oldestWaitingSince: oldest };
}

export function createGlanceRoutes(deps: GlanceRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/glance", gate(GLANCE_PERMISSION), async (c) => {
    const parsed = glanceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(refusal(GlanceRefusal.InvalidQuery, "معايير النظرة السريعة غير صالحة.", "Invalid glance parameters.", { issues: parsed.error.issues }), 400);
    }
    const auth = getAuthContext(c);
    if (!auth) return c.json(refusal(GlanceRefusal.Unauthenticated, "سجّل الدخول أولاً.", "Sign in first."), 401);

    const user = await deps.users.findById(auth.userId);
    const recipient = await deps.digest.recipientFromAuth(auth, user ? user.nameAr : null);
    const scope = recipient.caller.branchScope;
    const requested = parsed.data.branchId;
    if (requested !== "" && requested !== UNATTRIBUTED_BRANCH_ID && scope !== undefined && !scope.includes(requested)) {
      return c.json(refusal(GlanceRefusal.BranchOutOfScope, "هذا الفرع خارج نطاق صلاحياتك.", "This branch is outside your scope."), 403);
    }
    const view: GlanceView = { branchId: requested, scope, narrowed: scope !== undefined || requested !== "" };
    const today = await tenantToday(c, deps.today);

    const digest = await deps.digest.compose(recipient, {
      cadence: OwnerDigestCadence.Daily,
      language: OwnerDigestLanguage.Ar,
      endingOn: today,
      branchId: requested,
    });

    const sales = can(auth, "sales.invoice.view");
    const purchases = can(auth, "purchases.invoice.view");
    const atBranchLevel = requested !== UNATTRIBUTED_BRANCH_ID;
    const [receivables, payables, approvals, branches] = await Promise.all([
      sales && atBranchLevel ? controlBalance(deps, ControlSlot.Receivable, view, today) : Promise.resolve(null),
      purchases && atBranchLevel ? controlBalance(deps, ControlSlot.Payable, view, today) : Promise.resolve(null),
      can(auth, "workflow.view") && atBranchLevel ? waitingApprovals(deps, view) : Promise.resolve(null),
      deps.branches.findAll(),
    ]);

    const grant = branchGrantOf(c);
    const reachable: GlanceBranchDTO[] = branches
      .filter((branch) => branch.active && (grant === undefined || grant.includes(branch.id)))
      .map((branch) => ({ id: branch.id, code: branch.code, name: branch.name }));

    const body: GlanceDTO = {
      generatedAt: digest.generatedAt,
      companyName: digest.companyName,
      currency: digest.currency,
      branchId: requested,
      branches: reachable,
      cockpit: digest.cockpit,
      receivables,
      payables,
      approvals,
      exceptions: digest.exceptions.filter((exception) => exception.kind !== OwnerDigestExceptionKind.ApprovalsWaiting),
    };
    return c.json(body);
  });

  return app;
}
