import { writeFile } from "node:fs/promises";
import { BrowserWindow, dialog } from "electron";
import { handleGuarded } from "./ipc-guard.js";
import type { BridgeFetchResult, FetchLike } from "./backend-bridge.js";
import { LanClientError, MAX_RESPONSE_BYTES, tooLargeResponse, type LanClientErrorCode } from "./lan-client.js";
import {
  FETCH_TO_FILE_UNSUPPORTED_STATUS,
  MEZAN_FETCH_CHANNEL,
  MEZAN_FETCH_TO_FILE_CHANNEL,
  MEZAN_PRINT_TO_PDF_CHANNEL,
  MEZAN_SAVE_PDF_CHANNEL,
  type IpcFetchRequest,
  type IpcFetchResponse,
  type IpcFetchToFileRequest,
  type IpcFetchToFileResponse,
  type PrintToPdfOptions,
  type SavePdfOptions,
  type SavePdfResult,
} from "../shared/ipc-contract.js";

const HOST_SENTENCES: Readonly<Record<LanClientErrorCode, (host: string) => { ar: string; en: string }>> = {
  UNREACHABLE: (host) => ({
    ar: `الجهاز الرئيسي على ${host} لا يستقبل اتصالات. تأكد أن برنامج مزان مفتوح على ذلك الجهاز.`,
    en: `The main machine at ${host} is not accepting connections. Check that Mezan is running on it.`,
  }),
  TIMEOUT: (host) => ({
    ar: `لا يوجد رد من الجهاز الرئيسي على ${host}. غالباً الجهاز مطفأ أو نائم، أو جدار الحماية يحجب الاتصال، أو الجهازان على شبكتين مختلفتين.`,
    en: `No answer from the main machine at ${host}. It is probably off or asleep, a firewall is blocking the connection, or the two machines are on different networks.`,
  }),
  PIN_MISMATCH: (host) => ({
    ar: `الجهاز الذي ردّ على ${host} ليس الجهاز الرئيسي المسجَّل على هذه المحطة. لم يُرسَل أي شيء.`,
    en: `The machine answering at ${host} is not the main machine this connected till was paired with. Nothing was sent.`,
  }),
  NO_SEAT: (host) => ({
    ar: `لا توجد مقاعد شاغرة في ترخيص الجهاز الرئيسي على ${host}. افصل جهازاً آخر من شاشة «الأجهزة المتصلة» أو زد عدد المقاعد.`,
    en: `No free seats on the main machine's licence at ${host}. Disconnect another device from the connected-devices screen, or add seats.`,
  }),
  VERSION_MISMATCH: (host) => ({
    ar: `إصدار البرنامج على هذه المحطة يختلف عن إصدار الجهاز الرئيسي على ${host}. حدِّث الجهاز الرئيسي أولاً ثم هذه المحطة.`,
    en: `This connected till is on a different version from the main machine at ${host}. Update the main machine first, then this one.`,
  }),
};

function hostUnreachableSentence(code: LanClientErrorCode, host: string): { ar: string; en: string } {
  return (HOST_SENTENCES[code] ?? HOST_SENTENCES.UNREACHABLE)(host);
}

/**
 * Registers the single IPC handler that carries every renderer request into
 * the shared Hono app. There is no HTTP server and no port on desktop
 * (docs/archive/plan.md §2.2): the preload bridge marshals a `Request` over IPC and
 * this handler calls `honoApp.fetch(new Request(...))`, returning the response
 * as a structured-clone-safe plain object.
 *
 * `honoApp` is no longer necessarily in this process. On the shipped desktop
 * host it is main/backend-process.ts's shim over the utility process that owns
 * SQLite (Q-1); the headless demo and the tests still pass a real Hono app.
 * Nothing below can tell, and nothing below should.
 */
