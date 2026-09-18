import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

/**
 * guards S-5 — no `ipcMain.handle` validated `event.senderFrame`, on channels
 * that carry the whole Hono app and a live session token.
 *
 * `env.ts` reads `app.isPackaged`, so electron is mocked at the boundary; a
 * packaged build serves the renderer from `app://mezan`, which is the origin
 * the guard has to pin.
 */
vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));

const { guarded, isTrustedSender } = await import("./ipc-guard.js");

function eventFrom(url: string | null | "throws"): IpcMainInvokeEvent {
  if (url === "throws") {
    return {
      get senderFrame(): never {
        throw new Error("Frame was disposed");
      },
    } as unknown as IpcMainInvokeEvent;
  }
  return { senderFrame: url === null ? null : { url } } as unknown as IpcMainInvokeEvent;
}

describe("isTrustedSender", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("accepts the product's own renderer document", () => {
    expect(isTrustedSender(eventFrom("app://mezan/index.html"))).toBe(true);
    expect(isTrustedSender(eventFrom("app://mezan/sell/invoices"))).toBe(true);
  });

  it("refuses another host on the same privileged scheme", () => {
    // `new URL("app://…").origin` serialises to the string "null", so an origin
    // comparison would have accepted this — the same hole D128 closed on the
    // navigation guard.
    expect(isTrustedSender(eventFrom("app://attacker.example/x"))).toBe(false);
  });

  it("refuses file://, data:, javascript: and any remote origin", () => {
    for (const url of [
      "file:///etc/passwd",
      "data:text/html,<script>1</script>",
      "javascript:alert(1)",
      "https://example.test/x",
      "http://localhost:5173/",
    ]) {
      expect(isTrustedSender(eventFrom(url)), url).toBe(false);
    }
  });

  it("refuses a frame that is gone, rather than reading a stale URL", () => {
    expect(isTrustedSender(eventFrom(null))).toBe(false);
    expect(isTrustedSender(eventFrom("throws"))).toBe(false);
    expect(isTrustedSender(eventFrom(""))).toBe(false);
  });
});

describe("guarded", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs the handler for the renderer, with its arguments intact", async () => {
    const handler = vi.fn(async (_event: IpcMainInvokeEvent, token: string) => `ok:${token}`);
    const wrapped = guarded("mezan:backup:list", handler);
    await expect(wrapped(eventFrom("app://mezan/index.html"), "session-token")).resolves.toBe("ok:session-token");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refuses a foreign frame WITHOUT running the handler", async () => {
    const handler = vi.fn();
    const wrapped = guarded("mezan:backup:restore", handler);
    expect(() => wrapped(eventFrom("https://example.test/x"))).toThrow(/may only be invoked by the Mezan renderer/);
    expect(handler).not.toHaveBeenCalled();
  });

  /**
   * The wrapper is generic over the handler's OWN argument list and return
   * type. When it was not, every argument collapsed to `never` and a handler
   * with a real payload could not be registered without a cast.
   */
  it("keeps the handler's own signature, arguments and return type alike", async () => {
    const wrapped = guarded(
      "mezan:fetch",
      async (_event: IpcMainInvokeEvent, url: string, retries: number): Promise<{ url: string; retries: number }> => ({
        url,
        retries,
      }),
    );
    const result: { url: string; retries: number } = await wrapped(eventFrom("app://mezan/index.html"), "/health", 2);
    expect(result).toEqual({ url: "/health", retries: 2 });
  });
});
