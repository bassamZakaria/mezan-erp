import { QueryClient } from "@tanstack/react-query";

/** The app-wide TanStack Query client. Retries off — a local/in-process backend either answers or has a real error worth surfacing. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
}
