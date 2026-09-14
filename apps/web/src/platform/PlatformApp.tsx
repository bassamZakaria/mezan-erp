import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { PlatformApiProvider, usePlatformApi, type PlatformApiProviderProps } from "./api";
import { PlatformLogin } from "./PlatformLogin";
import { PlatformShell } from "./PlatformShell";

function PlatformDoor() {
  const { session } = usePlatformApi();
  const location = useLocation();
  const navigate = useNavigate();

  // A signed-in operator who lands (or is left, after login navigates away
  // and the browser back button returns) on the login path belongs in the
  // shell, never on a blank door.
  useEffect(() => {
    if (session && location.pathname === "/platform/login") {
      navigate("/platform/tenants", { replace: true });
    }
  }, [session, location.pathname, navigate]);

  return session ? <PlatformShell /> : <PlatformLogin />;
}

export interface PlatformAppProps {
  /** Test seam: inject a fake transport / seeded session instead of the platform default. */
  readonly transport?: PlatformApiProviderProps["transport"];
  readonly initialSession?: PlatformApiProviderProps["initialSession"];
}

/**
 * The platform console's root, mounted at `/platform/*` as a sibling of the
 * tenant app route (`router/routes.tsx`) — a door of its own, not a screen
 * inside `AppLayout`. It carries its own session (a platform operator is
 * never a tenant user) but rides on the surrounding `AppI18nProvider` and
 * `QueryClientProvider` from `main.tsx`, so translations and query caching
 * behave exactly as the rest of the app does.
 */
export function PlatformApp({ transport, initialSession }: PlatformAppProps = {}) {
  return (
    <PlatformApiProvider transport={transport} initialSession={initialSession}>
      <PlatformDoor />
    </PlatformApiProvider>
  );
}
