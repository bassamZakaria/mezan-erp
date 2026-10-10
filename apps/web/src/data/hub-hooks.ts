import { useEffect, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useApi } from "./ApiContext";
import { ApiError, readError, useBranches, useWarehouses } from "./hooks";
import type { ScopeSelection } from "./session";
import webPackageJson from "../../package.json";
import { useAppTranslation } from "../i18n";
import { useEntityName } from "../lib/entity-names";

/**
 * Data hooks for the domain hub landing pages, the manufacturing production
 * dashboard, the system-status page and the topbar's working-branch/
 * warehouse selector. Every figure here traces to a real endpoint or a real
 * build-time constant — never a fabricated number (docs/archive/web-data-wiring.md).
 */

// ---------------------------------------------------------------------------
// لوحة الإنتاج (Production dashboard) — GET /manufacturing/dashboard
// (packages/api/src/manufacturing-routes.ts, ~line 662). No @mezan/contracts
// DTO ships for it yet, so the wire shape is typed here from the route body.
// ---------------------------------------------------------------------------

export type WorkOrderStageDTO = "not_started" | "started" | "materials_issued" | "product_received" | "completed";
export type WorkOrderPriorityDTO = "low" | "normal" | "high";

/**
 * `producedQty`/`plannedQty` and every `kpis` money/qty figure cross the wire
 * as exact decimal STRINGS (the route's `num()` helper is `m => m.toString()`
 * despite its name — verified against a live `GET /manufacturing/dashboard`
 * response) — never floats. `progress` is a real number but a FRACTION in
 * [0, 1] (`workOrderProgress`, packages/domain/src/manufacturing/work-order.ts),
 * not a 0–100 percentage — callers must `× 100` before rendering "%".
 */
export interface ProductionBucketOrderDTO {
  readonly id: string;
  readonly number: string;
  readonly productItemId: string;
  readonly producedQty: string;
  readonly plannedQty: string;
  readonly progress: number;
  readonly priority: WorkOrderPriorityDTO;
  readonly overdue: boolean;
}

export interface ProductionActiveOrderDTO extends ProductionBucketOrderDTO {
  readonly scheduledEndDate: string | null;
  readonly stage: WorkOrderStageDTO;
  readonly nextAction: "start" | "issue" | "receive" | "complete" | null;
}

export interface ProductionDashboardDTO {
  readonly overdueCount: number;
  readonly kpis: {
    readonly activeWorkOrders: number;
    readonly wipValue: string;
    readonly unitsProducedThisMonth: string;
    readonly avgCostPerUnit: string;
  };
  readonly buckets: {
    readonly notStarted: readonly ProductionBucketOrderDTO[];
    readonly awaitingMaterialIssue: readonly ProductionBucketOrderDTO[];
    readonly awaitingProductReceipt: readonly ProductionBucketOrderDTO[];
    readonly readyToComplete: readonly ProductionBucketOrderDTO[];
  };
  readonly activeOrders: readonly ProductionActiveOrderDTO[];
}

