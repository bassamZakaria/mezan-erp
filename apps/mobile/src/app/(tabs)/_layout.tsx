import { Redirect, Tabs } from "expo-router";
import { useStrings } from "@/i18n";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme";

export default function TabsLayout() {
  const strings = useStrings();
  const theme = useTheme();
  const { ready, session } = useSession();

  if (ready && !session) return <Redirect href="/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: strings.tabs.home }} />
      <Tabs.Screen name="customers" options={{ title: strings.tabs.customers }} />
    </Tabs>
  );
}
