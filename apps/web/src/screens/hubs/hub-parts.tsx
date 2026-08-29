import { Button } from "@mezan/ui";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../router/screens";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * The two fragments every workspace hub repeated verbatim, beside the shared
 * `WorkspaceHub` frame in `@mezan/ui`. They live here rather than in the
 * package because both need the app's router and its translation catalogue.
 */

export interface HubAction {
  readonly label: AppTranslationKey;
  readonly screen: ScreenKey;
}

/**
 * A hub's verbs. Each opens the create flow — landing on the list would just be
 * the screens bar one pixel above, drawn a second time.
 */
export function HubActions({ actions }: { actions: readonly HubAction[] }) {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  return (
    <>
      {actions.map((action, index) => (
        <Button
          key={action.screen}
          size="sm"
          variant={index === 0 ? "primary" : "default"}
          onClick={() => navigate(action.screen, "create")}
        >
          {t(action.label)}
        </Button>
      ))}
    </>
  );
}

/** The quiet second line under a hub row: the document's date, then its number. */
export function DateAndDoc({ date, docNo }: { date: string; docNo?: string | null }) {
  return (
    <>
      <span className="mz-num">{date}</span>
      {docNo ? <span className="mz-lat"> · {docNo}</span> : null}
    </>
  );
}
