import { OwnerHandOverOutcome } from "@mezan/contracts";
import type { AppTranslationKey } from "../i18n";

export const OWNER_HAND_OVER_NOTICE_KEYS: Readonly<Record<OwnerHandOverOutcome, AppTranslationKey | null>> = {
  [OwnerHandOverOutcome.Verified]: null,
  [OwnerHandOverOutcome.Pending]: "users.owner.handOverPending",
  [OwnerHandOverOutcome.PendingUnmailed]: "users.owner.handOverPendingUnmailed",
  [OwnerHandOverOutcome.Failed]: "users.owner.handOverFailed",
};
