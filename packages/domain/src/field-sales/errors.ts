import { getVanTripStatusLabel, type VanTripStatus } from "./van-trip.js";

/** Raised when an operation references a van-trip id that does not exist. */
export class VanTripNotFoundError extends Error {
  readonly code = "VAN_TRIP_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly tripId: string) {
    super(`رحلة التوزيع "${tripId}" غير موجودة.`);
    this.messageEn = `Van trip "${tripId}" was not found.`;
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
  readonly messageEn: string;
  constructor(
    readonly tripId: string,
    readonly currentStatus: VanTripStatus,
  ) {
    super(`رحلة التوزيع "${tripId}" ليست جارية (حالتها الحالية: «${getVanTripStatusLabel(currentStatus)}»).`);
    this.messageEn = `Van trip "${tripId}" is not ongoing (current status: "${currentStatus}").`;
    this.name = "VanTripNotOngoingError";
  }
}

/** Raised when a van trip's source warehouse and van warehouse are the same. */
export class SameWarehouseVanTripError extends Error {
  readonly code = "SAME_WAREHOUSE_VAN_TRIP";
  readonly messageEn: string;
  constructor(readonly warehouseId: string) {
    super(`لا بد أن يختلف مستودع المصدر عن مستودع السيارة في رحلة التوزيع ("${warehouseId}").`);
    this.messageEn = `A van trip's source and van warehouse must differ ("${warehouseId}").`;
    this.name = "SameWarehouseVanTripError";
  }
}

export class VanTripNotAwaitingApprovalError extends Error {
  readonly code = "VAN_TRIP_NOT_AWAITING_APPROVAL";
  readonly messageEn: string;
  constructor(
    readonly tripId: string,
    readonly currentStatus: VanTripStatus,
  ) {
    super(`رحلة التوزيع "${tripId}" ليست بانتظار اعتماد التسوية (حالتها الحالية: «${getVanTripStatusLabel(currentStatus)}»).`);
    this.messageEn = `Van trip "${tripId}" is not awaiting settlement approval (current status: "${currentStatus}").`;
    this.name = "VanTripNotAwaitingApprovalError";
  }
}

export class VanTripSelfApprovalError extends Error {
  readonly code = "VAN_TRIP_SELF_APPROVAL";
  readonly messageEn: string;
  constructor(readonly tripId: string) {
    super("لا يعتمد تسوية الرحلة من أدخلها — يلزم مستخدم آخر للاعتماد.");
    this.messageEn = `The user who entered van trip "${tripId}"'s settlement cannot approve it; another user must.`;
    this.name = "VanTripSelfApprovalError";
  }
}

export class VanTripExpectationChangedError extends Error {
  readonly code = "VAN_TRIP_EXPECTATION_CHANGED";
  readonly messageEn: string;
  constructor(readonly tripId: string) {
    super("تغيّر رصيد المركبة من البضاعة أو النقدية منذ إدخال التسوية — أعد إدخال الجرد قبل الاعتماد.");
    this.messageEn = `Van trip "${tripId}"'s stock or cash on the books changed since the settlement was entered; enter the count again before approving.`;
    this.name = "VanTripExpectationChangedError";
  }
}

export class VanTripRecountLockedError extends Error {
  readonly code = "VAN_TRIP_RECOUNT_LOCKED";
  readonly messageEn: string;
  constructor(readonly tripId: string) {
    super("بدأ ترحيل اعتماد هذه التسوية، فلا يمكن إعادة الجرد — أكمل الاعتماد.");
    this.messageEn = `Posting of van trip "${tripId}"'s approved settlement has started, so it cannot be recounted; finish the approval.`;
    this.name = "VanTripRecountLockedError";
  }
}

export class VanBusyError extends Error {
  readonly code = "VAN_BUSY";
  readonly messageEn: string;
  constructor(
    readonly vanWarehouseId: string,
    readonly openTripId: string,
  ) {
    super(`مستودع المركبة عليه رحلة لم تُعتمد تسويتها بعد ("${openTripId}") — اعتمد تسويتها قبل فتح رحلة جديدة.`);
    this.messageEn = `The van's warehouse still carries trip "${openTripId}", whose settlement is not approved; approve it before opening a new trip.`;
    this.name = "VanBusyError";
  }
}

export class VanReconciliationDocumentMismatchError extends Error {
  readonly code = "VAN_RECONCILIATION_DOCUMENT_MISMATCH";
  readonly messageEn: string;
  constructor(readonly documentId: string) {
    super(`المستند "${documentId}" موجود بمحتوى لا يطابق تسوية الرحلة — راجعه قبل الاعتماد.`);
    this.messageEn = `Document "${documentId}" already exists with content that does not match the trip's settlement; review it before approving.`;
    this.name = "VanReconciliationDocumentMismatchError";
  }
}

export class InvalidVanTripCountError extends Error {
  readonly code = "INVALID_VAN_TRIP_COUNT";
  readonly messageEn: string;
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.messageEn = "The settlement count is invalid: counted quantities and cash cannot be negative, and an item is counted once.";
    this.name = "InvalidVanTripCountError";
  }
}
