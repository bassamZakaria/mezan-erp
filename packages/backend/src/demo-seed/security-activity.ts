import type { App } from "@mezan/api";
import { DEFAULT_TIME_ZONE, recordSecurityEvent, type AuditSink } from "@mezan/domain";
import { SEED_TREASURY_CASHIER_EMAIL } from "./access.js";
import { seedToday, step } from "./shared.js";

/**
 * نشاط خارج أوقات العمل — a night the treasury cashier worked late.
 *
 * `/security-reports/after-hours` reads the audit trail and keeps only the
 * events whose TENANT-LOCAL timestamp falls outside 08:00–16:00 or on a weekend
 * (packages/api/src/security-reports-routes.ts). Every other row in a seeded
 * tenant is stamped by the seed's own work, i.e. at whatever the wall clock
 * said when the seed ran — so the surface was full when the seed ran in the
 * evening and EMPTY when it ran at midday, and `pnpm check:seed` passed or
 * failed on the hour of the day rather than on anything about the seed (D311).
 *
 * These two events fix the hour instead of inheriting it: the same tenant-local
 * 23:3x on the seed's own day, every run. The day has to be the seed's own —
 * the report defaults to `firstOfMonth(today) … today`, so an August literal
 * would be outside the default window from September onwards and would bring
 * the emptiness straight back.
 */
enum NightShiftAction {
  LoginFailed = "LOGIN_FAILED",
  LoginSucceeded = "LOGIN_SUCCEEDED",
}

const AUTH_ENTITY_TYPE = "AUTH_USER";

/** The shape `auth-routes.ts` writes, so these rows read as the login events they describe. */
const NIGHT_SHIFT = [
  { at: { hour: 23, minute: 34 }, action: NightShiftAction.LoginFailed, severity: "WARNING" },
  { at: { hour: 23, minute: 36 }, action: NightShiftAction.LoginSucceeded, severity: "INFO" },
] as const;

interface SeededUser {
  readonly id: string;
  readonly email: string;
}

/**
 * The UTC instant whose tenant-local wall clock is `day` at `hour:minute`.
 *
 * The offset is read back from the zone itself rather than hard-coded: Cairo
 * keeps DST, so a fixed +02:00 would place these rows an hour off for half the
 * year — enough to move a 23:3x event across midnight into the next day, which
 * is the one thing this fixture must never do.
 */
function tenantInstant(day: string, hour: number, minute: number): string {
  const wall = Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  const parts = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(wall))
      .map((part) => [part.type, part.value]),
  );
  const shown = Date.parse(
    `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}.000Z`,
  );
  return new Date(wall - (shown - wall)).toISOString();
}

export async function seedAfterHoursActivity(app: App, audit: AuditSink): Promise<void> {
  const users = (await step(app, "GET", "/users")) as readonly SeededUser[];
  const cashier = users.find((user) => user.email === SEED_TREASURY_CASHIER_EMAIL);
  if (!cashier) {
    throw new Error(
      `[demo-seed] no user ${SEED_TREASURY_CASHIER_EMAIL} to attribute the after-hours activity to; /security-reports/after-hours would be empty at midday again.`,
    );
  }

  const day = seedToday();
  for (const event of NIGHT_SHIFT) {
    await recordSecurityEvent(audit, {
      module: "auth",
      entityType: AUTH_ENTITY_TYPE,
      entityId: cashier.id,
      action: event.action,
      actor: cashier.id,
      severity: event.severity,
      timestamp: tenantInstant(day, event.at.hour, event.at.minute),
      details: { userId: cashier.id, username: cashier.email, origin: "host" },
    });
  }
}
