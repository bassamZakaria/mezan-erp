import type { VanTripStatus } from "./van-trip.js";

/** Raised when an operation references a van-trip id that does not exist. */
export class VanTripNotFoundError extends Error {
  readonly code = "VAN_TRIP_NOT_FOUND";
  constructor(readonly tripId: string) {
    super(`Van trip "${tripId}" was not found.`);
    this.name = "VanTripNotFoundError";
  }
}

/** Raised when an open-van-trip command fails validation (e.g. empty crew). */
export class InvalidVanTripError extends Error {
  readonly code = "INVALID_VAN_TRIP";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidVanTripError";
  }
}

/** Raised when recording a cash movement or settling a trip that is not currently "ongoing". */
export class VanTripNotOngoingError extends Error {
  readonly code = "VAN_TRIP_NOT_ONGOING";
  constructor(
    readonly tripId: string,
    readonly currentStatus: VanTripStatus,
  ) {
    super(`Van trip "${tripId}" is not ongoing (current status: "${currentStatus}").`);
    this.name = "VanTripNotOngoingError";
  }
}

/** Raised when a van trip's source warehouse and van warehouse are the same. */
export class SameWarehouseVanTripError extends Error {
  readonly code = "SAME_WAREHOUSE_VAN_TRIP";
  constructor(readonly warehouseId: string) {
    super(`A van trip's source and van warehouse must differ ("${warehouseId}").`);
    this.name = "SameWarehouseVanTripError";
  }
}