export function registerHonoOverIpc(honoApp: FetchLike): void {
  handleGuarded(
    MEZAN_FETCH_CHANNEL,
    async (_event, req: IpcFetchRequest): Promise<IpcFetchResponse> => {
      const response = await honoApp.fetch(
        new Request(req.url, {
          method: req.method ?? "GET",
          headers: req.headers,
          body: req.body,
        }),
      );
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      // Same reason the client mount logs its refusals: a 401 on ANY request
      // after sign-in makes the renderer clear the session and bounce back to
      // the login screen with «انتهت الجلسة» (ApiContext.tsx), and the screen
      // cannot say WHICH request did it. Without this line the only symptom is
      // "I log in and it throws me straight back out", which is unfalsifiable
      // from the outside.
      // `MEZAN_LOG_IPC=1` widens it to every request, which is what a support
      // call needs when the complaint is "it signs me straight back out" and
      // the refusal that caused it is a 200 followed by something else.
      if (process.env["MEZAN_LOG_IPC"] === "1" || response.status >= 400) {
        // WHETHER a token was attached, never any part of the token itself: a
        // session token is a bearer credential and a log file is not the place
        // for one, not even a fragment. "no-token" is the whole of what was
        // needed to find the bug this line exists for — the renderer was
        // sending none at all.
        const authenticated = Object.keys(req.headers ?? {}).some((k) => k.toLowerCase() === "authorization");
        console.warn(
          `[ipc] ${req.method ?? "GET"} ${new URL(req.url).pathname} -> ${response.status}` +
            (authenticated ? "" : " (no-token)"),
        );
      }
      // Sized before it is decoded, so an over-limit body is never turned into
      // a JS string just to be thrown away — that string, once materialised,
      // would be copied again crossing structured-clone into the renderer.
      const encodedBody = new Uint8Array(await response.arrayBuffer());
      if (encodedBody.byteLength > MAX_RESPONSE_BYTES) {
        console.warn(
          `[ipc] ${req.method ?? "GET"} ${new URL(req.url).pathname} refused: ` +
            `${encodedBody.byteLength} bytes exceeds the ${MAX_RESPONSE_BYTES}-byte transfer limit`,
        );
        return tooLargeResponse();
      }
      return {
        status: response.status,
        headers,
        body: new TextDecoder().decode(encodedBody),
      };
    },
  );
}

/**
 * The CLIENT-machine counterpart of {@link registerHonoOverIpc}: the same
 * channel and the same response shape, answered by the host over the network
 * instead of by a Hono app in this process (main/lan-client.ts).
 *
 * Registering one or the other is the entire host/client branch as the renderer
 * experiences it. A client build has no database, no backend and no LAN socket
 * of its own — the ONE copy of the books stays on the host — so there is no
 * second app instance here for a request to accidentally reach.
 *
 * A transport failure is answered as a real HTTP response, not by rejecting the
 * IPC call: `window.mezan.fetch` is the renderer's `fetch`, every data hook
 * reads `status` off it, and an IPC rejection surfaces as an unhandled promise
 * with an Electron-shaped message instead of the screen's own error state. 502
 * with a body the UI can render is what the shell already knows how to show.
 */
export function registerHonoOverLanClient(
  forward: (path: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }>,
  /** The paired host, for the `{host}` parameter every LAN failure message takes. */
  hostUrl?: string,
  /** The pinned fingerprint, so a mismatch screen can show expected beside presented. */
  expectedFingerprint?: string,
): void {
  handleGuarded(
    MEZAN_FETCH_CHANNEL,
    async (_event, req: IpcFetchRequest): Promise<IpcFetchResponse> => {
      // The renderer addresses `http://mezan.local/sales-invoices` (see
      // apps/web's createElectronTransport — `new Request()` rejects a bare
      // pathname). Only the path travels; the host is the paired one.
      const url = new URL(req.url);
      try {
        const response = await forward(`${url.pathname}${url.search}`, {
          method: req.method ?? "GET",
          headers: req.headers,
          body: req.body,
        });
        // Every refusal, once, with the method and path. A client that cannot
        // read anything looks identical from the screen whether the host is
        // refusing it a seat, refusing its session, or genuinely lacks the
        // route — and the renderer shows the same empty state for all three.
        // This line is the only place a consultant can tell them apart, and its
        // absence cost a whole debugging pass on the first two-machine run.
        if (response.status >= 400) {
          console.warn(`[client] ${req.method ?? "GET"} ${url.pathname} -> ${response.status}`);
        }
        return response;
      } catch (err) {
        console.error("[client] request to the host failed", err);
        // A CODE AND THE HOST, NEVER THE ENGLISH SENTENCE.
        //
        // This used to interpolate the transport's own message — "No answer
        // from https://192.168.1.7:4173 within 30000ms" — into an Arabic
        // wrapper, so a sleeping host, a closed app, a changed IP, a firewall
        // and a certificate mismatch all reached the shop as the same
        // bilingual paragraph with a URL and a millisecond count in it. The
        // renderer holds five distinct Arabic messages keyed on `code`
        // (`lan.error.*`); what it cannot do is invent the code, so the pair
        // travels and the prose does not.
        const lan = err instanceof LanClientError ? err : null;
        const hostSentence = hostUnreachableSentence(lan?.code ?? "UNREACHABLE", lan?.host ?? hostUrl ?? "");
        return {
          status: 502,
          headers: { "content-type": "application/json; charset=UTF-8" },
          body: JSON.stringify({
            error: "HOST_UNREACHABLE",
            code: lan?.code ?? "UNREACHABLE",
            host: lan?.host ?? hostUrl,
            ...(lan?.presentedFingerprint ? { presentedFingerprint: lan.presentedFingerprint } : {}),
            ...(expectedFingerprint ? { expectedFingerprint } : {}),
            message: hostSentence.ar,
            messageEn: hostSentence.en,
            detail: err instanceof Error ? err.message : String(err),
          }),
        };
      }
    },
  );
}

