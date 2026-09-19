import { installClockOverride } from "@mezan/backend/clock-override";

const day = installClockOverride();
if (day) console.log(`[mezan] clock: today is ${day} (MEZAN_FAKE_TODAY)`);
