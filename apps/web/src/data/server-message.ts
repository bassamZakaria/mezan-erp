import { ENGLISH_LOCALE } from "@mezan/ui";

export interface ServerErrorBody {
  readonly error?: string;
  readonly message?: string;
  readonly messageEn?: string;
  readonly requestId?: string;
}

export function serverMessage(body: { readonly message?: string; readonly messageEn?: string }): string | undefined {
  const english = typeof document !== "undefined" && document.documentElement.lang === ENGLISH_LOCALE;
  const arabic = body.message?.trim();
  const englishText = body.messageEn?.trim();
  if (english && englishText) return englishText;
  return arabic || englishText || undefined;
}

export async function readServerMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<ServerErrorBody>().catch(() => ({}))) as ServerErrorBody;
  return serverMessage(body) ?? fallback;
}
