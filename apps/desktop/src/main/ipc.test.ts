import { describe, expect, it, vi } from "vitest";
import type { App } from "@mezan/api";
import { MEZAN_FETCH_CHANNEL, MEZAN_SAVE_PDF_CHANNEL, type IpcFetchResponse } from "../shared/ipc-contract.js";
import { LanClientError, MAX_RESPONSE_BYTES } from "./lan-client.js";

/**
 * guards N-3 and ticket #4 — THE ONE SENTENCE FIVE FAULTS SHARED.
 *
 * Every LAN failure reached the shop as
 * «تعذّر الوصول إلى الجهاز الرئيسي. Could not reach the main machine. No answer
 * from https://192.168.1.7:4173 within 30000ms…» — an Arabic wrapper around the
 * transport's English message, with a URL and a millisecond count in it, after
 * a thirty-second freeze. A sleeping host, a closed app, a changed IP, a
 * firewall and a certificate mismatch all read identically, and each has a
 * different fix.
 *
 * What has to cross the bridge is the CODE and the HOST. The renderer holds the
 * five Arabic messages (`lan.error.*`, `{host}` as the only parameter) and
 * cannot invent the code.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();

/** What `dialog.showSaveDialog` answers next — set per test (P-6). */
let saveDialogResult: { canceled: boolean; filePath?: string } = { canceled: true };
const written: { path: string; bytes: Uint8Array }[] = [];

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog: () => Promise.resolve(saveDialogResult) },
}));

vi.mock("node:fs/promises", () => ({
  writeFile: (path: string, bytes: Uint8Array) => {
    written.push({ path, bytes });
    return Promise.resolve();
  },
}));

/**
 * A stand-in for the Electron invoke event, carrying the renderer frame the
 * `guarded` wrapper (main/ipc-guard.ts, audit S-5) checks. `null` used to do —
 * it no longer does, because a channel that answers a frame it cannot identify
 * is the finding.
 */
const RENDERER_EVENT = { senderFrame: { url: "app://mezan/index.html" } } as never;

const { registerHonoOverIpc, registerHonoOverLanClient, registerSavePdfOverIpc } = await import("./ipc.js");

const HOST = "https://192.168.1.7:4173";
const PINNED = "3D:9A:1F:04";
const PRESENTED = "AA:BB:CC:DD";

async function callWith(failure: unknown): Promise<Record<string, unknown>> {
  handlers.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  registerHonoOverLanClient(() => Promise.reject(failure), HOST, PINNED);
  const handler = handlers.get(MEZAN_FETCH_CHANNEL)!;
  const response = (await handler(RENDERER_EVENT, { url: "http://mezan.local/sales-invoices" })) as IpcFetchResponse;
  expect(response.status).toBe(502);
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe("registerHonoOverLanClient — a code and the host, never the English sentence", () => {
  it.each([
    ["TIMEOUT" as const],
    ["UNREACHABLE" as const],
    ["NO_SEAT" as const],
    ["VERSION_MISMATCH" as const],
  ])("carries %s and the paired host to the renderer", async (code) => {
    const body = await callWith(new LanClientError("English detail, for a log", code, HOST));

    expect(body["code"]).toBe(code);
    expect(body["host"]).toBe(HOST);
  });

  it("carries both fingerprints on a mismatch, so the re-pair screen can show the comparison", async () => {
    const body = await callWith(
      new LanClientError("not the pinned host", "PIN_MISMATCH", HOST, PRESENTED),
    );

    expect(body["code"]).toBe("PIN_MISMATCH");
    expect(body["presentedFingerprint"]).toBe(PRESENTED);
    expect(body["expectedFingerprint"]).toBe(PINNED);
  });

  it("falls back to UNREACHABLE for a failure that is not the transport's own", async () => {
    // An ordinary programming error must still produce a renderable answer
    // rather than an IPC rejection the shell prints raw.
    const body = await callWith(new TypeError("undefined is not a function"));

    expect(body["code"]).toBe("UNREACHABLE");
    expect(body["host"]).toBe(HOST);
  });

  it("does not put the English millisecond-count sentence where the shop reads it", async () => {
    const body = await callWith(
      new LanClientError(`No answer from ${HOST} within 30000ms.`, "TIMEOUT", HOST),
    );

    // The detail is still carried for a log and for a screen with no catalog
    // entry — but `code` is present, so no screen has to fall back to it.
    expect(body["code"]).toBe("TIMEOUT");
    expect(body["message"]).not.toContain("تعذّر الوصول إلى الجهاز الرئيسي. Could not reach");
  });
});

/**
 * guards Q-7 — a 37–51 MB Hono response used to be decoded to a JS string and
 * then copied again crossing structured-clone into the renderer, unconditionally.
 * The 8 MB limit is compiled in here, never read off the request.
 */
describe("registerHonoOverIpc — the hard size guard", () => {
  function honoAppAnswering(body: string, headers: Record<string, string> = {}): App {
    return { fetch: () => Promise.resolve(new Response(body, { status: 200, headers })) } as unknown as App;
  }

  async function invokeFetch(app: App): Promise<IpcFetchResponse> {
    handlers.clear();
    registerHonoOverIpc(app);
    const handler = handlers.get(MEZAN_FETCH_CHANNEL)!;
    return (await handler(RENDERER_EVENT, { url: "http://mezan.local/inventory/ledger" })) as IpcFetchResponse;
  }

  it("passes an ordinary response through untouched", async () => {
    const response = await invokeFetch(honoAppAnswering(JSON.stringify({ ok: true })));

    expect(response.status).toBe(200);
    expect(response.body).toBe(JSON.stringify({ ok: true }));
  });

  it("refuses a response over the 8 MB limit rather than transferring it", async () => {
    const oversized = "a".repeat(MAX_RESPONSE_BYTES + 1);
    const response = await invokeFetch(honoAppAnswering(oversized));

    expect(response.status).toBe(413);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body["error"]).toBe("RESPONSE_TOO_LARGE");
    // Arabic, ready to render — never the caller's own text, never English.
    expect(body["message"]).toBe(
      "النتيجة كبيرة جداً على النقل. ضيّق نطاق التاريخ أو الفلتر ثم أعد المحاولة.",
    );
  });

  it("allows a response exactly at the limit", async () => {
    const atLimit = "a".repeat(MAX_RESPONSE_BYTES);
    const response = await invokeFetch(honoAppAnswering(atLimit));

    expect(response.status).toBe(200);
    expect(response.body).toBe(atLimit);
  });
});

