import { ipcMain } from "electron";
import { MEZAN_FETCH_CHANNEL, type IpcFetchResponse } from "../shared/ipc-contract.js";

/**
 * What answers the renderer while the launch-time pre-update backup runs.
 *
 * The window is now created BEFORE that backup so the machine is not a dock
 * icon for minutes (see main/index.ts), which means the renderer boots and
 * starts asking for data before the backend exists. An unregistered
 * `ipcMain.handle` channel does not degrade to "no data" — it rejects, and the
 * renderer prints `Error invoking remote method 'mezan:fetch': No handler
 * registered`, an English Electron internal on an Arabic screen. So the channel
 * exists from the first moment and answers 503 with a sentence that says what
 * the machine is doing.
 *
 * ORDERING: `unregisterStartupBusy` MUST run before `registerHonoOverIpc`.
 * Electron throws on a second handler for the same channel.
 */
const BUSY_BODY = JSON.stringify({
  error: "STARTUP_BUSY",
  message:
    "جارٍ أخذ نسخة احتياطية من قاعدة البيانات قبل تحديثها. لا تغلق البرنامج — ستفتح الشاشة تلقائياً عند الانتهاء.",
});

export function registerStartupBusy(): void {
  ipcMain.handle(
    MEZAN_FETCH_CHANNEL,
    (): IpcFetchResponse => ({
      status: 503,
      headers: { "content-type": "application/json; charset=UTF-8", "retry-after": "5" },
      body: BUSY_BODY,
    }),
  );
}

export function unregisterStartupBusy(): void {
  ipcMain.removeHandler(MEZAN_FETCH_CHANNEL);
}
