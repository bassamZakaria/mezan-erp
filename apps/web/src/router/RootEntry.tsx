import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useApi } from "../data/ApiContext";
import { isCloudSite } from "../landing/site";
import { fetchPublicPlans, PUBLIC_PLANS_QUERY_KEY } from "../signup/signup-api";
import { HydrateFallback } from "./HydrateFallback";

const LandingPage = lazy(async () => ({ default: (await import("../landing/LandingPage")).LandingPage }));

export function RootEntry({ app }: { app: ReactNode }) {
  const { session } = useApi();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const showLanding = session === null && pathname === "/" && isCloudSite();
  useEffect(() => {
    if (showLanding) void queryClient.prefetchQuery({ queryKey: PUBLIC_PLANS_QUERY_KEY, queryFn: fetchPublicPlans });
  }, [showLanding, queryClient]);
  if (showLanding) {
    return (
      <Suspense fallback={<HydrateFallback />}>
        <LandingPage />
      </Suspense>
    );
  }
  return app;
}
