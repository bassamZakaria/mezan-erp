import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test as base, expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { horizontalOverflow, offendingElements, OVERFLOW_TOLERANCE } from "./support/overflow";
import { apiGet } from "./support/ledger";
import { ADDRESSED_SCREENS, ADDRESS_PLACEHOLDER, AddressSource, ScreenDoor, loadScreenCatalog, type AddressedScreen, type ScreenEntry } from "./support/screen-catalog";
import { PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_PASSWORD } from "./saas/support/env";

const SCREENS = loadScreenCatalog();
const FINDINGS_FILE = path.resolve("e2e-results/every-screen-findings.jsonl");

enum Cause {
  NotFound = "404",
  AppError = "app error",
  UncaughtPageError = "uncaught page error",
  ConsoleError = "console error",
  ApiError = "api error",
  EmptyList = "empty list",
  StuckLoading = "stuck loading",
  NoHeading = "no heading",
  Redirected = "redirected",
  PhoneOverflow = "phone overflow",
  Drawer = "drawer",
  PageOverflow = "page overflow",
  RawCode = "raw code",
}

interface Problem {
  readonly cause: Cause;
  readonly detail: string;
}

/*
 * Console noise that is not a defect in the screen under test. Every entry
 * must say why; anything else logged at `error` level is a finding.
 */
const BENIGN_CONSOLE: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  {
    // Chromium logs every non-2xx fetch as a console error. The response itself
    // is captured with its method, path and status as an "api error", which is
    // the readable form of the same fact, so it is not counted twice.
    pattern: /^Failed to load resource: the server responded with a status of \d+/,
    why: "duplicate of the api-error record for the same response",
  },
  {
    // The workspace rail renders on every screen, so a missing nav label logs
    // on all 147 of them. It is asserted once, by "the shell itself" below,
    // rather than failing every screen for a defect none of them owns.
    pattern: /^\[i18n\] missing "ar" translation for key "nav\./,
    why: "shell chrome, asserted by the dedicated shell test",
  },
];

// An empty state that asks the operator to pick something («اختر عقدًا») is a
// prompt on a drill-in screen, not an empty list.
const SELECTION_PROMPT = /^اختر/;

// Screens whose table is a scratch pad the operator fills, not a list of
// records: an empty one is their correct opening state.
const WORK_TABLE_SCREENS = new Set<string>([
  "labels", // the print queue: rows are the items the operator adds for printing
]);

const test = base.extend<object, { workerStorageState: string }>({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),
  workerStorageState: [
    async ({ browser }, use, workerInfo) => {
      const file = path.join(workerInfo.project.outputDir, `.auth-${workerInfo.project.name}-${workerInfo.parallelIndex}.json`);
      const page = await browser.newPage({
        baseURL: workerInfo.project.use.baseURL,
        viewport: workerInfo.project.use.viewport ?? undefined,
      });
      await loginAsDemoUser(page);
      await page.context().storageState({ path: file });
      await page.close();
      await use(file);
    },
    { scope: "worker" },
  ],
});

function isPhone(testInfo: TestInfo): boolean {
  return (testInfo.project.use.viewport?.width ?? 1440) < 768;
}

function record(testInfo: TestInfo, screen: ScreenEntry, problems: readonly Problem[]): void {
  mkdirSync(path.dirname(FINDINGS_FILE), { recursive: true });
  appendFileSync(
    FINDINGS_FILE,
    `${JSON.stringify({ key: screen.key, path: screen.path, viewport: testInfo.project.name, problems })}\n`,
  );
}

async function settle(page: Page): Promise<boolean> {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  const settled = await expect
    .poll(() => page.locator("main .animate-pulse").count(), { timeout: 20_000 })
    .toBe(0)
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(400);
  return settled;
}

async function onLoginScreen(page: Page): Promise<boolean> {
  return page.getByLabel("رمز PIN رقم 1").isVisible().catch(() => false);
}

async function openScreen(page: Page, target: string): Promise<boolean> {
  await page.goto(target);
  let settled = await settle(page);
  if (await onLoginScreen(page)) {
    await loginAsDemoUser(page);
    await page.goto(target);
    settled = await settle(page);
  }
  return settled;
}

