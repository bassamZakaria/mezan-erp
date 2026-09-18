import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { horizontalOverflow, offendingElements, OVERFLOW_TOLERANCE } from "./support/overflow";
import { loadScreenCatalog, type ScreenEntry } from "./support/screen-catalog";

const SCREENS = loadScreenCatalog();
const FINDINGS_FILE = path.resolve("e2e-results/every-screen-findings.jsonl");

type Cause =
  | "404"
  | "app error"
  | "uncaught page error"
  | "console error"
  | "api error"
  | "empty list"
  | "stuck loading"
  | "no heading"
  | "redirected"
  | "phone overflow"
  | "drawer";

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
    problems.push({ cause: "redirected", detail: `asked for ${screen.path}, landed on ${pathname}` });
  }

  const body = page.locator("body");
  const bodyText = (await body.innerText().catch(() => "")) ?? "";
  if (bodyText.includes("الصفحة غير موجودة")) {
    problems.push({ cause: "404", detail: `«الصفحة غير موجودة» at ${pathname}` });
  }
  if (bodyText.includes("تعذّر عرض هذه الشاشة") || bodyText.includes("حدث خطأ")) {
    const pre = await page.locator("[role=alert] pre").first().innerText().catch(() => "");
    problems.push({ cause: "app error", detail: `error boundary: ${pre || "(no detail)"}` });
  }

  const main = page.locator("main").first();
  if (!(await main.isVisible().catch(() => false))) {
    problems.push({ cause: "app error", detail: "no visible <main> landmark" });
    return;
  }

  const mainText = (await main.innerText().catch(() => "")) ?? "";
  const loadFailures = mainText.split("\n").filter((line) => /تعذّر تحميل|تعذر تحميل/.test(line));
  for (const line of [...new Set(loadFailures)]) problems.push({ cause: "app error", detail: `load failure shown: «${line.trim()}»` });

  if (!settled) problems.push({ cause: "stuck loading", detail: "skeleton still on screen after 20s" });

  const headings = await main.locator("h1, h2, [role=heading]").count();
  if (headings === 0) problems.push({ cause: "no heading", detail: "main has no h1/h2/heading" });

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
    problems.push({ cause: "empty list", detail: what });
  }
}

async function checkPhoneOverflow(page: Page, problems: Problem[]): Promise<void> {
  const overflow = await horizontalOverflow(page);
  if (overflow > OVERFLOW_TOLERANCE) {
    const offenders = await offendingElements(page);
    problems.push({
      cause: "phone overflow",
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
    problems.push({ cause: "drawer", detail: "no «فتح قائمة التنقل» button on a phone viewport" });
    return;
  }
  await toggle.click();
  if (!(await rail.isVisible().catch(() => false))) {
    await expect(rail).toBeVisible({ timeout: 3_000 }).catch(() => undefined);
  }
  if (!(await rail.isVisible().catch(() => false))) {
    problems.push({ cause: "drawer", detail: "drawer did not open after tapping «فتح قائمة التنقل»" });
    return;
  }

  if (screen.key === "dashboard") {
    await rail.getByRole("button", { name: "لوحة التحكم", exact: true }).click();
  } else if (screen.inNav && screen.label && screen.groupLabel) {
    await rail.getByRole("button", { name: "كل الشاشات", exact: true }).click();
    const dialog = page.getByRole("dialog");
    if (!(await dialog.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false))) {
      problems.push({ cause: "drawer", detail: "«كل الشاشات» did not open from the drawer" });
      return;
    }
    const groupLabel = screen.groupLabel;
    const section = dialog.locator("section").filter({ has: page.locator("h3").getByText(groupLabel, { exact: true }) });
    const row = section.locator("button").filter({ has: page.locator("span.truncate").getByText(screen.label, { exact: true }) });
    const count = await row.count();
    if (count === 0) {
      problems.push({ cause: "drawer", detail: `«${screen.label}» not listed under «${groupLabel}» in «كل الشاشات»` });
      return;
    }
    if (count <= screen.labelOccurrence) {
      problems.push({ cause: "drawer", detail: `«${screen.label}» is listed ${count}× under «${groupLabel}», expected at least ${screen.labelOccurrence + 1}` });
      return;
    }
    const clicked = await row
      .nth(screen.labelOccurrence)
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch((e: Error) => {
        problems.push({ cause: "drawer", detail: `could not tap «${screen.label}»: ${e.message.split("\n")[0]}` });
        return false;
      });
    if (!clicked) return;
  } else {
    return;
  }

  await settle(page);
  const landed = new URL(page.url()).pathname;
  if (!landed.startsWith(screen.path)) {
    problems.push({ cause: "drawer", detail: `drawer navigation landed on ${landed}, expected ${screen.path}` });
  }
  if (await rail.isVisible().catch(() => false)) {
    problems.push({ cause: "drawer", detail: "drawer stayed open over the screen after navigating" });
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
    push({ cause: "uncaught page error", detail: `[${phaseOf()}] ${error.message}${where ? ` @ ${where.trim()}` : ""}` });
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (ignore.some((b) => b.pattern.test(text))) return;
    const loc = msg.location();
    const at = loc.url ? ` @ ${loc.url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "")}:${loc.lineNumber}` : "";
    push({ cause: "console error", detail: `[${phaseOf()}] ${text.slice(0, 400)}${at}` });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/") || response.status() < 400) return;
    push({
      cause: "api error",
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