/**
 * Registers the `printToPDF` IPC handler (docs/archive/plan.md §2.4). `event.sender`
 * is the `webContents` of whichever renderer window invoked the call, so
 * this needs no window reference of its own — it prints exactly the page
 * that asked, the same print DOM the browser edition renders via
 * `window.print()`.
 */
export function registerPrintToPdfOverIpc(): void {
  handleGuarded(
    MEZAN_PRINT_TO_PDF_CHANNEL,
    async (event, options?: PrintToPdfOptions): Promise<Uint8Array> => {
      const pdf = await event.sender.printToPDF({
        landscape: options?.landscape ?? false,
        pageSize: options?.pageSize ?? "A4",
      });
      return new Uint8Array(pdf);
    },
  );
}

/**
 * `mezan:print:pdf` — render the calling page to PDF and WRITE it where the
 * operator says (P-6).
 *
 * `mezan:printToPdf` returns bytes, and the renderer can do nothing with
 * them: an `<a download>` is inert inside the app's sandbox, so every report's
 * «PDF» button either did nothing or opened a print dialog. The save dialog
 * and the write both belong to the main process, which is the only side that
 * may touch the filesystem.
 *
 * A dismissed dialog is `cancelled`, not an error — the caller must not show
 * a failure for a decision the operator made.
 */
export function registerSavePdfOverIpc(): void {
  handleGuarded(
    MEZAN_SAVE_PDF_CHANNEL,
    async (event, options?: SavePdfOptions): Promise<SavePdfResult> => {
      try {
        const pdf = await event.sender.printToPDF({
          landscape: options?.landscape ?? false,
          pageSize: options?.pageSize ?? "A4",
        });
        const owner = BrowserWindow.fromWebContents(event.sender);
        const defaultPath = `${(options?.defaultFileName ?? "mezan").replace(/[/\\:*?"<>|]/g, "-")}.pdf`;
        const choice = await (owner
          ? dialog.showSaveDialog(owner, { defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] })
          : dialog.showSaveDialog({ defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] }));
        if (choice.canceled || !choice.filePath) return { ok: false, cancelled: true };
        await writeFile(choice.filePath, pdf);
        return { ok: true, path: choice.filePath };
      } catch (err) {
        return {
          ok: false,
          cancelled: false,
          // Arabic-first: the operator reads this, not the stack behind it.
          message: `تعذّر حفظ ملف PDF. ${err instanceof Error ? err.message : String(err)}`,
          messageEn: `The PDF file could not be saved. ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  );
}

export enum FetchToFilePath {
  EvidencePack = "/audit/evidence-packs",
}

const FETCH_TO_FILE_PATHS: ReadonlySet<string> = new Set(Object.values(FetchToFilePath));

function safeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-");
}

/**
 * The host's large-download channel. The save dialog runs FIRST, so nothing is
 * built for an operator who cancels; then `toFile` runs the request in the
 * backend worker, which streams the body straight into the chosen file. Only
 * the bounded error body of a refusal crosses back.
 */
export function registerFetchToFileOverIpc(toFile: (request: Request, filePath: string) => Promise<BridgeFetchResult>): void {
  handleGuarded(
    MEZAN_FETCH_TO_FILE_CHANNEL,
    async (event, req: IpcFetchToFileRequest): Promise<IpcFetchToFileResponse> => {
      const url = new URL(req.url);
      // SECURITY: a renderer may only ask for the downloads that need this path;
      // any other route keeps the ordinary capped channel.
      if (!FETCH_TO_FILE_PATHS.has(url.pathname)) {
        return { status: 404, headers: {}, body: JSON.stringify({ error: "NOT_FOUND" }), savedPath: null, cancelled: false };
      }
      const owner = BrowserWindow.fromWebContents(event.sender);
      const defaultPath = safeFileName(req.defaultFileName);
      const filters = [{ name: "ZIP", extensions: ["zip"] }];
      const choice = await (owner ? dialog.showSaveDialog(owner, { defaultPath, filters }) : dialog.showSaveDialog({ defaultPath, filters }));
      if (choice.canceled || !choice.filePath) return { status: 200, headers: {}, body: "", savedPath: null, cancelled: true };
      const result = await toFile(new Request(req.url, { method: req.method ?? "GET", headers: req.headers, body: req.body }), choice.filePath);
      const ok = result.status >= 200 && result.status < 300;
      return {
        status: result.status,
        headers: result.headers,
        body: new TextDecoder().decode(result.body),
        savedPath: ok ? choice.filePath : null,
        cancelled: false,
      };
    },
  );
}

/** A paired till has no backend of its own: it says so, and the renderer falls back to the ordinary channel. */
export function registerFetchToFileUnsupportedOverIpc(): void {
  handleGuarded(
    MEZAN_FETCH_TO_FILE_CHANNEL,
    async (): Promise<IpcFetchToFileResponse> => ({ status: FETCH_TO_FILE_UNSUPPORTED_STATUS, headers: {}, body: "", savedPath: null, cancelled: false }),
  );
}