interface TableCensus {
  readonly tables: number;
  readonly dataRows: number;
  readonly headers: string[];
  readonly emptyStates: string[];
}

async function tableCensus(page: Page): Promise<TableCensus> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return { tables: 0, dataRows: 0, headers: [], emptyStates: [] };
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const tables = Array.from(main.querySelectorAll("table")).filter(visible);
    let dataRows = 0;
    const headers: string[] = [];
    for (const table of tables) {
      const head = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "").filter(Boolean);
      headers.push(head.slice(0, 4).join(" | "));
      for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
        if (row.getAttribute("aria-hidden") === "true") continue;
        const cells = row.querySelectorAll("td, th[scope=row]");
        if (cells.length === 0) continue;
        if (cells.length === 1 && (cells[0] as HTMLTableCellElement).colSpan > 1) continue;
        dataRows += 1;
      }
    }
    const emptyStates = Array.from(main.querySelectorAll("div.items-center > p.font-semibold"))
      .filter((p) => visible(p) && (p.parentElement?.className.includes("py-[36px]") ?? false))
      .map((p) => p.textContent?.trim() ?? "");
    return { tables: tables.length, dataRows, headers, emptyStates };
  });
}

async function checkLoadedScreen(page: Page, screen: ScreenEntry, settled: boolean, problems: Problem[]): Promise<void> {
  const pathname = new URL(page.url()).pathname;
  if (!pathname.startsWith(screen.path)) {
    problems.push({ cause: Cause.Redirected, detail: `asked for ${screen.path}, landed on ${pathname}` });
  }

  const body = page.locator("body");
  const bodyText = (await body.innerText().catch(() => "")) ?? "";
  if (bodyText.includes("الصفحة غير موجودة")) {
    problems.push({ cause: Cause.NotFound, detail: `«الصفحة غير موجودة» at ${pathname}` });
  }
  if (bodyText.includes("تعذّر عرض هذه الشاشة") || bodyText.includes("حدث خطأ")) {
    const pre = await page.locator("[role=alert] pre").first().innerText().catch(() => "");
    problems.push({ cause: Cause.AppError, detail: `error boundary: ${pre || "(no detail)"}` });
  }

  const main = page.locator("main").first();
  if (!(await main.isVisible().catch(() => false))) {
    problems.push({ cause: Cause.AppError, detail: "no visible <main> landmark" });
    return;
  }

  const mainText = (await main.innerText().catch(() => "")) ?? "";
  const loadFailures = mainText.split("\n").filter((line) => /تعذّر تحميل|تعذر تحميل/.test(line));
  for (const line of [...new Set(loadFailures)]) problems.push({ cause: Cause.AppError, detail: `load failure shown: «${line.trim()}»` });

  if (!settled) problems.push({ cause: Cause.StuckLoading, detail: "skeleton still on screen after 20s" });

  const headings = await main.locator("h1, h2, [role=heading]").count();
  if (headings === 0) problems.push({ cause: Cause.NoHeading, detail: "main has no h1/h2/heading" });

  const census = await tableCensus(page);
  const emptyStates = census.emptyStates.filter((text) => !SELECTION_PROMPT.test(text));
  const isWorkTable = WORK_TABLE_SCREENS.has(screen.key);
  if (!isWorkTable && (census.tables > 0 || emptyStates.length > 0) && census.dataRows === 0) {
    const what = [
      census.tables > 0 ? `${census.tables} table(s) with 0 data rows [${census.headers.join(" ; ")}]` : "",
      emptyStates.length > 0 ? `empty state «${emptyStates.join("», «")}»` : "",
    ]
      .filter(Boolean)
      .join("; ");
    problems.push({ cause: Cause.EmptyList, detail: what });
  }
}

async function checkPhoneOverflow(page: Page, problems: Problem[]): Promise<void> {
  const overflow = await horizontalOverflow(page);
  if (overflow > OVERFLOW_TOLERANCE) {
    const offenders = await offendingElements(page);
    problems.push({
      cause: Cause.PhoneOverflow,
      detail: `page scrolls ${overflow}px sideways; widest offenders: ${offenders.join(" ; ") || "(none named)"}`,
    });
  }
}

