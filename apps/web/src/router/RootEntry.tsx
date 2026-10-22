import { lazy, Suspense, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useApi } from "../data/ApiContext";
import { isCloudSite } from "../landing/site";

const LandingPage = lazy(async () => ({ default: (await import("../landing/LandingPage")).LandingPage }));

/** The cloud website's front door: a signed-out visitor at `/` sees the landing page; every other case is the app. */
export function RootEntry({ app }: { app: ReactNode }) {
  const { session } = useApi();
  const { pathname } = useLocation();
  if (session === null && pathname === "/" && isCloudSite()) {
    return (
      <Suspense fallback={null}>
        <LandingPage />
      </Suspense>
    );
  }
  return app;
}
