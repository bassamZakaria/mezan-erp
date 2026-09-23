import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CACHE_LIFETIME_MS, queryClient, queryPersister } from "@/api/query-cache";
import { UnlockOverlay } from "@/components/unlock-overlay";
import { SessionProvider, useSession } from "@/session/SessionProvider";
import { useStrings } from "@/i18n";
import { applyLayoutDirection } from "@/rtl";
import { useTheme } from "@/theme";

export default function RootLayout() {
  const strings = useStrings();
  const theme = useTheme();

  useEffect(() => {
    applyLayoutDirection().catch((error: unknown) => {
      console.warn("[mezan] layout direction could not be applied", error);
    });
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister, maxAge: CACHE_LIFETIME_MS }}
    >
      <SessionProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.surface },
              headerTintColor: theme.text,
              contentStyle: { backgroundColor: theme.background },
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: strings.appName }} />
          </Stack>
          <DeviceLock />
        </SafeAreaProvider>
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}

function DeviceLock() {
  const { session, locked } = useSession();
  return session !== null && locked ? <UnlockOverlay /> : null;
}