/**
 * guards P-6 — every report's «PDF» button had nowhere to put its output.
 * `mezan:printToPdf` hands the RENDERER the bytes, and an `<a download>` is
 * inert inside the app's sandbox, so the save dialog and the write have to
 * happen on this side of the bridge.
 */
describe("registerSavePdfOverIpc — the PDF is written, not handed back", () => {
  const PDF = Buffer.from("%PDF-1.7");

  function printEvent(seen: { landscape?: boolean; pageSize?: string }) {
    return {
      senderFrame: { url: "app://mezan/index.html" },
      sender: {
        printToPDF: (options: { landscape: boolean; pageSize: string }) => {
          seen.landscape = options.landscape;
          seen.pageSize = options.pageSize;
          return Promise.resolve(PDF);
        },
      },
    } as never;
  }

  async function invoke(options: unknown, seen: { landscape?: boolean; pageSize?: string } = {}) {
    handlers.clear();
    written.length = 0;
    registerSavePdfOverIpc();
    const handler = handlers.get(MEZAN_SAVE_PDF_CHANNEL)!;
    return (await handler(printEvent(seen), options)) as Record<string, unknown>;
  }

  it("writes the rendered PDF to the path the operator chose", async () => {
    saveDialogResult = { canceled: false, filePath: "/tmp/تقرير.pdf" };
    const result = await invoke({ defaultFileName: "تقرير المبيعات", landscape: true });

    expect(result["ok"]).toBe(true);
    expect(result["path"]).toBe("/tmp/تقرير.pdf");
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe("/tmp/تقرير.pdf");
  });

  it("passes the caller's orientation through — a wide report prints landscape", async () => {
    saveDialogResult = { canceled: false, filePath: "/tmp/a.pdf" };
    const seen: { landscape?: boolean; pageSize?: string } = {};
    await invoke({ landscape: true }, seen);
    expect(seen.landscape).toBe(true);
    expect(seen.pageSize).toBe("A4");
  });

  it("reports a dismissed dialog as CANCELLED and writes nothing — that is a decision, not a failure", async () => {
    saveDialogResult = { canceled: true };
    const result = await invoke({});

    expect(result["ok"]).toBe(false);
    expect(result["cancelled"]).toBe(true);
    expect(result["message"]).toBeUndefined();
    expect(written).toHaveLength(0);
  });

  it("answers a write failure in Arabic rather than rejecting across the bridge", async () => {
    saveDialogResult = { canceled: false, filePath: "/tmp/b.pdf" };
    handlers.clear();
    registerSavePdfOverIpc();
    const handler = handlers.get(MEZAN_SAVE_PDF_CHANNEL)!;
    const result = (await handler(
      {
        senderFrame: { url: "app://mezan/index.html" },
        sender: { printToPDF: () => Promise.reject(new Error("no renderer")) },
      } as never,
      {},
    )) as Record<string, unknown>;

    expect(result["ok"]).toBe(false);
    expect(result["cancelled"]).toBe(false);
    expect(String(result["message"])).toContain("تعذّر حفظ ملف PDF");
  });
});
