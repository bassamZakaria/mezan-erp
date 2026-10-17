import { Button } from "@mezan/ui";
import { useNavigation, useSubPageNames } from "./navigation";
import { groupKeyForScreen, hubScreenForGroup } from "./routing";
import { useAppTranslation, type AppTranslationKey } from "./i18n";
import type { ScreenKey } from "./router/screens";

interface Crumb {
  label: string;
  onClick?: () => void;
}

/**
 * A screen whose first segment names a TAB (`#/stock/items/templates`) would
 * otherwise print that key raw in an Arabic breadcrumb. Document ids and
 * numbers still print as themselves — they are already the name of the thing.
 */
const SEGMENT_LABEL_KEY: Record<string, AppTranslationKey> = {
  new: "breadcrumb.new",
  print: "salesInvoices.share.print",
  templates: "items.tabs.templates",
  configurable: "items.tabs.configurable",
  specs: "items.tabs.specs",
  boms: "items.tabs.boms",
  ledger: "inventoryReports.view.ledger",
  movement: "inventoryReports.view.movement",
  valuation: "inventoryReports.view.valuation",
  drift: "inventoryReports.view.drift",
  aging: "inventoryReports.view.aging",
  expiring: "inventoryReports.view.expiring",
  "slow-moving": "inventoryReports.view.slowMoving",
  due: "recurringJournals.tab.due",
  history: "recurringJournals.tab.history",
  depreciation: "recurringJournals.tab.depreciation",
  "write-off": "expiry.tab.writeOff",
  alerts: "expiry.tab.alerts",
  fefo: "expiry.tab.fefo",
  recall: "expiry.tab.recall",
  settings: "expiry.tab.settings",
  reminders: "collections.tab.reminders",
  promises: "collections.tab.promises",
  policy: "collections.tab.policy",
  webhooks: "integrations.tab.webhooks",
  deliveries: "integrations.tab.deliveries",
  docs: "integrations.tab.docs",
  overrides: "pricingGuard.tab.overrides",
  policies: "reorder.tab.policies",
};

export const NAMED_SUB_PAGE_SEGMENTS: ReadonlySet<string> = new Set(Object.keys(SEGMENT_LABEL_KEY));

const NAMED_BY_ITS_SCREEN: ReadonlySet<ScreenKey> = new Set<ScreenKey>(["treasury-vouchers", "journals", "physical-counts", "price-lists", "site-issues", "sales-returns", "purchase-returns", "landed-costs"]);
const UNNAMED_YET = "…";

const SUB_PAGE_LABEL_KEY: Partial<Record<ScreenKey, AppTranslationKey>> = { "bank-reconciliation": "bankRec.reconcileABankStatement" };

function segmentLabel(segment: string, t: (key: AppTranslationKey) => string): string {
  const key = SEGMENT_LABEL_KEY[segment];
  return key ? t(key) : segment;
}

/**
 * Where «رجوع» lands from a sub-page: one level up. A create form is the
 * exception — everything after `new` is a prefill parameter, so dropping one
 * segment would re-open the same empty form and look like a dead button.
 */
export function parentSegments(segments: readonly string[]): string[] {
  if (segments.length === 0) return [];
  if (segments[0] === "new") return [];
  return segments.slice(0, -1);
}

function BackArrow() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="mz-back-arrow h-[13px] w-[13px] flex-none" fill="none">
      <path d="M9.5 3.5 5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The path back. Rendered by the shell above every screen, so a sub-page —
 * `#/sales/quotes/new`, `#/sales/quotes/QT-000004` — is never a place you can
 * only leave by pressing the browser's Back button. Each crumb but the last is
 * a real control: the module opens its hub, the screen name drops the
 * sub-page.
 *
 * «رجوع» LIVES HERE, and nowhere else. It used to be handed to
 * `DocumentDetail`'s `actions`, which put a navigation control in the same row
 * — same size, same weight — as «تأكيد» and «عكس القيد»: one slip away from
 * posting instead of leaving. Screens must not render their own back button
 * for a sub-page; the only ones that legitimately do are a not-found empty
 * state (where it is the recovery action) and the wizard's step-back.
 */
export function Breadcrumbs({ screen }: { screen: ScreenKey }) {
  const { t } = useAppTranslation();
  const { navigate, segments, openSubPage } = useNavigation();
  const names = useSubPageNames();

  if (screen === "dashboard") return null;
  // A third orientation row that restates the rail and the screens bar is not
  // orientation, it is repetition: on a top-level screen the crumbs read
  // exactly «لوحة التحكم · <workspace> · <the chip that is already lit>». It
  // earns its line only once a sub-page is open, which is the one state the
  // bar above cannot show.
  if (segments.length === 0) return null;

  const groupKey = groupKeyForScreen(screen);
  const crumbs: Crumb[] = [{ label: t("nav.item.dashboard"), onClick: () => navigate("dashboard") }];

  if (groupKey) {
    const hub = hubScreenForGroup(groupKey);
    crumbs.push({
      label: t(`nav.group.${groupKey}` as AppTranslationKey),
      onClick: hub ? () => navigate(hub as ScreenKey) : undefined,
    });
  }

  const screenLabel = t(`nav.item.${screen}` as AppTranslationKey);
  crumbs.push({
    label: screenLabel,
    // Only a control while a sub-page is open — otherwise it is where we are.
    onClick: segments.length > 0 ? () => openSubPage([]) : undefined,
  });

  for (const [i, segment] of segments.entries()) {
    // A sub-page is either the create form or a document, addressed by its
    // number. Anything after `new` is a prefill parameter — a reason code, an
    // item id — and printing it puts a raw enum in the Arabic breadcrumb.
    if (i > 0 && segments[0] === "new") break;
    const subPageKey = i === 0 ? SUB_PAGE_LABEL_KEY[screen] : undefined;
    const awaitsName = i === 0 && NAMED_BY_ITS_SCREEN.has(screen) && !(segment in SEGMENT_LABEL_KEY);
    crumbs.push({ label: names[segment] ?? (subPageKey ? t(subPageKey) : awaitsName ? UNNAMED_YET : segmentLabel(segment, t)), onClick: undefined });
    if (i > 0) break;
  }

  const back = parentSegments(segments);
  const backSegment = back[back.length - 1];
  const backTarget = backSegment !== undefined ? (names[backSegment] ?? segmentLabel(backSegment, t)) : screenLabel;

  return (
    <div className="mz-screen-only mb-[10px] flex flex-wrap items-center gap-[10px]">
      <Button
        size="sm"
        variant="ghost"
        className="gap-[6px] px-[9px] font-semibold"
        aria-label={t("breadcrumb.backTo", { target: backTarget })}
        onClick={() => openSubPage(back)}
      >
        <BackArrow />
        {t("breadcrumb.back")}
      </Button>
      <span aria-hidden className="h-[16px] w-px flex-none bg-border" />
      <nav aria-label={t("breadcrumb.label")}>
        <ol className="flex flex-wrap items-center gap-[6px] text-[11.5px] text-ink-muted">
          {crumbs.map((crumb, i) => (
            <li key={i} className="flex items-center gap-[6px]">
              {i > 0 ? (
                <span aria-hidden className="text-ink-faint">
                  ·
                </span>
              ) : null}
              {crumb.onClick ? (
                <button
                  type="button"
                  onClick={crumb.onClick}
                  // Gold is what marks "current" everywhere else in the shell — the screens
                  // bar, «كل الشاشات». Teal here made the same state two colours.
                  className="rounded-[4px] px-[2px] font-semibold text-ink-muted underline-offset-2 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="font-semibold text-ink" aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
