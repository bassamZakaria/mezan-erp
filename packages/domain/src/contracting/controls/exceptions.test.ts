import { describe, it, expect } from "vitest";
import { Money, Qty } from "../../money/index.js";
import {
  exceedsVarianceThreshold,
  findBoqOverruns,
  findConsumptionVariances,
  findEarlyRetentionReleases,
  findCostOverrunsVsEstimate,
  findEquipmentWithoutCertificate,
  findLateVariationApprovals,
  findUnreceivedIssues,
  monthsBetweenDates,
  multiplyQty,
  variancePercentOf,
  type BoqOverrunCandidate,
  type ConsumptionVarianceCandidate,
  type CostOverrunCandidate,
  type EarlyReleaseCandidate,
  type EquipmentExceptionCandidate,
  type LateVariationCandidate,
  type UnreceivedCandidate,
} from "./exceptions.js";

const q = (v: string) => Qty.fromMajor(v);
const m = (v: string) => Money.fromMajor(v);

function overrun(over: Partial<BoqOverrunCandidate> = {}): BoqOverrunCandidate {
  return {
    contractId: "CTR-1",
    contractDocNo: "CTR-0001",
    projectId: "PRJ-1",
    boqLineId: "B1",
    code: "1",
    descriptionAr: "الحفر",
    unitLabelAr: "م٣",
    certificateId: "MST-1",
    certificateDocNo: "MST-000001",
    executionDate: "2026-08-31",
    cumulativeQty: q("100"),
    contractedQty: q("100"),
    ...over,
  };
}

describe("تجاوز الكميات التعاقدية", () => {
  it("does not fire when the cumulative equals the contracted quantity", () => {
    expect(findBoqOverruns([overrun()])).toEqual([]);
  });

  it("fires with the excess when the cumulative passes the contracted quantity", () => {
    const rows = findBoqOverruns([overrun({ cumulativeQty: q("120"), contractedQty: q("100") })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.excessQty.toString()).toBe("20.000000");
  });

  it("does not fire when the certificate stayed under the bill", () => {
    expect(findBoqOverruns([overrun({ cumulativeQty: q("80") })])).toEqual([]);
  });
});

describe("مواد مصروفة لم تُستلم بالموقع", () => {
  const row = (over: Partial<UnreceivedCandidate> = {}): UnreceivedCandidate => ({
    issueId: "ISS-1",
    docNo: "ISS-000001",
    date: "2026-08-23",
    projectId: "PRJ-1",
    itemId: "ITEM-1",
    qtyIssued: q("30"),
    qtyReceived: q("24"),
    qtyOutstanding: q("6"),
    ageDays: 10,
    ...over,
  });

  it("fires on a shortfall older than the threshold", () => {
    expect(findUnreceivedIssues([row()], 7)).toHaveLength(1);
  });

  it("stays silent while the issue is younger than the threshold", () => {
    expect(findUnreceivedIssues([row({ ageDays: 3 })], 7)).toEqual([]);
  });

  it("stays silent when the site signed for everything", () => {
    expect(findUnreceivedIssues([row({ qtyOutstanding: q("0") })], 7)).toEqual([]);
  });
});

describe("انحراف الاستهلاك عن الكميات النظرية", () => {
  const row = (over: Partial<ConsumptionVarianceCandidate> = {}): ConsumptionVarianceCandidate => ({
    contractId: "CTR-1",
    contractDocNo: "CTR-0001",
    projectId: "PRJ-1",
    boqLineId: "B2",
    code: "2",
    descriptionAr: "الخرسانة العادية",
    itemId: "ITEM-1",
    theoreticalQtyPerUnit: q("7"),
    certifiedCumulativeQty: q("100"),
    consumedQty: q("700"),
    consumedCost: m("1000"),
    ...over,
  });

  it("multiplies the certified quantity by the per-unit rate", () => {
    expect(multiplyQty(q("100"), q("7")).toString()).toBe("700.000000");
    expect(multiplyQty(q("1.5"), q("2.25")).toString()).toBe("3.375000");
  });

  it("does not fire when consumption matches the theoretical quantity", () => {
    expect(findConsumptionVariances([row()], "10")).toEqual([]);
  });

  it("does not fire at exactly the threshold", () => {
    expect(findConsumptionVariances([row({ consumedQty: q("770") })], "10")).toEqual([]);
  });

  it("fires past the threshold, in either direction, with an exact percentage", () => {
    const over = findConsumptionVariances([row({ consumedQty: q("840") })], "10");
    expect(over).toHaveLength(1);
    expect(over[0]?.theoreticalQty.toString()).toBe("700.000000");
    expect(over[0]?.variancePercent).toBe("20.0");
    const under = findConsumptionVariances([row({ consumedQty: q("560") })], "10");
    expect(under[0]?.variancePercent).toBe("-20.0");
  });

  it("fires on consumption against nothing certified, and reports no percentage for it", () => {
    const rows = findConsumptionVariances([row({ certifiedCumulativeQty: q("0"), consumedQty: q("25") })], "10");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variancePercent).toBeNull();
  });

  it("keeps the percentage exact to one place", () => {
    expect(variancePercentOf(q("1055"), q("1000"))).toBe("5.5");
    expect(variancePercentOf(q("1000"), q("0"))).toBeNull();
    expect(exceedsVarianceThreshold(q("0"), q("0"), "10")).toBe(false);
  });
});

