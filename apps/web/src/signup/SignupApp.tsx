import { useLocation } from "react-router";
import { SignupScreen } from "./SignupScreen";
import { VerifyScreen } from "./VerifyScreen";
import { OwnerHandOverScreen } from "./OwnerHandOverScreen";

/**
 * The signup flow's own root, mounted at `/signup/*` as a sibling of the
 * tenant app and platform console routes (`router/routes.tsx`) — a public
 * page with no session at all, riding on the surrounding `AppI18nProvider`
 * and `QueryClientProvider` from `main.tsx` for language and query caching.
 */
export function SignupApp() {
  const location = useLocation();
  if (location.pathname.startsWith("/signup/owner-handover")) return <OwnerHandOverScreen />;
  return location.pathname.startsWith("/signup/verify") ? <VerifyScreen /> : <SignupScreen />;
}
