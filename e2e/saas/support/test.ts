import { test as base, type APIRequestContext } from "@playwright/test";
import { DEFAULT_BROWSER_CLIENT, proxiedSource } from "./env";

export { expect } from "@playwright/test";

type RequestFactory = { request: { newContext(options?: { extraHTTPHeaders?: Record<string, string> }): Promise<APIRequestContext> } };

// REQUIRED: a request sent straight to the API skips the dev proxy, so it must
// carry the whole two-hop chain itself. The server refuses a chain shorter than
// MEZAN_TRUSTED_PROXY_HOPS with 503 rather than guess at the client address.
export function directApi(playwright: RequestFactory): Promise<APIRequestContext> {
  return playwright.request.newContext({ extraHTTPHeaders: proxiedSource(DEFAULT_BROWSER_CLIENT) });
}

export const test = base.extend({
  request: async ({ playwright }, use) => {
    const context = await directApi(playwright);
    await use(context);
    await context.dispose();
  },
});
