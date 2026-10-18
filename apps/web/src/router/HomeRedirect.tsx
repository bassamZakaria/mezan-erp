import { Navigate } from "react-router";
import { useApi } from "../data/ApiContext";
import { sessionHolds, type Session } from "../data/session";
import { GLANCE_PERMISSION } from "../screens/enh/glance/permission";

const DASHBOARD_PERMISSION = "dashboard.view";
export const GLANCE_HOME_PATH = "/glance";

export function isGlanceOnly(session: Session | null): boolean {
  return sessionHolds(session, GLANCE_PERMISSION) && !sessionHolds(session, DASHBOARD_PERMISSION);
}

export function HomeRedirect() {
  const { session } = useApi();
  return <Navigate to={isGlanceOnly(session) ? GLANCE_HOME_PATH : "/dashboard"} replace />;
}
