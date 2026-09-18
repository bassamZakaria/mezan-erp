import { Card } from "@mezan/ui";
import { ConnectedDevicesPanel, LicenceStatusNotice } from "../lan/ConnectedDevicesPanel";
import { isDesktopHost } from "../data/hooks";
import { useAppTranslation } from "../i18n";

/**
 * الأجهزة المتصلة — the LAN multi-till seat panel, as a routed screen.
 *
 * The panel itself has existed since the LAN work landed and was reachable
 * from NOWHERE: `grep ConnectedDevicesPanel` found only its own test. So
 * freeing a seat — which a stuck till at the counter blocks every other till
 * on until somebody does — had no control surface in the shipped product at
 * all, and the API route that does it was permission-gated against a screen
 * that did not exist.
 *
 * The licence notice sits ABOVE the panel because it explains the panel: an
 * install with no licence, or one past its expiry, is why the seat count reads
 * zero and why no till can connect — and until it was rendered anywhere, that
 * was a state the product entered without ever saying so.
 */
export function ConnectedDevicesScreen() {
  const { t } = useAppTranslation();
  // Only the desktop app mounts `/lan/*` (createApp's `lan` option); the cloud
  // server has no such routes, so the panel must not be mounted there at all.
  const desktop = isDesktopHost();
  return (
    <div className="p-[20px]">
      <h1 className="mb-[4px] font-display text-[18px] font-bold text-ink">{t("nav.item.devices")}</h1>
      {desktop ? (
        <>
          <p className="mb-[16px] text-[12.5px] text-ink-muted">{t("devices.screenHint")}</p>
          <LicenceStatusNotice />
          <ConnectedDevicesPanel />
        </>
      ) : (
        <Card className="mt-[12px] p-[18px]">
          <p className="text-[12.5px] text-ink-muted">{t("devices.desktopOnly")}</p>
        </Card>
      )}
    </div>
  );
}
