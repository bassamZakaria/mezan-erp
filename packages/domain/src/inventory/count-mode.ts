import { Qty } from "../money/index.js";
import {
  PhysicalCountNotFoundError,
  revealsSystemQty,
  type PhysicalCount,
  type PhysicalCountCompletionGate,
  type PhysicalCountListFilter,
  type PhysicalCountLine,
  type PhysicalCountService,
} from "./physical-count.js";
import { summarizePhysicalCountVariance, lineVarianceOf, type PhysicalCountLineVariance, type PhysicalCountVarianceSummary } from "./physical-count-variance.js";

export enum CountZoneKind {
  Category = "CATEGORY",
  AdHoc = "AD_HOC",
}

export enum CountZoneStatus {
  Open = "OPEN",
  Submitted = "SUBMITTED",
  Approved = "APPROVED",
}

export enum CountScanSource {
  Scan = "SCAN",
  Keypad = "KEYPAD",
  KeypadSet = "KEYPAD_SET",
  ZeroFill = "ZERO_FILL",
}

export enum CountScanOutcome {
  Counted = "COUNTED",
  UnknownBarcode = "UNKNOWN_BARCODE",
  NotInZone = "NOT_IN_ZONE",
}

export enum CountScanVoidReason {
  Undo = "UNDO",
  Replaced = "REPLACED",
  Recount = "RECOUNT",
}

export enum CountScanMode {
  Add = "ADD",
  Set = "SET",
}

export enum CountModeRefusal {
  NoZones = "NO_ZONES",
  ZoneWithoutItems = "ZONE_WITHOUT_ITEMS",
  ZoneWithoutCounters = "ZONE_WITHOUT_COUNTERS",
  ItemInTwoZones = "ITEM_IN_TWO_ZONES",
  CounterNotAssigned = "COUNTER_NOT_ASSIGNED",
  ZoneNotOpen = "ZONE_NOT_OPEN",
  ZoneNotSubmitted = "ZONE_NOT_SUBMITTED",
  ZoneHasUncountedItems = "ZONE_HAS_UNCOUNTED_ITEMS",
  ZoneNotFound = "ZONE_NOT_FOUND",
  ScanNotFound = "SCAN_NOT_FOUND",
  ScanAlreadyVoided = "SCAN_ALREADY_VOIDED",
  NotYourScan = "NOT_YOUR_SCAN",
  SelfReview = "SELF_REVIEW",
  InvalidQuantity = "INVALID_QUANTITY",
  UnknownUnit = "UNKNOWN_UNIT",
  ZonesNotApproved = "ZONES_NOT_APPROVED",
  NotACountModeSession = "NOT_A_COUNT_MODE_SESSION",
  RecountNeedsItems = "RECOUNT_NEEDS_ITEMS",
  RecountReasonRequired = "RECOUNT_REASON_REQUIRED",
  ItemNotInZone = "ITEM_NOT_IN_ZONE",
}

