import { describe, expect, it, vi } from "vitest";
import {
  MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
  MEZAN_BACKUP_REVERT_CHANNEL,
  MEZAN_LICENCE_CHECKIN_CHANNEL,
  MEZAN_LICENCE_IMPORT_CHANNEL,
  MEZAN_SUPPORT_DELETE_CHANNEL,
  MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL,
  MEZAN_SUPPORT_REVEAL_CHANNEL,
  MEZAN_UPDATE_INVOKE_CHANNEL,
} from "../shared/ipc-contract.js";

/**
 * guards N-7 and ticket #7.
 *
 * A client registered four channels and the preload bridge exposes a dozen. An
 * `ipcMain.handle` that was never registered REJECTS — it does not resolve to
 * undefined — so on a till «تحقّق من الترخيص» and «ابحث عن تحديث» rejected with
 * `No handler registered`, in English, and neither caller had a `catch`. The
 * whole experience of pressing them was nothing happening.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      if (handlers.has(channel)) throw new Error(`duplicate handler for ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
}));

const { registerClientMaintenanceRefusalsOverIpc } = await import("./client-refusals.js");

const HOST = "https://192.168.1.7:4173";

describe("what a client machine cannot do, said in Arabic instead of not said at all", () => {
  it("answers every remaining bridged channel, so none of them can reject", async () => {
    handlers.clear();
    registerClientMaintenanceRefusalsOverIpc(HOST);

    for (const channel of [
      MEZAN_LICENCE_CHECKIN_CHANNEL,
      MEZAN_LICENCE_IMPORT_CHANNEL,
      MEZAN_UPDATE_INVOKE_CHANNEL,
      MEZAN_BACKUP_REVERT_CHANNEL,
      MEZAN_BACKUP_EXPORT_PORTABLE_CHANNEL,
      MEZAN_SUPPORT_DIAGNOSTIC_CHANNEL,
      MEZAN_SUPPORT_REVEAL_CHANNEL,
      MEZAN_SUPPORT_DELETE_CHANNEL,
    ]) {
      const handler = handlers.get(channel);
      expect(handler, `${channel} has no handler`).toBeDefined();
      await expect(Promise.resolve(handler!(null))).resolves.toBeDefined();
    }
  });

  it("names the host in each refusal, because the answer is always 'do it there'", () => {
    handlers.clear();
    registerClientMaintenanceRefusalsOverIpc(HOST);

    const checkin = handlers.get(MEZAN_LICENCE_CHECKIN_CHANNEL)!(null) as { messageAr: string };
    expect(checkin.messageAr).toContain(HOST);
    // A failed attempt must not read as a successful one: the day counter has
    // to keep degrading on the host rather than be cleared from a till.
    expect(checkin).toMatchObject({ reachedServer: false, revoked: false });

    const backup = handlers.get(MEZAN_BACKUP_REVERT_CHANNEL)!(null) as { ok: boolean; message: string };
    expect(backup.ok).toBe(false);
    expect(backup.message).toContain(HOST);
  });

  /**
   * A till genuinely cannot update itself — it must stay on the host's version.
   * Reporting that as an ERROR puts a red banner and «تعذّر إكمال التحديث» in
   * front of a shop where nothing went wrong.
   */
  it("calls the update channel unavailable, not failed", () => {
    handlers.clear();
    registerClientMaintenanceRefusalsOverIpc(HOST);

    expect(handlers.get(MEZAN_UPDATE_INVOKE_CHANNEL)!(null)).toMatchObject({
      phase: "unavailable",
    });
  });

  // The client startup registers several of these elsewhere as the product
  // grows, and `ipcMain.handle` throws on a channel that already has one.
  // Clobbering one Arabic refusal with another is harmless; crashing the launch
  // of every till in the shop is not.
  it("does not throw when a channel already has a handler", () => {
    handlers.clear();
    registerClientMaintenanceRefusalsOverIpc(HOST);
    expect(() => registerClientMaintenanceRefusalsOverIpc(HOST)).not.toThrow();
  });
});
