import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {title === undefined ? null : <Text style={[styles.title, { color: theme.textMuted }]}>{title}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACE.lg, gap: SPACE.md },
  title: { fontSize: TYPE.label, fontWeight: "600" },
});
