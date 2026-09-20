import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";

export const CACHE_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7;

const CACHE_KEY = "mezan.query-cache";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 30,
      gcTime: CACHE_LIFETIME_MS,
    },
    // Writing needs the server: the ledger is the single writer, and a queued
    // document would have to decide its own number and period, which it cannot.
    mutations: { retry: 0, networkMode: "online" },
  },
});

export const queryPersister = createAsyncStoragePersister({ storage: AsyncStorage, key: CACHE_KEY });

/**
 * SECURITY: the cache is keyed by query, not by user or tenant, and it
 * OUTLIVES the session on disk. Without this every figure the last person to
 * sign in on this phone read — cash, receivables, customer balances — is
 * served to the next one, including a user the server would refuse.
 */
export async function forgetCachedReads(): Promise<void> {
  queryClient.clear();
  await queryPersister.removeClient();
}
