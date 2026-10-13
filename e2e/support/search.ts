import { expect, type Locator, type Page } from "@playwright/test";

// INVARIANT: the list is filtered by the SERVER after a debounce. Reading the
// rows before that answer lands reads the unfiltered list, so every search
// step waits for the response to its own term and then asserts the filtered set.
export async function searchList(page: Page, placeholder: string, listPath: string, text: string): Promise<Locator> {
  const answered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === listPath && url.searchParams.get("search") === text.trim();
  });
  await page.getByPlaceholder(placeholder).fill(text);
  const response = await answered;
  expect(response.ok(), `GET ${listPath}?search=${text}`).toBe(true);
  const body = (await response.json()) as unknown[] | { items: unknown[] };
  expect(Array.isArray(body) ? body : body.items, `the server's answer to «${text}»`).toHaveLength(1);
  const row = page.locator("table tbody tr").filter({ hasText: text });
  await expect(row, `the list filtered by «${text}»`).toHaveCount(1);
  return row;
}
