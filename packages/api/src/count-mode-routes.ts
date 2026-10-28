import { Hono, type Context } from "hono";
import {
  CountModeRefusal,
  CountModeRefusalError,
  CountScanMode,
  CountScanOutcome,
  CountZoneKind,
  DuplicateRecordIdError,
  InvalidPhysicalCountError,
  InvalidPhysicalCountStatusError,
  PhysicalCountNotFoundError,
  can,
  isCounterOf,
  lineVarianceOf,
  revealsLiveVariance,
  summarizePhysicalCountVariance,
  zoneProgressOf,
  zoneVarianceOf,
  type AuditSink,
  type CountModeService,
  type CountScan,
  type CountZone,
  type Item,
  type ItemRepository,
  type PhysicalCount,
  type PhysicalCountLine,
} from "@mezan/domain";
import {
  countModeRecountSchema,
  countModeScanSchema,
  startCountModeSchema,
  type CountModeCounterDTO,
  type CountModeItemDTO,
  type CountModeMineEntryDTO,
  type CountModeScanRecordDTO,
  type CountModeScanResultDTO,
  type CountModeSessionDTO,
  type CountModeZoneSummaryDTO,
} from "@mezan/contracts";
import { createAnyPermissionGate, createPermissionGate, getAuthContext, maySeeItemCost, sessionWarehouseScopeOf, warehouseScopeOf, withinScope, type AuthContextResolver } from "./permission-gate.js";
import { branchesOfWarehouses, storedBranchesById, withinBranchGrant } from "./stored-branches.js";
import { recordAdminEvent } from "./admin-audit.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { tenantDay } from "./tenant-day.js";

export enum CountModePermission {
  Scan = "inventory.count.scan",
  Assign = "inventory.count.assign",
  Review = "inventory.count.review",
  Approve = "inventory.count.approve",
}

enum CountModeAuditAction {
  Start = "COUNT_MODE_START",
  Submit = "COUNT_MODE_ZONE_SUBMIT",
  Recount = "COUNT_MODE_RECOUNT",
  Approve = "COUNT_MODE_ZONE_APPROVE",
  VoidScan = "COUNT_MODE_SCAN_VOID",
  ZeroFill = "COUNT_MODE_ZERO_FILL",
  Complete = "COUNT_MODE_COMPLETE",
}

const AUDIT_MODULE = "inventory";
const AUDIT_ENTITY = "PHYSICAL_COUNT";

const REFUSAL_STATUS: Readonly<Record<CountModeRefusal, 400 | 403 | 404 | 409>> = {
  [CountModeRefusal.NoZones]: 400,
  [CountModeRefusal.ZoneWithoutItems]: 400,
  [CountModeRefusal.ZoneWithoutCounters]: 400,
  [CountModeRefusal.ItemInTwoZones]: 400,
  [CountModeRefusal.CounterNotAssigned]: 403,
  [CountModeRefusal.ZoneNotOpen]: 409,
  [CountModeRefusal.ZoneNotSubmitted]: 409,
  [CountModeRefusal.ZoneHasUncountedItems]: 409,
  [CountModeRefusal.ZoneNotFound]: 404,
  [CountModeRefusal.ScanNotFound]: 404,
  [CountModeRefusal.ScanAlreadyVoided]: 409,
  [CountModeRefusal.NotYourScan]: 403,
  [CountModeRefusal.SelfReview]: 403,
  [CountModeRefusal.InvalidQuantity]: 400,
  [CountModeRefusal.UnknownUnit]: 400,
  [CountModeRefusal.ZonesNotApproved]: 409,
  [CountModeRefusal.NotACountModeSession]: 409,
  [CountModeRefusal.RecountNeedsItems]: 400,
  [CountModeRefusal.RecountReasonRequired]: 400,
  [CountModeRefusal.ItemNotInZone]: 400,
};

enum CountModeRouteError {
  CounterNotEligible = "COUNTER_NOT_ELIGIBLE",
  WarehouseOutOfScope = "WAREHOUSE_OUT_OF_SCOPE",
  ValidationError = "VALIDATION_ERROR",
  NotFound = "PHYSICAL_COUNT_NOT_FOUND",
}

export interface CountModeRoutesDeps {
  readonly service: CountModeService;
  readonly items: Pick<ItemRepository, "list">;
  readonly eligibleCounters: () => Promise<readonly CountModeCounterDTO[]>;
  readonly userNames: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly newId: () => string;
  readonly audit?: AuditSink;
}

