import { useNavigation } from "./navigation";
import { groupKeyForScreen, hubScreenForGroup } from "./routing";
import { useAppTranslation, type AppTranslationKey } from "./i18n";
import type { ScreenKey } from "./App";

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
  templates: "items.tabs.templates",
  configurable: "items.tabs.configurable",
  specs: "items.tabs.specs",
  ledger: "inventoryReports.view.ledger",
  movement: "inventoryReports.view.movement",
  valuation: "inventoryReports.view.valuation",
  drift: "inventoryReports.view.drift",
  aging: "inventoryReports.view.aging",
  expiring: "inventoryReports.view.expiring",
  "slow-moving": "inventoryReports.view.slowMoving",
};

function segmentLabel(segment: string, t: (key: AppTranslationKey) => string): string {
  const key = SEGMENT_LABEL_KEY[segment];
  return key ? t(key) : segment;
}

/**
 * The path back. Rendered by the shell above every screen, so a sub-page —
 * `#/sales/quotes/new`, `#/sales/quotes/QT-000004` — is never a place you can
 * only leave by pressing the browser's Back button. Each crumb but the last is
 * a real control: the module opens its hub, the screen name drops the
 * sub-page.
 */
export function Breadcrumbs({ screen }: { screen: ScreenKey }) {
  const { t } = useAppTranslation();
  const { navigate, segments, openSubPage } = useNavigation();

  if (screen === "dashboard") return null;

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
    crumbs.push({ label: segmentLabel(segment, t), onClick: undefined });
    if (i > 0) break;
  }

  return (
    <nav aria-label={t("breadcrumb.label")} className="mb-[10px]">
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
                className="rounded-[4px] px-[2px] font-semibold text-ink-muted underline-offset-2 hover:text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
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
  );
}