async function checkDrawerReach(page: Page, screen: ScreenEntry, problems: Problem[]): Promise<void> {
  const start = screen.key === "dashboard" ? "/workflow/notifications" : "/dashboard";
  await openScreen(page, start);
  const rail = page.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
  const toggle = page.getByRole("button", { name: "فتح قائمة التنقل" });
  if (!(await toggle.isVisible().catch(() => false))) {
    problems.push({ cause: Cause.Drawer, detail: "no «فتح قائمة التنقل» button on a phone viewport" });
    return;
  }
  await toggle.click();
  if (!(await rail.isVisible().catch(() => false))) {
    await expect(rail).toBeVisible({ timeout: 3_000 }).catch(() => undefined);
  }
  if (!(await rail.isVisible().catch(() => false))) {
    problems.push({ cause: Cause.Drawer, detail: "drawer did not open after tapping «فتح قائمة التنقل»" });
    return;
  }

  if (screen.key === "dashboard") {
    await rail.getByRole("button", { name: "لوحة التحكم", exact: true }).click();
  } else if (screen.inNav && screen.label && screen.groupLabel) {
    await rail.getByRole("button", { name: "كل الشاشات", exact: true }).click();
    const dialog = page.getByRole("dialog");
    if (!(await dialog.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false))) {
      problems.push({ cause: Cause.Drawer, detail: "«كل الشاشات» did not open from the drawer" });
      return;
    }
    const groupLabel = screen.groupLabel;
    const section = dialog.locator("section").filter({ has: page.locator("h3").getByText(groupLabel, { exact: true }) });
    const row = section.locator("button").filter({ has: page.locator("span.truncate").getByText(screen.label, { exact: true }) });
    const count = await row.count();
    if (count === 0) {
      problems.push({ cause: Cause.Drawer, detail: `«${screen.label}» not listed under «${groupLabel}» in «كل الشاشات»` });
      return;
    }
    if (count <= screen.labelOccurrence) {
      problems.push({ cause: Cause.Drawer, detail: `«${screen.label}» is listed ${count}× under «${groupLabel}», expected at least ${screen.labelOccurrence + 1}` });
      return;
    }
    const clicked = await row
      .nth(screen.labelOccurrence)
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch((e: Error) => {
        problems.push({ cause: Cause.Drawer, detail: `could not tap «${screen.label}»: ${e.message.split("\n")[0]}` });
        return false;
      });
    if (!clicked) return;
  } else {
    return;
  }

  await settle(page);
  const landed = new URL(page.url()).pathname;
  if (!landed.startsWith(screen.path)) {
    problems.push({ cause: Cause.Drawer, detail: `drawer navigation landed on ${landed}, expected ${screen.path}` });
  }
  if (await rail.isVisible().catch(() => false)) {
    problems.push({ cause: Cause.Drawer, detail: "drawer stayed open over the screen after navigating" });
  }
}

function collect(page: Page, problems: Problem[], phaseOf: () => string, ignore: typeof BENIGN_CONSOLE): void {
  const seen = new Set<string>();
  const push = (problem: Problem) => {
    const id = `${problem.cause}|${problem.detail}`;
    if (seen.has(id)) return;
    seen.add(id);
    problems.push(problem);
  };
  page.on("pageerror", (error) => {
    const where = error.stack?.split("\n").find((l) => l.includes("/src/")) ?? "";
    push({ cause: Cause.UncaughtPageError, detail: `[${phaseOf()}] ${error.message}${where ? ` @ ${where.trim()}` : ""}` });
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (ignore.some((b) => b.pattern.test(text))) return;
    const loc = msg.location();
    const at = loc.url ? ` @ ${loc.url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "")}:${loc.lineNumber}` : "";
    push({ cause: Cause.ConsoleError, detail: `[${phaseOf()}] ${text.slice(0, 400)}${at}` });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/") || response.status() < 400) return;
    push({
      cause: Cause.ApiError,
      detail: `[${phaseOf()}] ${response.status()} ${response.request().method()} ${url.pathname}${url.search}`,
    });
  });
}

function format(problems: readonly Problem[]): string {
  return problems.map((p) => `  [${p.cause}] ${p.detail}`).join("\n");
}