interface Viewer {
  readonly userId: string;
  readonly canReview: boolean;
  readonly seesAll: boolean;
}

function viewerOf(c: Context): Viewer {
  const ctx = getAuthContext(c);
  const userId = ctx?.userId ?? "";
  const canReview = ctx ? can(ctx, CountModePermission.Review) : false;
  const canAssign = ctx ? can(ctx, CountModePermission.Assign) : false;
  return { userId, canReview, seesAll: canReview || canAssign };
}

function refusalResponse(c: Context, err: unknown): Response {
  if (err instanceof CountModeRefusalError) {
    return c.json({ error: err.code, reason: err.reason, message: err.message, messageEn: err.messageEn }, REFUSAL_STATUS[err.reason]);
  }
  if (err instanceof PhysicalCountNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
  if (err instanceof InvalidPhysicalCountStatusError) return c.json({ error: err.code, message: err.message }, 409);
  if (err instanceof InvalidPhysicalCountError) return c.json({ error: err.code, message: err.message }, 409);
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  throw err;
}

function warehouseRefusal(c: Context, warehouseId: string): Response | undefined {
  const scope = sessionWarehouseScopeOf(c);
  if (!scope || scope.includes(warehouseId)) return undefined;
  return c.json(
    { error: CountModeRouteError.WarehouseOutOfScope, warehouseId, message: `المستودع "${warehouseId}" خارج نطاق المستودعات المصرّح لك بها.` },
    403,
  );
}

interface ItemFacts {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly unitCode: string;
  readonly units: CountModeItemDTO["units"];
}

function factsOf(item: Item): ItemFacts {
  return {
    code: item.code,
    nameAr: item.nameAr,
    nameEn: item.nameEn,
    unitCode: item.baseUnitCode,
    units: item.alternateUnits.filter((u) => Number.isSafeInteger(u.factor) && u.factor > 0).map((u) => ({ code: u.code, name: u.name, factor: u.factor })),
  };
}

function zoneSummary(zone: CountZone, count: PhysicalCount, viewer: Viewer, reveal: boolean, showCost: boolean): CountModeZoneSummaryDTO {
  const progress = zoneProgressOf(zone, count);
  const variance = reveal && viewer.seesAll ? zoneVarianceOf(zone, count) : null;
  return {
    id: zone.id,
    name: zone.name,
    kind: zone.kind as unknown as CountModeZoneSummaryDTO["kind"],
    categoryId: zone.categoryId,
    status: zone.status as unknown as CountModeZoneSummaryDTO["status"],
    counterUserIds: zone.counterUserIds as string[],
    totalItems: progress.totalItems,
    countedItems: progress.countedItems,
    recountItems: progress.recountItems,
    submittedAt: zone.submittedAt,
    submittedBy: zone.submittedBy,
    approvedAt: zone.approvedAt,
    approvedBy: zone.approvedBy,
    assignedToMe: isCounterOf(zone, viewer.userId),
    netValue: variance && showCost ? variance.netValue.toString() : null,
    absValue: variance && showCost ? variance.absValue.toString() : null,
  };
}

function itemRow(line: PhysicalCountLine, zoneId: string, facts: ItemFacts | undefined, reveal: boolean, showCost: boolean): CountModeItemDTO {
  const variance = reveal ? lineVarianceOf(line) : null;
  return {
    itemId: line.itemId,
    code: facts?.code ?? line.itemId,
    nameAr: facts?.nameAr ?? line.itemId,
    nameEn: facts?.nameEn ?? null,
    unitCode: facts?.unitCode ?? "",
    units: facts?.units ?? [],
    zoneId,
    countedQty: line.countedQty ? line.countedQty.toString() : null,
    recount: line.recount,
    systemQty: variance ? variance.systemQty.toString() : null,
    varianceQty: variance?.varianceQty ? variance.varianceQty.toString() : null,
    varianceValue: showCost && variance?.varianceValue ? variance.varianceValue.toString() : null,
  };
}

function scanRecord(scan: CountScan, names: ReadonlyMap<string, string>): CountModeScanRecordDTO {
  return {
    id: scan.id,
    zoneId: scan.zoneId,
    itemId: scan.itemId,
    barcode: scan.barcode,
    outcome: scan.outcome as unknown as CountModeScanRecordDTO["outcome"],
    source: scan.source as unknown as CountModeScanRecordDTO["source"],
    qty: scan.qty.toString(),
    enteredQty: scan.enteredQty ? scan.enteredQty.toString() : null,
    unitCode: scan.unitCode,
    userId: scan.userId,
    userName: names.get(scan.userId) ?? scan.userId,
    scannedAt: scan.scannedAt,
    voidedAt: scan.voidedAt,
    voidedBy: scan.voidedBy,
    voidReason: scan.voidReason as unknown as CountModeScanRecordDTO["voidReason"],
  };
}

export function createCountModeRoutes(deps: CountModeRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const options = {
    storedBranches: storedBranchesById((id) => deps.service.findCount(id), (count, c) => branchesOfWarehouses(c, [count.warehouseId])),
  };
  const gate = createPermissionGate(resolveAuthContext, options);
  const gateAny = createAnyPermissionGate(resolveAuthContext, options);

  async function itemFacts(ids: ReadonlySet<string>): Promise<ReadonlyMap<string, ItemFacts>> {
    const out = new Map<string, ItemFacts>();
    for (const item of await deps.items.list()) if (ids.has(item.id)) out.set(item.id, factsOf(item));
    return out;
  }

  async function sessionOf(c: Context, count: PhysicalCount): Promise<CountModeSessionDTO> {
    const viewer = viewerOf(c);
    const zones = await deps.service.listZones(count.id);
    const reveal = revealsLiveVariance(count, zones, viewer);
    const visible = viewer.seesAll ? zones : zones.filter((z) => isCounterOf(z, viewer.userId));
    const itemIds = new Set(visible.flatMap((z) => z.itemIds));
    const facts = await itemFacts(itemIds);
    const zoneOf = new Map<string, string>();
    for (const zone of visible) for (const itemId of zone.itemIds) zoneOf.set(itemId, zone.id);
    const lines = count.lines.filter((l) => zoneOf.has(l.itemId));
    const names = await deps.userNames([...new Set(visible.flatMap((z) => [...z.counterUserIds, ...(z.submittedBy ? [z.submittedBy] : []), ...(z.approvedBy ? [z.approvedBy] : [])]))]);
    const summary = reveal && viewer.seesAll ? summarizePhysicalCountVariance({ ...count, lines }) : null;
    return {
      id: count.id,
      countNo: count.countNo,
      warehouseId: count.warehouseId,
      date: count.date,
      memo: count.memo,
      status: count.status,
      blind: count.blind,
      generatedAdjustmentId: count.generatedAdjustmentId,
      zones: visible.map((z) => zoneSummary(z, count, viewer, reveal, maySeeItemCost(c))),
      items: lines.map((l) => itemRow(l, zoneOf.get(l.itemId) as string, facts.get(l.itemId), reveal, maySeeItemCost(c))),
      counters: [...names].map(([userId, name]) => ({ userId, name })),
      revealsVariance: reveal,
      canReview: viewer.canReview,
      netValue: summary && maySeeItemCost(c) ? summary.netValue.toString() : null,
      absValue: summary && maySeeItemCost(c) ? summary.absValue.toString() : null,
    };
  }

  async function loadCount(c: Context): Promise<PhysicalCount | Response> {
    const count = await deps.service.findCount(c.req.param("id") ?? "");
    if (!count || !count.zoned) return c.json({ error: CountModeRouteError.NotFound }, 404);
    return count;
  }

  async function audit(c: Context, action: CountModeAuditAction, countId: string, details: Record<string, unknown>): Promise<void> {
    await recordAdminEvent(deps.audit, c, { module: AUDIT_MODULE, entityType: AUDIT_ENTITY, entityId: countId, action, details });
  }

  app.get("/counters", gate(CountModePermission.Assign), async (c) => c.json(await deps.eligibleCounters()));

  app.get("/mine", gateAny(CountModePermission.Scan, CountModePermission.Review, CountModePermission.Assign), async (c) => {
    const viewer = viewerOf(c);
    const counts = await withinBranchGrant(
      c,
      withinScope(await deps.service.listZonedCounts(), warehouseScopeOf(c), (count) => count.warehouseId),
      (count) => branchesOfWarehouses(c, [count.warehouseId]),
    );
    const entries: CountModeMineEntryDTO[] = [];
    for (const count of counts) {
      if (count.status !== "IN_PROGRESS") continue;
      const zones = await deps.service.listZones(count.id);
      const reveal = revealsLiveVariance(count, zones, viewer);
      const visible = viewer.seesAll ? zones : zones.filter((z) => isCounterOf(z, viewer.userId));
      if (visible.length === 0) continue;
      entries.push({
        id: count.id,
        countNo: count.countNo,
        warehouseId: count.warehouseId,
        date: count.date,
        blind: count.blind,
        status: count.status,
        zones: visible.map((z) => zoneSummary(z, count, viewer, reveal, maySeeItemCost(c))),
      });
    }
    return c.json(entries);
  });

  app.post("/", gate(CountModePermission.Assign), async (c) => {
    const parsed = startCountModeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: CountModeRouteError.ValidationError, details: parsed.error.flatten() }, 400);
    const refusal = warehouseRefusal(c, parsed.data.warehouseId);
    if (refusal) return refusal;
    const eligible = new Set((await deps.eligibleCounters()).map((counter) => counter.userId));
    const stranger = parsed.data.zones.flatMap((z) => z.counterUserIds).find((id) => !eligible.has(id));
    if (stranger !== undefined) {
      return c.json({ error: CountModeRouteError.CounterNotEligible, userId: stranger, message: "المستخدم المعيّن لا يملك صلاحية الجرد بالمسح.", messageEn: "The assigned user cannot count by scanning." }, 400);
    }
    const countId = `CNT-${deps.newId()}`;
    try {
      const { count, zones } = await deps.service.start({
        id: countId,
        warehouseId: parsed.data.warehouseId,
        date: await tenantDay(c, parsed.data.date),
        memo: parsed.data.memo,
        blind: parsed.data.blind,
        zoneIds: parsed.data.zones.map(() => `ZN-${deps.newId()}`),
        zones: parsed.data.zones.map((z) => ({
          name: z.name,
          kind: z.kind as unknown as CountZoneKind,
          categoryId: z.categoryId ?? null,
          itemIds: z.itemIds,
          counterUserIds: z.counterUserIds,
        })),
      });
      await audit(c, CountModeAuditAction.Start, count.id, {
        warehouseId: count.warehouseId,
        blind: count.blind,
        zones: zones.map((z) => ({ id: z.id, name: z.name, items: z.itemIds.length, counters: z.counterUserIds })),
      });
      return c.json(await sessionOf(c, count), 201);
    } catch (err) {
      return refusalResponse(c, err);
    }
  });

  app.get("/:id", gateAny(CountModePermission.Scan, CountModePermission.Review, CountModePermission.Assign), async (c) => {
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    return c.json(await sessionOf(c, count));
  });

  function warehouseRefusalFor(c: Context, count: PhysicalCount): Response | undefined {
    return warehouseRefusal(c, count.warehouseId);
  }

  app.get("/:id/scans", gateAny(CountModePermission.Scan, CountModePermission.Review), async (c) => {
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    const viewer = viewerOf(c);
    const scans = await deps.service.listScans(count.id, {
      zoneId: c.req.query("zoneId") || undefined,
      itemId: c.req.query("itemId") || undefined,
      userId: viewer.canReview ? undefined : viewer.userId,
    });
    const names = await deps.userNames([...new Set(scans.map((s) => s.userId))]);
    return c.json(scans.map((s) => scanRecord(s, names)));
  });

  app.post("/:id/zones/:zoneId/scan", gate(CountModePermission.Scan), async (c) => {
    const parsed = countModeScanSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: CountModeRouteError.ValidationError, details: parsed.error.flatten() }, 400);
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    const viewer = viewerOf(c);
    try {
      const result = await deps.service.scan({
        countId: count.id,
        zoneId: c.req.param("zoneId") ?? "",
        userId: viewer.userId,
        scanId: `SCN-${deps.newId()}`,
        clientKey: parsed.data.clientKey ?? null,
        barcode: parsed.data.barcode ?? null,
        itemId: parsed.data.itemId ?? null,
        mode: parsed.data.mode as unknown as CountScanMode,
        qty: parsed.data.qty ?? null,
        unitCode: parsed.data.unitCode ?? null,
      });
      const fresh = (await deps.service.findCount(count.id)) as PhysicalCount;
      const zones = await deps.service.listZones(count.id);
      const reveal = revealsLiveVariance(fresh, zones, viewer);
      const facts = result.itemId ? await itemFacts(new Set([result.itemId])) : new Map<string, ItemFacts>();
      const line = result.line ?? (result.itemId ? fresh.lines.find((l) => l.itemId === result.itemId) : undefined);
      const body: CountModeScanResultDTO = {
        outcome: result.outcome as unknown as CountModeScanResultDTO["outcome"],
        replayed: result.replayed,
        scan: scanRecord(result.scan, new Map([[viewer.userId, viewer.userId]])),
        item: line && result.itemId ? itemRow(line, result.zone.id, facts.get(result.itemId), reveal, maySeeItemCost(c)) : null,
        addedQty: result.outcome === CountScanOutcome.Counted ? result.scan.qty.toString() : null,
        zone: zoneSummary(result.zone, fresh, viewer, reveal, maySeeItemCost(c)),
      };
      return c.json(body, result.replayed ? 200 : 201);
    } catch (err) {
      return refusalResponse(c, err);
    }
  });

  app.post("/:id/scans/:scanId/void", gateAny(CountModePermission.Scan, CountModePermission.Review), async (c) => {
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    const viewer = viewerOf(c);
    try {
      const result = await deps.service.voidScan(count.id, c.req.param("scanId") ?? "", viewer.userId, viewer.canReview);
      await audit(c, CountModeAuditAction.VoidScan, count.id, { scanId: result.scan.id, itemId: result.itemId, zoneId: result.zone.id });
      return c.json({ ok: true });
    } catch (err) {
      return refusalResponse(c, err);
    }
  });

  app.post("/:id/zones/:zoneId/zero-fill", gate(CountModePermission.Scan), async (c) => {
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    const viewer = viewerOf(c);
    try {
      const zone = c.req.param("zoneId") ?? "";
      const written = await deps.service.zeroFill(count.id, zone, viewer.userId, []);
      await audit(c, CountModeAuditAction.ZeroFill, count.id, { zoneId: zone, itemIds: written.map((s) => s.itemId) });
      return c.json({ filled: written.length });
    } catch (err) {
      return refusalResponse(c, err);
    }
  });

  app.post("/:id/zones/:zoneId/submit", gate(CountModePermission.Scan), async (c) => {
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    try {
      const zone = await deps.service.submitZone(count.id, c.req.param("zoneId") ?? "", viewerOf(c).userId);
      await audit(c, CountModeAuditAction.Submit, count.id, { zoneId: zone.id });
      return c.json(await sessionOf(c, (await deps.service.findCount(count.id)) as PhysicalCount));
    } catch (err) {
      return refusalResponse(c, err);
    }
  });

  app.post("/:id/zones/:zoneId/recount", gate(CountModePermission.Review), async (c) => {
    const parsed = countModeRecountSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: CountModeRouteError.ValidationError, details: parsed.error.flatten() }, 400);
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    try {
      const { zone, count: next } = await deps.service.flagRecount(count.id, c.req.param("zoneId") ?? "", parsed.data.itemIds, viewerOf(c).userId, parsed.data.reason);
      await audit(c, CountModeAuditAction.Recount, count.id, { zoneId: zone.id, itemIds: parsed.data.itemIds, reason: parsed.data.reason });
      return c.json(await sessionOf(c, next));
    } catch (err) {
      return refusalResponse(c, err);
    }
  });

  app.post("/:id/zones/:zoneId/approve", gate(CountModePermission.Approve), async (c) => {
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    try {
      const zone = await deps.service.approveZone(count.id, c.req.param("zoneId") ?? "", viewerOf(c).userId);
      await audit(c, CountModeAuditAction.Approve, count.id, { zoneId: zone.id });
      return c.json(await sessionOf(c, (await deps.service.findCount(count.id)) as PhysicalCount));
    } catch (err) {
      return refusalResponse(c, err);
    }
  });

  app.post("/:id/complete", gate(CountModePermission.Review), async (c) => {
    const count = await loadCount(c);
    if (count instanceof Response) return count;
    const refusal = warehouseRefusalFor(c, count);
    if (refusal) return refusal;
    try {
      const done = await deps.service.complete(count.id);
      await audit(c, CountModeAuditAction.Complete, count.id, {});
      return c.json(await sessionOf(c, done));
    } catch (err) {
      return refusalResponse(c, err);
    }
  });

  return app;
}
