import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAppTranslation } from "../i18n";
import { pairing, pairingSupported } from "../lan/pairing-bridge";

/**
 * «الاتصال بجهاز رئيسي» on the login screen, and the ONE way into pairing that
 * a shop can find without a consultant.
 *
 * IT RENDERS ON ALMOST NO MACHINE, which is the point. `mayPair` is true only
 * on a desktop install that holds no books yet — nobody has claimed the tenant
 * — so it cannot appear on a shop's live host and offer to turn the machine
 * holding the ledger into a till. On a client it is absent because the machine
 * is already paired, and on the browser build because there is no such thing.
 */
export function PairHostLink() {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!pairingSupported()) return;
    let live = true;
    void pairing({ kind: "state" })
      .then((res) => {
        if (live && res?.kind === "state") setVisible(res.mayPair);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => void navigate("/pair-host")}
      className="text-ink-muted hover:underline"
    >
      {t("pair.link")}
    </button>
  );
}