test("the shell itself logs no console errors", async ({ page }, testInfo) => {
  const problems: Problem[] = [];
  collect(page, problems, () => "shell", BENIGN_CONSOLE.filter((b) => !b.why.startsWith("shell chrome")));
  const settled = await openScreen(page, "/dashboard");
  const shell = { key: "(shell)", path: "/dashboard", group: null, groupLabel: null, label: null, labelOccurrence: 0, inNav: false, routed: true };
  await checkLoadedScreen(page, shell, settled, problems);
  record(testInfo, shell, problems);
  expect(problems, `shell @ ${testInfo.project.name}:\n${format(problems)}`).toEqual([]);
});

test.describe("every screen", () => {
  for (const screen of SCREENS) {
    test(`${screen.key} ${screen.path}`, async ({ page }, testInfo) => {
      const problems: Problem[] = [];
      let phase = "load";

      collect(page, problems, () => phase, BENIGN_CONSOLE);

      const settled = await openScreen(page, screen.path);
      await checkLoadedScreen(page, screen, settled, problems);

      if (isPhone(testInfo)) {
        await checkPhoneOverflow(page, problems);
        phase = "drawer";
        await checkDrawerReach(page, screen, problems);
      }

      record(testInfo, screen, problems);
      expect(problems, `${screen.key} @ ${testInfo.project.name}:\n${format(problems)}`).toEqual([]);
    });
  }
});

const RAW_CODE = /\b(?:[A-Z]{2,}_[A-Z_]{2,}|[a-z]{3,}_[a-z_]{3,})\b/;

enum FiscalPeriodStatus {
  Open = "open",
  Closed = "closed",
}

interface FiscalPeriodRow {
  readonly id: string;
  readonly status: string;
  readonly startDate: string;
}

async function firstIdOf(page: Page, path: string): Promise<string> {
  const rows = await apiGet<readonly { readonly id: string }[]>(page, path);
  const first = rows[0];
  if (!first) throw new Error(`GET /api${path} returned no rows to address a sub-page with`);
  return first.id;
}

async function fiscalPeriodIn(page: Page, status: FiscalPeriodStatus): Promise<string> {
  const periods = [...(await apiGet<readonly FiscalPeriodRow[]>(page, "/fiscal-periods"))].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const matching = periods.filter((period) => period.status === status);
  const chosen = status === FiscalPeriodStatus.Closed ? matching[matching.length - 1] : matching[0];
  if (!chosen) throw new Error(`no ${status} fiscal period in the seeded tenant`);
  return chosen.id;
}