describe("ساعات معدات بلا مستخلص مقابل", () => {
  const row = (over: Partial<EquipmentExceptionCandidate> = {}): EquipmentExceptionCandidate => ({
    contractId: "CTR-1",
    contractDocNo: "CTR-0001",
    contractStatus: "active",
    projectId: "PRJ-1",
    equipmentLogId: "EQL-1",
    docNo: "EQL-000001",
    assetId: "ASSET-1",
    date: "2026-08-27",
    hours: q("62"),
    amount: m("27900"),
    boqLineId: "B1",
    code: "1",
    descriptionAr: "الحفر",
    certifiedCumulativeAtLog: q("4000"),
    certifiedCumulativeNow: q("4000"),
    ageDays: 17,
    ...over,
  });

  it("fires when the line's certified quantity has not moved since the hours were logged", () => {
    const rows = findEquipmentWithoutCertificate([row()], 30);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("not_certified_since");
  });

  it("stays silent once the line was certified further", () => {
    expect(findEquipmentWithoutCertificate([row({ certifiedCumulativeNow: q("5200") })], 30)).toEqual([]);
  });

  it("fires on hours with no BOQ line at all on an old, live contract", () => {
    const rows = findEquipmentWithoutCertificate([row({ boqLineId: null, code: null, ageDays: 45 })], 30);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("no_boq_line");
  });

  it("gives unallocated hours the grace period before flagging them", () => {
    expect(findEquipmentWithoutCertificate([row({ boqLineId: null, ageDays: 12 })], 30)).toEqual([]);
  });

  it("leaves unallocated hours on a finished contract alone", () => {
    expect(
      findEquipmentWithoutCertificate([row({ boqLineId: null, ageDays: 90, contractStatus: "completed" })], 30),
    ).toEqual([]);
  });
});

