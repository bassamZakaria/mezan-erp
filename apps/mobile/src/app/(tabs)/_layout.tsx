import { Redirect, Tabs } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useStrings, type Strings } from "@/i18n";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme";

enum TabRoute {
  Home = "index",
  Customers = "customers",
  Sell = "sell",
  Stock = "stock",
  More = "more",
}

interface TabSpec {
  readonly route: TabRoute;
  readonly title: (strings: Strings) => string;
  readonly icon: SymbolViewProps["name"];
}

/**
 * Every glyph here is symbolic, not directional, so none of them mirrors in
 * RTL. A tab that ever takes an arrow or a chevron needs the RTL variant.
 */
const TABS: readonly TabSpec[] = [
  { route: TabRoute.Home, title: (s) => s.tabs.home, icon: { ios: "house", android: "home", web: "home" } },
  { route: TabRoute.Customers, title: (s) => s.tabs.customers, icon: { ios: "person.2", android: "group", web: "group" } },
  { route: TabRoute.Sell, title: (s) => s.tabs.sell, icon: { ios: "doc.text", android: "receipt_long", web: "receipt_long" } },
  { route: TabRoute.Stock, title: (s) => s.tabs.stock, icon: { ios: "shippingbox", android: "inventory_2", web: "inventory_2" } },
  { route: TabRoute.More, title: (s) => s.tabs.more, icon: { ios: "ellipsis.circle", android: "more_horiz", web: "more_horiz" } },
];

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
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.route}
          name={tab.route}
          options={{
            title: tab.title(strings),
            tabBarButtonTestID: `tab-${tab.route}`,
            tabBarIcon: ({ color, size }) => <SymbolView name={tab.icon} size={size} tintColor={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
