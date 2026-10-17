import { Navigate } from "react-router";
import { useApi } from "../data/ApiContext";
import { sessionHolds } from "../data/session";
import { GLANCE_PERMISSION } from "../screens/enh/glance/permission";

const DASHBOARD_PERMISSION = "dashboard.view";

export function HomeRedirect() {
  const { session } = useApi();
  const glanceOnly = sessionHolds(session, GLANCE_PERMISSION) && !sessionHolds(session, DASHBOARD_PERMISSION);
  return <Navigate to={glanceOnly ? "/glance" : "/dashboard"} replace />;
}
