import { installClockOverride } from "../../packages/backend/src/clock-override.js";

const day = installClockOverride();
if (day) console.log(`clock     today is ${day} (MEZAN_FAKE_TODAY)`);
