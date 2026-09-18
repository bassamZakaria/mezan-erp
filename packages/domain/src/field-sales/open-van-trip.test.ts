import { describe, it, expect, vi } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createInMemoryVanTripRepository } from "./test-helpers/in-memory-van-trip-repository.js";
import { openVanTrip, type OpenVanTripDeps, type TreasuryTransferInput } from "./open-van-trip.js";
import { InvalidVanTripError, SameWarehouseVanTripError } from "./errors.js";

function baseCmd() {
  return {
    id: "trip1",
    date: "2026-08-01",
    branchId: "branch1",
    vanWarehouseId: "wh-van",
    vanTreasuryAccountId: "treasury-van",
    sourceWarehouseId: "wh-main",
    sourceTreasuryAccountId: "treasury-main",
    crew: [{ employeeId: "emp1", role: "driver" as const }],
  };
}

describe("openVanTrip", () => {
  it("posts a stock transfer for loaded stock and opens the trip as ongoing", async () => {
    const trips = createInMemoryVanTripRepository();
    const postTransfer = vi.fn().mockResolvedValue(undefined);
    const deps: OpenVanTripDeps = { trips, stock: { postTransfer } };

    const trip = await openVanTrip(
      {
        ...baseCmd(),
        loadedStock: [{ itemId: "item1", qty: Qty.fromMajor("10") }],
      },
      deps,
    );

    expect(postTransfer).toHaveBeenCalledWith({
      transferId: "trip1",
      fromWarehouseId: "wh-main",
      toWarehouseId: "wh-van",
      lines: [{ itemId: "item1", qty: Qty.fromMajor("10") }],
    });
    expect(trip.status).toBe("ongoing");
    expect(await trips.findById("trip1")).toEqual(trip);
  });

  it("books a treasury transfer for a positive opening cash float", async () => {
    const trips = createInMemoryVanTripRepository();
    const postTransfer = vi.fn().mockResolvedValue(undefined);
    const treasuryTransfer = vi.fn<(input: TreasuryTransferInput) => Promise<void>>().mockResolvedValue(undefined);
    const deps: OpenVanTripDeps = { trips, stock: { postTransfer }, treasuryTransfer };

    await openVanTrip(
      {
        ...baseCmd(),
        openingCashFloat: Money.fromMajor("500"),
      },
      deps,
    );

    expect(treasuryTransfer).toHaveBeenCalledWith({
      id: "trip1",
      date: "2026-08-01",
      amount: Money.fromMajor("500"),
      branchId: "branch1",
      fromTreasuryAccountId: "treasury-main",
      toTreasuryAccountId: "treasury-van",
    });
  });

  it("skips the treasury transfer when no treasuryTransfer dep is provided", async () => {
    const trips = createInMemoryVanTripRepository();
    const postTransfer = vi.fn().mockResolvedValue(undefined);
    const deps: OpenVanTripDeps = { trips, stock: { postTransfer } };

    const trip = await openVanTrip({ ...baseCmd(), openingCashFloat: Money.fromMajor("500") }, deps);

    expect(trip.openingCashFloat.equals(Money.fromMajor("500"))).toBe(true);
  });

  it("throws when the source and van warehouse are the same", async () => {
    const trips = createInMemoryVanTripRepository();
    const postTransfer = vi.fn().mockResolvedValue(undefined);
    const deps: OpenVanTripDeps = { trips, stock: { postTransfer } };

    await expect(
      openVanTrip({ ...baseCmd(), vanWarehouseId: "wh-main" }, deps),
    ).rejects.toThrow(SameWarehouseVanTripError);
  });

  it("throws when the crew is empty", async () => {
    const trips = createInMemoryVanTripRepository();
    const postTransfer = vi.fn().mockResolvedValue(undefined);
    const deps: OpenVanTripDeps = { trips, stock: { postTransfer } };

    await expect(openVanTrip({ ...baseCmd(), crew: [] }, deps)).rejects.toThrow(InvalidVanTripError);
  });

  /**
   * Regression guard (D: a trip opened through the UI never got a number —
   * `cmd.tripNo ?? null` had no fallback). The UI never sends `tripNo`, so
   * the VAN_TRIP sequence must be consulted whenever the command omits one.
   */
  it("allocates a trip number from the numbering sequence when the command omits one", async () => {
    const trips = createInMemoryVanTripRepository();
    const postTransfer = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn().mockResolvedValue({ value: 3, formatted: "TRIP-0003" });
    const deps: OpenVanTripDeps = { trips, stock: { postTransfer }, numbering: { next } };

    const trip = await openVanTrip(baseCmd(), deps);

    expect(next).toHaveBeenCalledWith({ branchId: "branch1" });
    expect(trip.tripNo).toBe("TRIP-0003");
  });

  it("keeps an explicit tripNo and never consults the numbering sequence", async () => {
    const trips = createInMemoryVanTripRepository();
    const postTransfer = vi.fn().mockResolvedValue(undefined);
    const next = vi.fn().mockResolvedValue({ value: 3, formatted: "TRIP-0003" });
    const deps: OpenVanTripDeps = { trips, stock: { postTransfer }, numbering: { next } };

    const trip = await openVanTrip({ ...baseCmd(), tripNo: "TRIP-CUSTOM-1" }, deps);

    expect(next).not.toHaveBeenCalled();
    expect(trip.tripNo).toBe("TRIP-CUSTOM-1");
  });

  it("opens with no trip number when no numbering dep is wired and none is supplied", async () => {
    const trips = createInMemoryVanTripRepository();
    const postTransfer = vi.fn().mockResolvedValue(undefined);
    const deps: OpenVanTripDeps = { trips, stock: { postTransfer } };

    const trip = await openVanTrip(baseCmd(), deps);

    expect(trip.tripNo).toBeNull();
  });
});
