import { ENGLISH_LOCALE } from "@mezan/ui";

export interface ServerErrorBody {
  readonly error?: string;
  readonly message?: string;
  readonly messageEn?: string;
  readonly requestId?: string;
}

export function serverMessage(body: { readonly message?: string; readonly messageEn?: string }): string | undefined {
  const english = typeof document !== "undefined" && document.documentElement.lang === ENGLISH_LOCALE;
  if (english && body.messageEn) return body.messageEn;
  return body.message || body.messageEn || undefined;
}
