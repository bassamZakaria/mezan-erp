import {
  OwnerDigestCadence,
  OwnerDigestLanguage,
  type OwnerDigestSettingsInputDTO,
  type OwnerDigestThresholdsDTO,
} from "@mezan/contracts";
import { Money } from "../money/index.js";

export const DEFAULT_OWNER_DIGEST_SEND_WEEKDAY = 6;

export const DEFAULT_OWNER_DIGEST_THRESHOLDS: OwnerDigestThresholdsDTO = {
  largeDiscountPercent: 20,
  voidCount: 1,
  belowFloorCount: 1,
  cashVarianceAmount: "100.00",
  overdueAmount: "1.00",
  lowStockItems: 1,
  approvalWaitingHours: 24,
  failedEtaCount: 1,
  backupMaxAgeHours: 48,
};

export function defaultOwnerDigestSettings(): OwnerDigestSettingsInputDTO {
  return {
    scheduleEnabled: false,
    cadence: OwnerDigestCadence.Daily,
    sendWeekday: DEFAULT_OWNER_DIGEST_SEND_WEEKDAY,
    language: OwnerDigestLanguage.Ar,
    recipientUserIds: [],
    thresholds: { ...DEFAULT_OWNER_DIGEST_THRESHOLDS },
  };
}

export class InvalidOwnerDigestSettingsError extends Error {
  readonly code = "OWNER_DIGEST_SETTINGS_INVALID" as const;
  constructor(
    readonly messageAr: string,
    readonly messageEn: string,
  ) {
    super(messageAr);
    this.name = "InvalidOwnerDigestSettingsError";
  }
}

export function assertValidOwnerDigestSettings(settings: OwnerDigestSettingsInputDTO): void {
  if (new Set(settings.recipientUserIds).size !== settings.recipientUserIds.length) {
    throw new InvalidOwnerDigestSettingsError("المستلمون مكرّرون.", "A recipient is listed twice.");
  }
  for (const value of [settings.thresholds.cashVarianceAmount, settings.thresholds.overdueAmount]) {
    if (Money.fromMajor(value).scaled < 0n) {
      throw new InvalidOwnerDigestSettingsError("حدود المبالغ لا تكون سالبة.", "Amount thresholds cannot be negative.");
    }
  }
}
