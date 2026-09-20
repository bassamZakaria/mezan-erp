import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme";

export default function Index() {
  const { ready, session } = useSession();
  const theme = useTheme();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }
  return <Redirect href={session ? "/(tabs)" : "/sign-in"} />;
}