describe("أوامر تغيير معتمدة بعد التنفيذ", () => {
  const row = (over: Partial<LateVariationCandidate> = {}): LateVariationCandidate => ({
    contractId: "CTR-1",
    contractDocNo: "CTR-0001",
    projectId: "PRJ-1",
    variationOrderId: "VO-1",
    variationDocNo: "VO-000001",
    variationTitleAr: "زيادة كميات الحفر",
    approvedAt: "2026-08-02",
    boqLineId: "B1",
    code: "1",
    descriptionAr: "الحفر",
    certificateId: "MST-3",
    certificateDocNo: "MST-000003",
    executionDate: "2026-07-31",
    cumulativeQty: q("12400"),
    contractedQtyAtExecution: q("12000"),
    ...over,
  });

  it("fires when the certificate leaned on quantity the order only added later", () => {
    const rows = findLateVariationApprovals([row()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reliedOnQty.toString()).toBe("400.000000");
  });

  it("stays silent when the order was approved before the work was executed", () => {
    expect(findLateVariationApprovals([row({ approvedAt: "2026-07-01" })])).toEqual([]);
  });

  it("stays silent when the certificate never used the added quantity", () => {
    expect(findLateVariationApprovals([row({ cumulativeQty: q("4000") })])).toEqual([]);
  });
});

describe("ضمان محتجز مفرج عنه قبل الميعاد", () => {
  const row = (over: Partial<EarlyReleaseCandidate> = {}): EarlyReleaseCandidate => ({
    releaseId: "RET-1",
    docNo: "RET-000001",
    party: "customer",
    counterpartyNameAr: null,
    contractId: "CTR-1",
    contractDocNo: "CTR-0001",
    projectId: "PRJ-1",
    kind: "provisional",
    date: "2026-09-01",
    amount: m("5000"),
    releaseEventDate: "2027-03-31",
    status: "released",
    ...over,
  });

  it("fires with the days it was early", () => {
    const rows = findEarlyRetentionReleases([row()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.daysEarly).toBe(211);
  });

  it("stays silent on a release made on or after its event", () => {
    expect(findEarlyRetentionReleases([row({ date: "2027-03-31" })])).toEqual([]);
    expect(findEarlyRetentionReleases([row({ date: "2027-06-30" })])).toEqual([]);
  });

  it("ignores a draft — nothing has been released yet", () => {
    expect(findEarlyRetentionReleases([row({ status: "draft" })])).toEqual([]);
  });

  it("ignores a release whose event date the contract never recorded", () => {
    expect(findEarlyRetentionReleases([row({ releaseEventDate: null })])).toEqual([]);
  });

  it("fires on a SUBCONTRACTOR release too — the payable side is the half the contractor controls", () => {
    const rows = findEarlyRetentionReleases([
      row({
        releaseId: "SUB-1-RET-1",
        party: "subcontractor",
        counterpartyNameAr: "مقاول الحفر",
        kind: "final",
        date: "2027-01-01",
        releaseEventDate: "2027-06-30",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.party).toBe("subcontractor");
    expect(rows[0]?.counterpartyNameAr).toBe("مقاول الحفر");
    expect(rows[0]?.daysEarly).toBe(180);
  });
});

describe("تجاوز التكلفة للتقدير", () => {
  function candidate(over: Partial<CostOverrunCandidate> = {}): CostOverrunCandidate {
    return {
      contractId: "CTR-1",
      contractDocNo: "CTR-0001",
      contractTitleAr: "عقد إنشاء برج الأمل",
      projectId: "PRJ-1",
      status: "active",
      costToDate: m("500000"),
      estimatedTotalCost: m("4000000"),
      certifiedGrossWorks: m("1000000"),
      contractValue: m("5000000"),
      lastEstimateRevisionDate: "2026-08-01",
      monthsSinceEstimateRevision: 1,
      ...over,
    };
  }

  it("stays silent while the cost tracks what the certified work has earned", () => {
    // 20% certified × 4,000,000 = 800,000 expected; 800,000 spent is dead on.
    expect(findCostOverrunsVsEstimate([candidate({ costToDate: m("800000") })], "10", 6)).toEqual([]);
  });

  it("tolerates the threshold and fires one piastre past it", () => {
    const atThreshold = findCostOverrunsVsEstimate([candidate({ costToDate: m("880000") })], "10", 6);
    expect(atThreshold).toEqual([]);
    const past = findCostOverrunsVsEstimate([candidate({ costToDate: m("880000.01") })], "10", 6);
    expect(past).toHaveLength(1);
    expect(past[0]?.costOverrun).toBe(true);
    expect(past[0]?.estimateStale).toBe(false);
    expect(past[0]?.expectedCostToDate.toString()).toBe("800000.000000");
    expect(past[0]?.excessCost.toString()).toBe("80000.010000");
  });

  it("fires on an estimate nobody has revised, whatever the cost is doing", () => {
    const rows = findCostOverrunsVsEstimate(
      [candidate({ costToDate: m("800000"), monthsSinceEstimateRevision: 6 })],
      "10",
      6,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costOverrun).toBe(false);
    expect(rows[0]?.estimateStale).toBe(true);
  });

  it("cannot fire on cost alone before anything has been certified", () => {
    // No certified work means no earned cost to compare against — reporting an
    // "overrun" there would fire on every contract in its first month.
    expect(
      findCostOverrunsVsEstimate([candidate({ certifiedGrossWorks: m("0"), costToDate: m("900000") })], "10", 6),
    ).toEqual([]);
  });

  it("counts whole months, so the day of the month decides the boundary", () => {
    expect(monthsBetweenDates("2026-03-15", "2026-09-14")).toBe(5);
    expect(monthsBetweenDates("2026-03-15", "2026-09-15")).toBe(6);
  });
});

describe("مواد مصروفة لم تُستلم بالموقع — الاستلام قبل الصرف", () => {
  it("reports a receipt dated before its issue however old it is and whatever it left outstanding", () => {
    const row: UnreceivedCandidate = {
      issueId: "ISS-1",
      docNo: "ISS-000001",
      date: "2026-08-20",
      projectId: "PRJ-1",
      itemId: "ITM-1",
      qtyIssued: q("30"),
      qtyReceived: q("30"),
      qtyOutstanding: q("0"),
      ageDays: 0,
      kind: "received_before_issue",
    };
    expect(findUnreceivedIssues([row], 7)).toEqual([row]);
  });
});