async function platformSignIn(page: Page): Promise<void> {
  await page.goto("/platform/login");
  await page.getByLabel("البريد الإلكتروني").fill(PLATFORM_OWNER_EMAIL);
  await page.getByLabel("كلمة المرور").fill(PLATFORM_OWNER_PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

async function platformGet<T>(page: Page, path: string): Promise<T> {
  const stored = await page.evaluate(() => window.localStorage.getItem("mezan.platform.session"));
  if (!stored) throw new Error("no platform session on this page — sign in to the console first");
  const { token } = JSON.parse(stored) as { token: string };
  const response = await page.request.get(`/api/platform${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status(), `GET /api/platform${path}`).toBe(200);
  return (await response.json()) as T;
}

async function addressOf(page: Page, source: AddressSource): Promise<string> {
  switch (source) {
    case AddressSource.BankStatement:
      return firstIdOf(page, "/bank-statements");
    case AddressSource.LandedCost:
      return firstIdOf(page, "/landed-costs");
    case AddressSource.ClosedFiscalPeriod:
      return fiscalPeriodIn(page, FiscalPeriodStatus.Closed);
    case AddressSource.OpenFiscalPeriod:
      return fiscalPeriodIn(page, FiscalPeriodStatus.Open);
    case AddressSource.PlatformTenant: {
      const first = (await platformGet<readonly { readonly tenant: { readonly id: string } }[]>(page, "/tenants"))[0];
      if (!first) throw new Error("the platform console lists no tenant to open");
      return first.tenant.id;
    }
    case AddressSource.PlatformPlan: {
      const first = (await platformGet<readonly { readonly id: string }[]>(page, "/plans"))[0];
      if (!first) throw new Error("the platform console lists no plan to open");
      return first.id;
    }
  }
}

async function pageBehind(browser: Browser, testInfo: TestInfo, door: ScreenDoor, tenantState: string): Promise<Page> {
  const { baseURL, viewport, locale, isMobile, hasTouch, deviceScaleFactor } = testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    viewport: viewport ?? undefined,
    locale,
    isMobile,
    hasTouch,
    deviceScaleFactor,
    storageState: door === ScreenDoor.Tenant ? tenantState : undefined,
  });
  return context.newPage();
}

async function checkStandaloneScreen(page: Page, target: string, settled: boolean, problems: Problem[]): Promise<void> {
  const asked = new URL(target, "http://local").pathname;
  const pathname = new URL(page.url()).pathname;
  if (!pathname.startsWith(asked)) problems.push({ cause: Cause.Redirected, detail: `asked for ${asked}, landed on ${pathname}` });

  const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
  if (bodyText.includes("الصفحة غير موجودة")) problems.push({ cause: Cause.NotFound, detail: `«الصفحة غير موجودة» at ${pathname}` });
  if (bodyText.includes("تعذّر عرض هذه الشاشة") || bodyText.includes("حدث خطأ")) {
    problems.push({ cause: Cause.AppError, detail: "error boundary on screen" });
  }
  for (const line of [...new Set(bodyText.split("\n").filter((text) => /تعذّر تحميل|تعذر تحميل/.test(text)))]) {
    problems.push({ cause: Cause.AppError, detail: `load failure shown: «${line.trim()}»` });
  }
  if (!settled) problems.push({ cause: Cause.StuckLoading, detail: "skeleton still on screen after 20s" });

  const headings = (await page.locator("h1").allInnerTexts()).map((text) => text.trim()).filter((text) => text !== "");
  if (headings.length !== 1) problems.push({ cause: Cause.NoHeading, detail: `expected exactly one non-empty h1, found ${headings.length}: ${headings.join(" | ")}` });

  const rawCode = bodyText.match(RAW_CODE)?.[0];
  if (rawCode) problems.push({ cause: Cause.RawCode, detail: `raw code on an Arabic screen: ${rawCode}` });

  const overflow = await horizontalOverflow(page);
  if (overflow > OVERFLOW_TOLERANCE) {
    const offenders = await offendingElements(page);
    problems.push({ cause: Cause.PageOverflow, detail: `page scrolls ${overflow}px sideways; widest offenders: ${offenders.join(" ; ") || "(none named)"}` });
  }
}

function asEntry(screen: AddressedScreen, target: string): ScreenEntry {
  return { key: screen.key, path: new URL(target, "http://local").pathname, group: null, groupLabel: null, label: null, labelOccurrence: 0, inNav: false, routed: true };
}

test.describe("screens the navigation tree cannot address", () => {
  for (const screen of ADDRESSED_SCREENS) {
    test(`${screen.key} ${screen.path}`, async ({ browser, workerStorageState }, testInfo) => {
      const page = await pageBehind(browser, testInfo, screen.door, workerStorageState);
      try {
        if (screen.door === ScreenDoor.Platform) await platformSignIn(page);
        if (screen.door === ScreenDoor.Tenant && screen.addressedBy) await openScreen(page, "/dashboard");
        const target = screen.addressedBy ? screen.path.replace(ADDRESS_PLACEHOLDER, encodeURIComponent(await addressOf(page, screen.addressedBy))) : screen.path;

        const problems: Problem[] = [];
        collect(page, problems, () => "load", BENIGN_CONSOLE);
        const entry = asEntry(screen, target);
        if (screen.door === ScreenDoor.Tenant) {
          const settled = await openScreen(page, target);
          await checkLoadedScreen(page, entry, settled, problems);
          if (isPhone(testInfo)) await checkPhoneOverflow(page, problems);
        } else {
          await page.goto(target);
          const settled = await settle(page);
          await checkStandaloneScreen(page, target, settled, problems);
        }

        record(testInfo, entry, problems);
        expect(problems, `${screen.key} @ ${testInfo.project.name}:\n${format(problems)}`).toEqual([]);
      } finally {
        await page.context().close();
      }
    });
  }
});
