import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SPLIT_LIST_MAX_WIDTH } from "@/layout";
import { SPACE, TYPE, useTheme } from "@/theme";

/**
 * The list is rendered FIRST and the detail second, on a plain `row`. React
 * Native flips a row itself when `I18nManager.isRTL` is set, so the list lands
 * on the right in Arabic and on the left in English from the one declaration —
 * a `row-reverse` here would cancel that flip and put the list on the wrong
 * side in exactly one of the two locales.
 */
export function SplitView({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.split}>
      <View style={[styles.listPane, { borderEndColor: theme.border }]}>{list}</View>
      <View style={styles.detailPane}>{detail}</View>
    </View>
  );
}

export function SplitPlaceholder({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.placeholder}>
      <Text style={[styles.placeholderText, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flex: 1, flexDirection: "row" },
  listPane: { flex: 2, maxWidth: SPLIT_LIST_MAX_WIDTH, borderEndWidth: StyleSheet.hairlineWidth },
  detailPane: { flex: 3 },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACE.xl },
  placeholderText: { fontSize: TYPE.label, textAlign: "auto" },
});
