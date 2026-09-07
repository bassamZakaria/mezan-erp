import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { rendererEntry } from "./env.js";
import { RENDERER_ENTRY_URL } from "./renderer-protocol.js";
import { isRendererOrigin } from "./window.js";

/**
 * WHO IS ALLOWED TO INVOKE AN IPC CHANNEL (audit S-5).
 *
 * `ipcMain.handle` answers ANY frame in the process — a subframe, a document
 * the renderer was navigated to, a devtools-spawned view. The channels below it
 * are not neutral: `mezan:fetch` is the whole Hono app, and the backup, licence
 * and updater channels carry a SESSION TOKEN in their payload. So a frame that
 * is not the product's own renderer must not reach them.
 *
 * `sandbox: true`, `contextIsolation`, the `app://` scheme with
 * `default-src 'none'` and the navigation lock in window.ts all have to fail
 * before this matters — which is exactly why it is here. It is the check that
 * costs nothing and is the last one standing.
 */

/**
 * Electron's own `ipcMain.handle` signature is `(event, ...args: any[]) => any`.
 * Here it is a GENERIC over the handler's own argument list and return type, so
 * wrapping a handler neither widens its arguments nor collapses them to `never`
 * — each registration keeps the signature it was written with.
 */
type InvokeHandler<A extends readonly unknown[] = readonly never[], R = unknown> = (
  event: IpcMainInvokeEvent,
  ...args: A
) => R;

/**
 * The frame the invoke came from, or null when it is gone.
 *
 * `senderFrame` is null once the frame has been destroyed, and reading `.url`
 * off a destroyed frame THROWS rather than returning a stale value — both of
 * which mean "there is nobody to answer", which is a refusal, not a pass.
 */
function senderUrl(event: IpcMainInvokeEvent): string | null {
  try {
    const frame = event.senderFrame;
    if (!frame) return null;
    const url = frame.url;
    return typeof url === "string" && url !== "" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The renderer entry this build loads, or the packaged one when Electron is not
 * there to ask. Never throws: a guard that crashes on the way to deciding is a
 * channel with no guard on it.
 */
function currentEntryUrl(): string {
  try {
    return rendererEntry().url;
  } catch {
    return RENDERER_ENTRY_URL;
  }
}

/**
 * True when the invoke came from the product's own renderer document.
 *
 * TWO origins are accepted, and only two: `app://mezan`, which is the renderer
 * in every packaged build, and — in a development build only — the Vite dev
 * server that stands in for it. In a packaged build `rendererEntry()` IS
 * `app://mezan`, so the set is one origin there.
 */
export function isTrustedSender(event: IpcMainInvokeEvent, entryUrl: string = currentEntryUrl()): boolean {
  const url = senderUrl(event);
  if (url === null) return false;
  return isRendererOrigin(url, RENDERER_ENTRY_URL) || isRendererOrigin(url, entryUrl);
}

/**
 * Wraps an `ipcMain.handle` handler so a foreign frame is refused before the
 * handler's first line runs.
 *
 * Rejects rather than returning a discriminated failure ON PURPOSE, unlike
 * every other refusal in these modules: those answer a person who did
 * something the product will not do, in Arabic. This one answers a frame that
 * should not exist, and there is no person on the other end to read a sentence.
 */
export function guarded<A extends readonly unknown[], R>(
  channel: string,
  handler: InvokeHandler<A, R>,
): InvokeHandler<A, R> {
  return (event: IpcMainInvokeEvent, ...args: A): R => {
    if (!isTrustedSender(event)) {
      console.error(`[ipc] REFUSED "${channel}" from a frame that is not the Mezan renderer: ${senderUrl(event) ?? "<gone>"}`);
      throw new Error(`Refused: "${channel}" may only be invoked by the Mezan renderer.`);
    }
    return handler(event, ...args);
  };
}

/**
 * `ipcMain.handle` with the sender check already on it.
 *
 * Every registration in this app goes through here rather than through
 * `ipcMain.handle` directly, so "did somebody remember to guard that channel"
 * is answered by grep rather than by reading four files. Swapping one call for
 * the other is also the whole diff at each site, which is what makes the guard
 * cheap enough to apply everywhere.
 */
export function handleGuarded<A extends readonly unknown[], R>(channel: string, handler: InvokeHandler<A, R>): void {
  ipcMain.handle(channel, guarded(channel, handler) as unknown as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
}