/** لوحة الإنتاج (docs/archive/catalog/07 §"لوحة الإنتاج") — the real, already-mounted `GET /manufacturing/dashboard`. */
export function useManufacturingDashboard(): UseQueryResult<ProductionDashboardDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ProductionDashboardDTO, ApiError>({
    queryKey: ["manufacturing", "dashboard"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/dashboard");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("production.couldNotLoadTheProduction"), t));
      return res.json<ProductionDashboardDTO>();
    },
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------------------
// System status (/status) — real checks only. Mezan is a local-first desktop
// app with no cloud services board: "API" is a real `GET /health` round trip,
// "Database" is a real read against the seeded backend (a successful response
// only happens if SQLite opened and the query executed), and "Version" is the
// actual shipped build version — never an invented uptime/incident feed.
// ---------------------------------------------------------------------------

export type ServiceStateDTO = "operational" | "degraded" | "down" | "checking";

export interface ServiceCheckDTO {
  readonly key: string;
  readonly label: string;
  readonly state: ServiceStateDTO;
  readonly detail: string;
  readonly latencyMs: number | null;
}

async function timedCheck(run: () => Promise<{ ok: boolean; status: number }>): Promise<{ ok: boolean; status: number; ms: number }> {
  const start = performance.now();
  try {
    const res = await run();
    return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, status: 0, ms: Math.round(performance.now() - start) };
  }
}

export interface SystemStatusDTO {
  readonly services: readonly ServiceCheckDTO[];
  readonly checkedAt: string;
  readonly appVersion: string;
}

/**
 * Polls the two things Mezan can genuinely vouch for: the API responding
 * (`GET /health`) and the SQLite database being reachable for a real read
 * (`GET /branches` — succeeds only if the DB file opened and the query ran).
 * There is no separate "writable" probe: this app never issues a throwaway
 * write on every status-page view just to paint a green dot, so writability
 * is reported only as implied by every other successful mutation in the app,
 * not asserted here.
 */
/**
 * THE ONE VERSION SOURCE. «ما هي نسختك؟» is a support question this build gave
 * three different answers to: the login screen carried the literal
 * `Mezan 2026.8`, System Status printed the web package's version, and the
 * backup table printed each archive's manifest. On the desktop edition the
 * truth is `app.getVersion()` in the main process, so that is asked for over
 * IPC; on the browser build the bundle's own package version IS the build.
 *
 * The web version is the synchronous starting value rather than a placeholder,
 * so the login screen never paints a blank where a version belongs while the
 * IPC round trip is in flight.
 */
const WEB_VERSION = (webPackageJson as { version: string }).version;

export function useAppVersion(): string {
  const [version, setVersion] = useState(WEB_VERSION);
  useEffect(() => {
    const bridge = (globalThis as { mezan?: { appVersion?: () => Promise<string> } }).mezan;
    if (!bridge?.appVersion) return;
    let live = true;
    void bridge
      .appVersion()
      .then((reported) => {
        if (live && typeof reported === "string" && reported !== "") setVersion(reported);
      })
      .catch(() => {
        // The desktop build that answers this channel is the one that shipped
        // this bundle; an older one that does not simply leaves the web version
        // standing, which is the same number.
      });
    return () => {
      live = false;
    };
  }, []);
  return version;
}

export function useSystemStatus(): UseQueryResult<SystemStatusDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const appVersion = useAppVersion();
  return useQuery<SystemStatusDTO, ApiError>({
    queryKey: ["system-status"],
    enabled: session !== null,
    refetchInterval: 20_000,
    queryFn: async () => {
      const [health, db] = await Promise.all([
        timedCheck(() => request("/health")),
        timedCheck(() => request("/branches")),
      ]);
      const services: ServiceCheckDTO[] = [
        {
          key: "api",
          label: t("hubApi.theServerApi"),
          state: health.ok ? "operational" : "down",
          detail: health.ok ? t("hubApi.serverResponds", { ms: String(health.ms) }) : t("hubApi.serverDown", { status: String(health.status || "—") }),
          latencyMs: health.ok ? health.ms : null,
        },
        {
          key: "database",
          label: t("hubApi.theDatabaseSqlite"),
          state: db.ok ? "operational" : "down",
          detail: db.ok ? t("hubApi.dbOk", { ms: String(db.ms) }) : t("hubApi.dbDown", { status: String(db.status || "—") }),
          latencyMs: db.ok ? db.ms : null,
        },
      ];
      return { services, checkedAt: new Date().toISOString(), appVersion };
    },
  });
}

// ---------------------------------------------------------------------------
// Topbar working-branch / warehouse selector — options are the user's own
// session scope (never wider than what they're permitted to see); warehouses
// are further narrowed to the selected branch once one is picked.
// ---------------------------------------------------------------------------

export interface ScopeOption {
  readonly id: string;
  readonly label: string;
}

export interface UseScopeSelectorResult {
  readonly branchOptions: readonly ScopeOption[];
  readonly warehouseOptions: readonly ScopeOption[];
  readonly selection: ScopeSelection;
  /** Whether the session is limited to specific branches rather than all of them. */
  readonly isBranchScoped: boolean;
  setBranch(branchId: string | null): void;
  setWarehouse(warehouseId: string | null): void;
}

/** Backs the topbar's branch/warehouse dropdowns; the actual header-narrowing lives in `authHeaders` (data/session.ts) via `ApiContext.scopeSelection`. */
/**
 * The branch and warehouse ids this session may see, as sets.
 *
 * `null` means the `"*"` scope — no restriction — which is NOT the same as an
 * empty set, and reading it as one would hide every branch from an admin.
 *
 * Memoised so callers depend on the sets themselves rather than on the session
 * fields behind them. Both recompute at exactly the same moments either way;
 * naming the real dependency is what lets the rules of hooks check it, and it
 * stops the two call sites below duplicating the derivation.
 */