const REFUSALS: Readonly<Record<CountModeRefusal, { readonly ar: string; readonly en: string }>> = {
  [CountModeRefusal.NoZones]: { ar: "أضف منطقة جرد واحدة على الأقل.", en: "Add at least one count zone." },
  [CountModeRefusal.ZoneWithoutItems]: { ar: "المنطقة لا تحتوي أي صنف.", en: "The zone has no items." },
  [CountModeRefusal.ZoneWithoutCounters]: { ar: "عيّن عادّاً واحداً على الأقل لكل منطقة.", en: "Assign at least one counter to every zone." },
  [CountModeRefusal.ItemInTwoZones]: { ar: "الصنف موجود في أكثر من منطقة؛ يُعدّ كل صنف في منطقة واحدة فقط.", en: "An item is in more than one zone; each item is counted in exactly one zone." },
  [CountModeRefusal.CounterNotAssigned]: { ar: "لست معيّناً على هذه المنطقة.", en: "You are not assigned to this zone." },
  [CountModeRefusal.ZoneNotOpen]: { ar: "المنطقة ليست مفتوحة للعدّ.", en: "The zone is not open for counting." },
  [CountModeRefusal.ZoneNotSubmitted]: { ar: "المنطقة لم تُسلَّم للمراجعة بعد.", en: "The zone has not been submitted for review." },
  [CountModeRefusal.ZoneHasUncountedItems]: { ar: "في المنطقة أصناف لم تُعدّ بعد. عدّها أو سجّلها صفراً صراحةً قبل التسليم.", en: "The zone still has uncounted items. Count them, or record them as zero explicitly, before submitting." },
  [CountModeRefusal.ZoneNotFound]: { ar: "المنطقة غير موجودة.", en: "The zone was not found." },
  [CountModeRefusal.ScanNotFound]: { ar: "عملية المسح غير موجودة.", en: "The scan was not found." },
  [CountModeRefusal.ScanAlreadyVoided]: { ar: "عملية المسح ملغاة بالفعل.", en: "The scan is already voided." },
  [CountModeRefusal.NotYourScan]: { ar: "لا يمكنك إلغاء مسح سجّله عادّ آخر.", en: "You cannot void a scan another counter recorded." },
  [CountModeRefusal.SelfReview]: { ar: "لا يجوز لمن عدّ في المنطقة مراجعتها أو اعتمادها.", en: "Someone who counted in the zone cannot review or approve it." },
  [CountModeRefusal.InvalidQuantity]: { ar: "الكمية غير صالحة.", en: "The quantity is not valid." },
  [CountModeRefusal.UnknownUnit]: { ar: "الوحدة غير معرّفة لهذا الصنف أو معاملها ليس عدداً صحيحاً.", en: "The unit is not defined for this item, or its factor is not a whole number." },
  [CountModeRefusal.ZonesNotApproved]: { ar: "لا يمكن إنهاء الجرد قبل اعتماد كل المناطق.", en: "The count cannot be completed until every zone is approved." },
  [CountModeRefusal.NotACountModeSession]: { ar: "هذه الجلسة لا تعمل بالمناطق.", en: "This session does not use zones." },
  [CountModeRefusal.RecountNeedsItems]: { ar: "حدّد الأصناف المطلوب إعادة عدّها.", en: "Choose the items to recount." },
  [CountModeRefusal.RecountReasonRequired]: { ar: "اذكر سبب إعادة العدّ.", en: "Give a reason for the recount." },
  [CountModeRefusal.ItemNotInZone]: { ar: "الصنف ليس من أصناف هذه المنطقة.", en: "The item is not in this zone." },
};

export class CountModeRefusalError extends Error {
  readonly code = "COUNT_MODE_REFUSED";
  readonly messageEn: string;
  constructor(readonly reason: CountModeRefusal) {
    super(REFUSALS[reason].ar);
    this.messageEn = REFUSALS[reason].en;
    this.name = "CountModeRefusalError";
  }
}

export interface CountZone {
  readonly id: string;
  readonly countId: string;
  readonly name: string;
  readonly kind: CountZoneKind;
  readonly categoryId: string | null;
  readonly itemIds: readonly string[];
  readonly counterUserIds: readonly string[];
  readonly status: CountZoneStatus;
  readonly submittedAt: string | null;
  readonly submittedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
}

export interface CountScan {
  readonly id: string;
  readonly countId: string;
  readonly zoneId: string | null;
  readonly itemId: string | null;
  readonly barcode: string | null;
  readonly outcome: CountScanOutcome;
  readonly source: CountScanSource;
  readonly qty: Qty;
  readonly enteredQty: Qty | null;
  readonly unitCode: string | null;
  readonly userId: string;
  readonly scannedAt: string;
  readonly clientKey: string | null;
  readonly voidedAt: string | null;
  readonly voidedBy: string | null;
  readonly voidReason: CountScanVoidReason | null;
  readonly note: string | null;
}

