import { DEVICE_BINDING_HEADER, DEVICE_SECRET_HEADER } from "@mezan/contracts";

const COOKIE = "mezan_device";
const COOKIE_PATH = "/api";
const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
export const COOKIE_BINDING = "cookie";
const HEADER_BINDING = "1";

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === COOKIE) return part.slice(at + 1).trim() || null;
  }
  return null;
}

export function deviceSecretOf(request: Request): string | null {
  return request.headers.get(DEVICE_SECRET_HEADER) ?? cookieValue(request);
}

export function asksForDeviceCookie(request: Request): boolean {
  return request.headers.get(DEVICE_BINDING_HEADER) === COOKIE_BINDING;
}

// SECURITY: the cookie carries the DEVICE SECRET, never the session token. A
// tenant backend authenticates the bearer token and then requires this secret
// beside it, so a request a browser sends on its own — a cross-site form post,
// an image tag — carries the cookie and no token and is answered 401. That is
// why the cookie adds no cross-site request surface, and why the token must
// never move into it. HttpOnly keeps the secret from any script on the page;
// SameSite=Strict and Path keep it off every other request.
function setCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function withDeviceSecretHeader(request: Request): Request {
  const secret = deviceSecretOf(request);
  if (secret !== null) request.headers.set(DEVICE_SECRET_HEADER, secret);
  if (asksForDeviceCookie(request)) request.headers.set(DEVICE_BINDING_HEADER, HEADER_BINDING);
  return request;
}

export async function secretIntoCookie(answer: Response, secure: boolean): Promise<Response> {
  if (!answer.ok) return answer;
  const body = (await answer.json()) as { deviceSecret?: unknown } & Record<string, unknown>;
  const { deviceSecret, ...rest } = body;
  const headers = new Headers(answer.headers);
  headers.delete("content-length");
  if (typeof deviceSecret === "string") headers.append("set-cookie", setCookie(deviceSecret, COOKIE_MAX_AGE_SECONDS, secure));
  return new Response(JSON.stringify(rest), { status: answer.status, headers });
}

export function clearingCookie(answer: Response, secure: boolean): Response {
  const headers = new Headers(answer.headers);
  headers.append("set-cookie", setCookie("", 0, secure));
  return new Response(answer.body, { status: answer.status, headers });
}
