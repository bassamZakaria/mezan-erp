import { OwnerDigestCadence, type OwnerDigestPeriodDTO } from "@mezan/contracts";
import { cockpitAddDays } from "../reports/cockpit.js";

export const OWNER_DIGEST_WEEK_DAYS = 7;

export function ownerDigestPeriod(cadence: OwnerDigestCadence, endingOn: string): OwnerDigestPeriodDTO {
  const from = cadence === OwnerDigestCadence.Weekly ? cockpitAddDays(endingOn, -(OWNER_DIGEST_WEEK_DAYS - 1)) : endingOn;
  return { cadence, from, to: endingOn, key: `${cadence}:${endingOn}` };
}

export function latestCompleteDay(today: string): string {
  return cockpitAddDays(today, -1);
}

export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function isScheduledDay(cadence: OwnerDigestCadence, sendWeekday: number, today: string): boolean {
  return cadence === OwnerDigestCadence.Daily || weekdayOf(today) === sendWeekday;
}

export function tenantHourOf(iso: string, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return Number(hour);
}