export interface CountModeRepository {
  saveZones(zones: readonly CountZone[]): Promise<void>;
  updateZone(zone: CountZone): Promise<void>;
  listZones(countId: string): Promise<readonly CountZone[]>;
  findZone(countId: string, zoneId: string): Promise<CountZone | null>;
  zonesOfCounter(userId: string): Promise<readonly CountZone[]>;
  appendScan(scan: CountScan): Promise<void>;
  findScan(countId: string, scanId: string): Promise<CountScan | null>;
  findScanByClientKey(countId: string, clientKey: string): Promise<CountScan | null>;
  voidScans(countId: string, scanIds: readonly string[], by: string, reason: CountScanVoidReason, at: string): Promise<void>;
  listScans(countId: string, filter?: { readonly zoneId?: string; readonly itemId?: string; readonly userId?: string }): Promise<readonly CountScan[]>;
}

export interface CountableItem {
  readonly id: string;
  readonly code: string;
  readonly barcodes: readonly string[];
  readonly baseUnitCode: string;
  readonly alternateUnits: readonly { readonly code: string; readonly factor: number }[];
}

export interface CountItemDirectory {
  findByBarcode(code: string): Promise<CountableItem | null>;
  findById(id: string): Promise<CountableItem | null>;
  itemsInCategory(categoryId: string): Promise<readonly string[]>;
}

export interface CountZoneSpec {
  readonly name: string;
  readonly kind: CountZoneKind;
  readonly categoryId?: string | null;
  readonly itemIds?: readonly string[];
  readonly counterUserIds: readonly string[];
}

export interface StartCountModeCommand {
  readonly id: string;
  readonly warehouseId: string;
  readonly date: string;
  readonly memo?: string;
  readonly blind?: boolean;
  readonly zones: readonly CountZoneSpec[];
  readonly zoneIds: readonly string[];
}

export interface CountModeScanCommand {
  readonly countId: string;
  readonly zoneId: string;
  readonly userId: string;
  readonly scanId: string;
  readonly clientKey: string | null;
  readonly barcode: string | null;
  readonly itemId: string | null;
  readonly mode: CountScanMode;
  readonly qty: string | null;
  readonly unitCode: string | null;
}

export interface CountModeScanResult {
  readonly outcome: CountScanOutcome;
  readonly scan: CountScan;
  readonly replayed: boolean;
  readonly itemId: string | null;
  readonly line: PhysicalCountLine | null;
  readonly zone: CountZone;
}

export interface CountModeServiceDeps {
  readonly counts: PhysicalCountService;
  readonly repo: CountModeRepository;
  readonly items: CountItemDirectory;
  readonly now?: () => string;
}

export interface CountZoneProgress {
  readonly totalItems: number;
  readonly countedItems: number;
  readonly recountItems: number;
}

export interface CountViewer {
  readonly userId: string;
  readonly canReview: boolean;
}

export function zoneProgressOf(zone: CountZone, count: PhysicalCount): CountZoneProgress {
  const inZone = new Set(zone.itemIds);
  let countedItems = 0;
  let recountItems = 0;
  for (const line of count.lines) {
    if (!inZone.has(line.itemId)) continue;
    if (line.countedQty !== null) countedItems += 1;
    if (line.recount) recountItems += 1;
  }
  return { totalItems: zone.itemIds.length, countedItems, recountItems };
}

export function isCounterOf(zone: CountZone, userId: string): boolean {
  return zone.counterUserIds.includes(userId);
}

export function revealsLiveVariance(count: PhysicalCount, zones: readonly CountZone[], viewer: CountViewer): boolean {
  if (revealsSystemQty(count)) return true;
  if (!viewer.canReview) return false;
  return !zones.some((zone) => isCounterOf(zone, viewer.userId));
}

export function zoneVarianceOf(zone: CountZone, count: PhysicalCount): PhysicalCountVarianceSummary {
  const inZone = new Set(zone.itemIds);
  return summarizePhysicalCountVariance({ ...count, lines: count.lines.filter((l) => inZone.has(l.itemId)) });
}

export function zoneLineVariances(zone: CountZone, count: PhysicalCount): readonly PhysicalCountLineVariance[] {
  const inZone = new Set(zone.itemIds);
  return count.lines.filter((l) => inZone.has(l.itemId)).map(lineVarianceOf);
}

