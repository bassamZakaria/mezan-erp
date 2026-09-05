import { useLicenseState } from "./data/license-hooks";
import { useAppTranslation } from "./i18n";

/**
 * Persistent license banner shown above every screen when the license is not
 * cleanly ACTIVE (docs/archive/plan.md §2.5). It INFORMS; enforcement is the
 * server-side write-gate. The message escalates with the state:
 *   - GRACE: amber, still writable — a countdown to renew before postings stop.
 *   - READ_ONLY / UNLICENSED / unauthentic: red — data viewable, writes blocked.
 * ACTIVE renders nothing.
 */
export function LicenseBanner() {
  const { t, locale } = useAppTranslation();
  const query = useLicenseState();
  const license = query.data;
  if (!license || license.state === "ACTIVE") return null;

  const isGrace = license.state === "GRACE";
  const tone = isGrace
    ? "border-warning bg-warning-soft text-warning-ink"
    : "border-danger bg-danger-soft text-danger-ink";

  let title: string;
  let body: string;
  if (isGrace) {
    const date = license.graceEndsAt
      ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "long" }).format(
          new Date(license.graceEndsAt),
        )
      : "";
    title = t("license.banner.grace.title");
    body = t("license.banner.grace.body", { date });
  } else if (license.state === "UNLICENSED") {
    title = t("license.banner.unlicensed.title");
    body = t("license.banner.unlicensed.body");
  } else if (license.state === "READ_ONLY") {
    title = t("license.banner.readonly.title");
    body = t("license.banner.readonly.body");
  } else {
    title = t("license.banner.invalid.title");
    body = t("license.banner.invalid.body");
  }

  return (
    <div
      role="alert"
      className={`mb-[16px] rounded-md border px-[14px] py-[10px] text-[12.5px] ${tone}`}
    >
      <div className="font-semibold">{title}</div>
      <div className="mt-[2px]">{body}</div>
    </div>
  );
}
