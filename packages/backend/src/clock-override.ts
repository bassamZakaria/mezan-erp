export const FAKE_TODAY_ENV = "MEZAN_FAKE_TODAY";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Shifts the process clock to `MEZAN_FAKE_TODAY` and keeps it ticking: a day
 * starts at noon UTC, an ISO instant with an offset starts exactly there.
 * Never under NODE_ENV=production: real postings would be dated on a day that
 * is not today.
 */
export function installClockOverride(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const value = env[FAKE_TODAY_ENV];
  if (!value) return null;
  if (env["NODE_ENV"] === "production") {
    throw new Error(`${FAKE_TODAY_ENV} is refused under NODE_ENV=production.`);
  }
  const RealDate = globalThis.Date;
  const match = DAY.exec(value);
  const target = match ? RealDate.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : INSTANT.test(value) ? RealDate.parse(value) : NaN;
  if (Number.isNaN(target) || (match && new RealDate(target).toISOString().slice(0, 10) !== value)) {
    throw new Error(`${FAKE_TODAY_ENV} must be a real YYYY-MM-DD day or an ISO instant with an offset, got "${value}".`);
  }
  const offset = target - RealDate.now();
  const now = () => RealDate.now() + offset;

  function ShiftedDate(this: unknown, ...args: unknown[]): Date | string {
    if (!new.target) return new RealDate(now()).toString();
    return args.length === 0 ? new RealDate(now()) : (Reflect.construct(RealDate, args) as Date);
  }
  ShiftedDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(ShiftedDate, RealDate);
  Object.defineProperty(ShiftedDate, "now", { value: now, writable: true, configurable: true });
  globalThis.Date = ShiftedDate as unknown as DateConstructor;
  return value;
}
