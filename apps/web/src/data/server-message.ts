import { ENGLISH_LOCALE, type Locale } from "@mezan/ui";

export interface ServerErrorBody {
  readonly error?: string;
  readonly message?: string;
  readonly messageEn?: string;
  readonly requestId?: string;
}

export function pickLocalized(arabic: string | null | undefined, englishText: string | null | undefined, locale?: Locale): string | undefined {
  const english = locale !== undefined ? locale === ENGLISH_LOCALE : typeof document !== "undefined" && document.documentElement.lang === ENGLISH_LOCALE;
  const ar = arabic?.trim();
  const en = englishText?.trim();
  if (english && en) return en;
  return ar || en || undefined;
}

export function pickMessage(source: { readonly message: string; readonly messageEn?: string }, locale?: Locale): string {
  return pickLocalized(source.message, source.messageEn, locale) ?? source.message;
}

export function serverMessage(body: { readonly message?: string; readonly messageEn?: string }): string | undefined {
  return pickLocalized(body.message, body.messageEn);
}

export async function readServerMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<ServerErrorBody>().catch(() => ({}))) as ServerErrorBody;
  return serverMessage(body) ?? fallback;
}

export interface ServerReasonsBody extends ServerErrorBody {
  readonly reasons?: readonly string[];
  readonly reasonsEn?: readonly string[];
}

// `reasons` is Arabic; an English page reads `reasonsEn`, else the English sentence.
export function serverReasons(body: ServerReasonsBody, separator: string): string | undefined {
  const joined = (list: readonly string[] | undefined) => (list && list.length > 0 ? list.join(separator) : undefined);
  const arabic = joined(body.reasons) ?? body.message;
  const english = joined(body.reasonsEn) ?? body.messageEn;
  return pickLocalized(arabic, english);
}

export async function readServerReasons(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<ServerReasonsBody>().catch(() => ({}))) as ServerReasonsBody;
  return serverReasons(body, " — ") ?? fallback;
}
