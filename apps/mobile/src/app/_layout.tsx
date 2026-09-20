import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/session/SessionProvider";
import { applyLayoutDirection } from "@/rtl";
import { useTheme } from "@/theme";

const CACHE_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7;

const queryClient = new QueryClient({
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

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "mezan.query-cache" });

export default function RootLayout() {
  const theme = useTheme();

  useEffect(() => {
    void applyLayoutDirection();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: CACHE_LIFETIME_MS }}
    >
      <SessionProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.surface },
              headerTintColor: theme.text,
              contentStyle: { backgroundColor: theme.background },
            }}
          >
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </SafeAreaProvider>
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}