function activeCountedTotal(scans: readonly CountScan[], itemId: string): Qty | null {
  let total: Qty | null = null;
  for (const scan of scans) {
    if (scan.itemId !== itemId || scan.voidedAt !== null || scan.outcome !== CountScanOutcome.Counted) continue;
    total = (total ?? Qty.zero()).add(scan.qty);
  }
  return total;
}

function scannerIdsOf(scans: readonly CountScan[], zoneId: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const scan of scans) if (scan.zoneId === zoneId && scan.outcome === CountScanOutcome.Counted) ids.add(scan.userId);
  return ids;
}

export class CountModeService implements PhysicalCountCompletionGate {
  constructor(private readonly deps: CountModeServiceDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  private async zoneOf(countId: string, zoneId: string): Promise<CountZone> {
    const zone = await this.deps.repo.findZone(countId, zoneId);
    if (!zone) throw new CountModeRefusalError(CountModeRefusal.ZoneNotFound);
    return zone;
  }

  private async openCount(countId: string): Promise<PhysicalCount> {
    const count = await this.deps.counts.findById(countId);
    if (!count) throw new PhysicalCountNotFoundError(countId);
    if (!count.zoned) throw new CountModeRefusalError(CountModeRefusal.NotACountModeSession);
    return count;
  }

  async assertCompletable(count: PhysicalCount): Promise<void> {
    if (!count.zoned) return;
    const zones = await this.deps.repo.listZones(count.id);
    if (zones.length === 0 || zones.some((z) => z.status !== CountZoneStatus.Approved)) {
      throw new CountModeRefusalError(CountModeRefusal.ZonesNotApproved);
    }
  }

  async start(cmd: StartCountModeCommand): Promise<{ readonly count: PhysicalCount; readonly zones: readonly CountZone[] }> {
    if (cmd.zones.length === 0) throw new CountModeRefusalError(CountModeRefusal.NoZones);
    const owner = new Map<string, number>();
    const resolved: { spec: CountZoneSpec; itemIds: string[]; counters: string[] }[] = [];
    for (const [index, spec] of cmd.zones.entries()) {
      const itemIds =
        spec.kind === CountZoneKind.Category && spec.categoryId
          ? [...(await this.deps.items.itemsInCategory(spec.categoryId))]
          : [...(spec.itemIds ?? [])];
      const unique = [...new Set(itemIds)];
      if (unique.length === 0) throw new CountModeRefusalError(CountModeRefusal.ZoneWithoutItems);
      const counters = [...new Set(spec.counterUserIds)];
      if (counters.length === 0) throw new CountModeRefusalError(CountModeRefusal.ZoneWithoutCounters);
      for (const itemId of unique) {
        if (owner.has(itemId)) throw new CountModeRefusalError(CountModeRefusal.ItemInTwoZones);
        owner.set(itemId, index);
      }
      resolved.push({ spec, itemIds: unique, counters });
    }
    const count = await this.deps.counts.start({
      id: cmd.id,
      warehouseId: cmd.warehouseId,
      date: cmd.date,
      memo: cmd.memo,
      itemIds: [...owner.keys()],
      blind: cmd.blind,
      zoned: true,
    });
    const zones: CountZone[] = resolved.map((entry, index) => ({
      id: cmd.zoneIds[index] ?? `${cmd.id}-Z${index + 1}`,
      countId: cmd.id,
      name: entry.spec.name,
      kind: entry.spec.kind,
      categoryId: entry.spec.kind === CountZoneKind.Category ? (entry.spec.categoryId ?? null) : null,
      itemIds: entry.itemIds,
      counterUserIds: entry.counters,
      status: CountZoneStatus.Open,
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
    }));
    await this.deps.repo.saveZones(zones);
    return { count, zones };
  }

  private resolveQty(item: CountableItem, cmd: CountModeScanCommand): { qty: Qty; entered: Qty | null; unitCode: string | null } {
    const entered = cmd.qty === null ? Qty.fromScaled(1_000_000n) : parseQty(cmd.qty);
    const forbidsZero = cmd.mode === CountScanMode.Add;
    if (entered.isNegative() || (forbidsZero && entered.isZero())) throw new CountModeRefusalError(CountModeRefusal.InvalidQuantity);
    if (cmd.unitCode === null || cmd.unitCode === item.baseUnitCode) return { qty: entered, entered: cmd.qty === null ? null : entered, unitCode: null };
    const unit = item.alternateUnits.find((u) => u.code === cmd.unitCode);
    if (!unit || !Number.isSafeInteger(unit.factor) || unit.factor <= 0) throw new CountModeRefusalError(CountModeRefusal.UnknownUnit);
    return { qty: entered.timesInteger(unit.factor), entered, unitCode: unit.code };
  }

  async scan(cmd: CountModeScanCommand): Promise<CountModeScanResult> {
    const count = await this.openCount(cmd.countId);
    const zone = await this.zoneOf(cmd.countId, cmd.zoneId);
    if (!isCounterOf(zone, cmd.userId)) throw new CountModeRefusalError(CountModeRefusal.CounterNotAssigned);
    if (cmd.clientKey) {
      const earlier = await this.deps.repo.findScanByClientKey(cmd.countId, cmd.clientKey);
      if (earlier && earlier.userId === cmd.userId) {
        const line = earlier.itemId ? (count.lines.find((l) => l.itemId === earlier.itemId) ?? null) : null;
        return { outcome: earlier.outcome, scan: earlier, replayed: true, itemId: earlier.itemId, line, zone };
      }
    }
    if (count.status !== "IN_PROGRESS" || zone.status !== CountZoneStatus.Open) throw new CountModeRefusalError(CountModeRefusal.ZoneNotOpen);

    const item = cmd.itemId ? await this.deps.items.findById(cmd.itemId) : cmd.barcode ? await this.deps.items.findByBarcode(cmd.barcode) : null;
    const at = this.now();
    const base = {
      id: cmd.scanId,
      countId: cmd.countId,
      barcode: cmd.barcode,
      userId: cmd.userId,
      scannedAt: at,
      clientKey: cmd.clientKey,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      note: null,
    } as const;

    const reject = async (outcome: CountScanOutcome, itemId: string | null): Promise<CountModeScanResult> => {
      const scan: CountScan = { ...base, zoneId: zone.id, itemId, outcome, source: CountScanSource.Scan, qty: Qty.zero(), enteredQty: null, unitCode: null };
      await this.deps.repo.appendScan(scan);
      return { outcome, scan, replayed: false, itemId, line: null, zone };
    };
    if (!item) return reject(CountScanOutcome.UnknownBarcode, null);
    if (!zone.itemIds.includes(item.id)) return reject(CountScanOutcome.NotInZone, item.id);

    const { qty, entered, unitCode } = this.resolveQty(item, cmd);
    const source = cmd.mode === CountScanMode.Set ? CountScanSource.KeypadSet : cmd.qty !== null || cmd.unitCode !== null ? CountScanSource.Keypad : CountScanSource.Scan;

    if (cmd.mode === CountScanMode.Set) {
      const earlier = (await this.deps.repo.listScans(cmd.countId, { itemId: item.id })).filter(
        (s) => s.voidedAt === null && s.outcome === CountScanOutcome.Counted,
      );
      if (earlier.length > 0) {
        await this.deps.repo.voidScans(cmd.countId, earlier.map((s) => s.id), cmd.userId, CountScanVoidReason.Replaced, at);
      }
    }
    const scan: CountScan = { ...base, zoneId: zone.id, itemId: item.id, outcome: CountScanOutcome.Counted, source, qty, enteredQty: entered, unitCode };
    await this.deps.repo.appendScan(scan);
    const line = await this.recompute(cmd.countId, item.id);
    return { outcome: CountScanOutcome.Counted, scan, replayed: false, itemId: item.id, line, zone };
  }

  private async recompute(countId: string, itemId: string): Promise<PhysicalCountLine> {
    const scans = await this.deps.repo.listScans(countId, { itemId });
    const total = activeCountedTotal(scans, itemId);
    const current = await this.deps.counts.findById(countId);
    const flagged = current?.lines.find((l) => l.itemId === itemId)?.recount ?? false;
    const count = await this.deps.counts.applyLineCounts(countId, [{ itemId, countedQty: total, recount: total === null ? flagged : false }]);
    return count.lines.find((l) => l.itemId === itemId) as PhysicalCountLine;
  }

  async voidScan(countId: string, scanId: string, userId: string, canReview: boolean): Promise<CountModeScanResult> {
    const count = await this.openCount(countId);
    const scan = await this.deps.repo.findScan(countId, scanId);
    if (!scan || scan.outcome !== CountScanOutcome.Counted || !scan.zoneId || !scan.itemId) throw new CountModeRefusalError(CountModeRefusal.ScanNotFound);
    if (scan.voidedAt !== null) throw new CountModeRefusalError(CountModeRefusal.ScanAlreadyVoided);
    const zone = await this.zoneOf(countId, scan.zoneId);
    if (count.status !== "IN_PROGRESS" || zone.status !== CountZoneStatus.Open) throw new CountModeRefusalError(CountModeRefusal.ZoneNotOpen);
    if (scan.userId !== userId) {
      if (!canReview) throw new CountModeRefusalError(CountModeRefusal.NotYourScan);
      if (isCounterOf(zone, userId)) throw new CountModeRefusalError(CountModeRefusal.SelfReview);
    } else if (!isCounterOf(zone, userId)) {
      throw new CountModeRefusalError(CountModeRefusal.CounterNotAssigned);
    }
    await this.deps.repo.voidScans(countId, [scanId], userId, CountScanVoidReason.Undo, this.now());
    const line = await this.recompute(countId, scan.itemId);
    return { outcome: CountScanOutcome.Counted, scan: { ...scan, voidedAt: this.now(), voidedBy: userId, voidReason: CountScanVoidReason.Undo }, replayed: false, itemId: scan.itemId, line, zone };
  }

  async zeroFill(countId: string, zoneId: string, userId: string, scanIds: readonly string[]): Promise<readonly CountScan[]> {
    const count = await this.openCount(countId);
    const zone = await this.zoneOf(countId, zoneId);
    if (!isCounterOf(zone, userId)) throw new CountModeRefusalError(CountModeRefusal.CounterNotAssigned);
    if (count.status !== "IN_PROGRESS" || zone.status !== CountZoneStatus.Open) throw new CountModeRefusalError(CountModeRefusal.ZoneNotOpen);
    const inZone = new Set(zone.itemIds);
    const pending = count.lines.filter((l) => inZone.has(l.itemId) && l.countedQty === null);
    const at = this.now();
    const written: CountScan[] = [];
    for (const [index, line] of pending.entries()) {
      const scan: CountScan = {
        id: scanIds[index] ?? `${countId}-ZF-${zoneId}-${index + 1}-${at}`,
        countId,
        zoneId,
        itemId: line.itemId,
        barcode: null,
        outcome: CountScanOutcome.Counted,
        source: CountScanSource.ZeroFill,
        qty: Qty.zero(),
        enteredQty: Qty.zero(),
        unitCode: null,
        userId,
        scannedAt: at,
        clientKey: null,
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
        note: null,
      };
      await this.deps.repo.appendScan(scan);
      written.push(scan);
    }
    await this.deps.counts.applyLineCounts(countId, pending.map((l) => ({ itemId: l.itemId, countedQty: Qty.zero(), recount: false })));
    return written;
  }

  async submitZone(countId: string, zoneId: string, userId: string): Promise<CountZone> {
    const count = await this.openCount(countId);
    const zone = await this.zoneOf(countId, zoneId);
    if (!isCounterOf(zone, userId)) throw new CountModeRefusalError(CountModeRefusal.CounterNotAssigned);
    if (count.status !== "IN_PROGRESS" || zone.status !== CountZoneStatus.Open) throw new CountModeRefusalError(CountModeRefusal.ZoneNotOpen);
    const progress = zoneProgressOf(zone, count);
    if (progress.countedItems < progress.totalItems) throw new CountModeRefusalError(CountModeRefusal.ZoneHasUncountedItems);
    const next: CountZone = { ...zone, status: CountZoneStatus.Submitted, submittedAt: this.now(), submittedBy: userId };
    await this.deps.repo.updateZone(next);
    return next;
  }

  private async assertIndependentReviewer(countId: string, zone: CountZone, reviewerId: string): Promise<void> {
    if (isCounterOf(zone, reviewerId)) throw new CountModeRefusalError(CountModeRefusal.SelfReview);
    const scans = await this.deps.repo.listScans(countId, { userId: reviewerId });
    if (scannerIdsOf(scans, zone.id).has(reviewerId)) throw new CountModeRefusalError(CountModeRefusal.SelfReview);
  }

  async flagRecount(countId: string, zoneId: string, itemIds: readonly string[], reviewerId: string, reason: string): Promise<{ readonly zone: CountZone; readonly count: PhysicalCount }> {
    const count = await this.openCount(countId);
    const zone = await this.zoneOf(countId, zoneId);
    if (itemIds.length === 0) throw new CountModeRefusalError(CountModeRefusal.RecountNeedsItems);
    if (reason.trim() === "") throw new CountModeRefusalError(CountModeRefusal.RecountReasonRequired);
    if (count.status !== "IN_PROGRESS" || zone.status === CountZoneStatus.Approved) throw new CountModeRefusalError(CountModeRefusal.ZoneNotOpen);
    if (itemIds.some((id) => !zone.itemIds.includes(id))) throw new CountModeRefusalError(CountModeRefusal.ItemNotInZone);
    await this.assertIndependentReviewer(countId, zone, reviewerId);
    const at = this.now();
    for (const itemId of new Set(itemIds)) {
      const active = (await this.deps.repo.listScans(countId, { itemId })).filter((s) => s.voidedAt === null && s.outcome === CountScanOutcome.Counted);
      if (active.length > 0) await this.deps.repo.voidScans(countId, active.map((s) => s.id), reviewerId, CountScanVoidReason.Recount, at);
    }
    const next = await this.deps.counts.applyLineCounts(countId, [...new Set(itemIds)].map((itemId) => ({ itemId, countedQty: null, recount: true })));
    const reopened: CountZone = { ...zone, status: CountZoneStatus.Open, submittedAt: null, submittedBy: null };
    await this.deps.repo.updateZone(reopened);
    return { zone: reopened, count: next };
  }

  async approveZone(countId: string, zoneId: string, approverId: string): Promise<CountZone> {
    const count = await this.openCount(countId);
    const zone = await this.zoneOf(countId, zoneId);
    if (count.status !== "IN_PROGRESS" || zone.status !== CountZoneStatus.Submitted) throw new CountModeRefusalError(CountModeRefusal.ZoneNotSubmitted);
    await this.assertIndependentReviewer(countId, zone, approverId);
    const next: CountZone = { ...zone, status: CountZoneStatus.Approved, approvedAt: this.now(), approvedBy: approverId };
    await this.deps.repo.updateZone(next);
    return next;
  }

  listZones(countId: string): Promise<readonly CountZone[]> {
    return this.deps.repo.listZones(countId);
  }

  zonesOfCounter(userId: string): Promise<readonly CountZone[]> {
    return this.deps.repo.zonesOfCounter(userId);
  }

  listScans(countId: string, filter?: { readonly zoneId?: string; readonly itemId?: string; readonly userId?: string }): Promise<readonly CountScan[]> {
    return this.deps.repo.listScans(countId, filter);
  }

  async listZonedCounts(filter?: PhysicalCountListFilter): Promise<readonly PhysicalCount[]> {
    return (await this.deps.counts.list(filter)).filter((c) => c.zoned);
  }

  findCount(countId: string): Promise<PhysicalCount | null> {
    return this.deps.counts.findById(countId);
  }

  complete(countId: string): Promise<PhysicalCount> {
    return this.deps.counts.complete(countId);
  }
}

function parseQty(value: string): Qty {
  try {
    return Qty.fromMajor(value);
  } catch {
    throw new CountModeRefusalError(CountModeRefusal.InvalidQuantity);
  }
}
