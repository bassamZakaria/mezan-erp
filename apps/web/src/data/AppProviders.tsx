import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useTheme } from "@mezan/ui";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import type { Session } from "./session";
import type { Transport } from "./transport";

export interface AppProvidersProps {
  readonly children: ReactNode;
  /** Test seam: inject a fake transport instead of the platform default. */
  readonly transport?: Transport;
  readonly initialSession?: Session | null;
}

/**
 * The app-wide providers: the interface language (which also owns the document
 * direction), TanStack Query, and the {@link ApiProvider} that holds the
 * session and the transport. Wraps the whole app in main.tsx; tests render it
 * with a fake `transport` (and optionally a seeded `initialSession`).
 */
export function AppProviders({ children, transport, initialSession }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient);
  useTheme();
  return (
    <AppI18nProvider>
      <QueryClientProvider client={queryClient}>
        <ApiProvider transport={transport} initialSession={initialSession}>
          {children}
        </ApiProvider>
      </QueryClientProvider>
    </AppI18nProvider>
  );
}
