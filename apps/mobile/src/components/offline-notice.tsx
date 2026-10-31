import { StyleSheet, Text } from "react-native";
import { useOffline } from "@/hooks/use-offline";
import { useStrings } from "@/i18n";
import { TYPE, useTheme } from "@/theme";

/** Shown on every screen that writes: with no write queue, a document entered offline is a document that did not happen. */
export function OfflineNotice() {
  const strings = useStrings();
  const theme = useTheme();
  const offline = useOffline();
  if (!offline) return null;
  return <Text style={[styles.notice, { color: theme.warning }]}>{strings.common.offlineWrite}</Text>;
}

const styles = StyleSheet.create({
  notice: { fontSize: TYPE.label, fontWeight: "600" },
});