function useAllowedScopeIds(): {
  allowedBranchIds: Set<string> | null;
  allowedWarehouseIds: Set<string> | null;
} {
  const { session } = useApi();
  const branchScope = session?.branchScope;
  const warehouseScope = session?.warehouseScope;
  const allowedBranchIds = useMemo(
    () => (branchScope === "*" ? null : new Set(branchScope ?? [])),
    [branchScope],
  );
  const allowedWarehouseIds = useMemo(
    () => (warehouseScope === "*" ? null : new Set(warehouseScope ?? [])),
    [warehouseScope],
  );
  return { allowedBranchIds, allowedWarehouseIds };
}

export function useScopeSelector(): UseScopeSelectorResult {
  const { session, scopeSelection, setScopeSelection } = useApi();
  const nameOf = useEntityName();
  const branchesQuery = useBranches();
  const warehousesQuery = useWarehouses();

  const { allowedBranchIds, allowedWarehouseIds } = useAllowedScopeIds();

  const branchOptions = useMemo<ScopeOption[]>(() => {
    const branches = branchesQuery.data ?? [];
    return branches
      .filter((b) => b.active && (allowedBranchIds === null || allowedBranchIds.has(b.id)))
      .map((b) => ({ id: b.id, label: nameOf(b) }));
  }, [branchesQuery.data, nameOf, allowedBranchIds]);

  const warehouseOptions = useMemo<ScopeOption[]>(() => {
    const warehouses = warehousesQuery.data ?? [];
    return warehouses
      .filter(
        (w) =>
          w.active &&
          (allowedWarehouseIds === null || allowedWarehouseIds.has(w.id)) &&
          (!scopeSelection.branchId || w.branchId === scopeSelection.branchId),
      )
      .map((w) => ({ id: w.id, label: nameOf(w) }));
  }, [warehousesQuery.data, scopeSelection.branchId, nameOf, allowedWarehouseIds]);

  function setBranch(branchId: string | null) {
    const stillValid = branchId
      ? (warehousesQuery.data ?? []).some((w) => w.id === scopeSelection.warehouseId && w.branchId === branchId)
      : true;
    setScopeSelection({ branchId, warehouseId: stillValid ? scopeSelection.warehouseId : null });
  }

  function setWarehouse(warehouseId: string | null) {
    setScopeSelection({ ...scopeSelection, warehouseId });
  }

  return {
    branchOptions,
    warehouseOptions,
    selection: scopeSelection,
    isBranchScoped: allowedBranchIds !== null,
    setBranch,
    setWarehouse,
  };
}

export interface WorkingLocation {
  /** Branch a new document is created in: the selected one, else the tenant's main/first allowed branch. */
  readonly branchId: string | null;
  /** Warehouse a new document draws stock from: the selected one, else that branch's default/first allowed warehouse. */
  readonly warehouseId: string | null;
}

/**
 * Where a newly-created document belongs.
 *
 * The purchase screens used to post the literal ids `"MAIN"` / `"MAIN-WH"`,
 * which exist in no tenant this app ever seeds (`BR-MAIN` / `WH-MAIN`), so
 * every RFQ, purchase order and purchase invoice was stamped with a branch and
 * warehouse that could not be resolved. This resolves them from the caller's
 * OWN scope instead of a constant.
 */
export function useWorkingLocation(): WorkingLocation {
  const { session, scopeSelection } = useApi();
  const branchesQuery = useBranches();
  const warehousesQuery = useWarehouses();

  const { allowedBranchIds, allowedWarehouseIds } = useAllowedScopeIds();

  return useMemo<WorkingLocation>(() => {
    const branches = (branchesQuery.data ?? []).filter(
      (b) => b.active && (allowedBranchIds === null || allowedBranchIds.has(b.id)),
    );
    const branchId =
      scopeSelection.branchId ?? branches.find((b) => b.isMain)?.id ?? branches[0]?.id ?? null;

    const warehouses = (warehousesQuery.data ?? []).filter(
      (w) =>
        w.active &&
        (allowedWarehouseIds === null || allowedWarehouseIds.has(w.id)) &&
        (!branchId || w.branchId === branchId),
    );
    const warehouseId =
      scopeSelection.warehouseId ?? warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? null;

    return { branchId, warehouseId };
  }, [
    branchesQuery.data,
    warehousesQuery.data,
    scopeSelection.branchId,
    scopeSelection.warehouseId,
    allowedBranchIds,
    allowedWarehouseIds,
  ]);
}
