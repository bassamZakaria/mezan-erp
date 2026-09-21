import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LegalLinks } from "@/components/legal-links";
import { useStrings } from "@/i18n";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

interface MenuEntry {
  readonly title: string;
  readonly subtitle: string;
  readonly href: "/collect" | "/clock" | "/approvals";
}

export function More() {
  const strings = useStrings();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const entries: MenuEntry[] = [
    { title: strings.more.collect, subtitle: strings.more.collectSubtitle, href: "/collect" },
    { title: strings.more.clock, subtitle: strings.more.clockSubtitle, href: "/clock" },
    { title: strings.more.approvals, subtitle: strings.more.approvalsSubtitle, href: "/approvals" },
  ];

  return (
    <View style={[styles.flex, { backgroundColor: theme.background, paddingTop: insets.top + SPACE.lg }]}>
      <Text style={[styles.title, { color: theme.text }]}>{strings.more.title}</Text>
      <View style={styles.list}>
        {entries.map((entry) => (
          <Pressable
            accessibilityRole="button"
            key={entry.href}
            onPress={() => router.push(entry.href)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.rowTitle, { color: theme.text }]}>{entry.title}</Text>
            <Text style={[styles.rowSubtitle, { color: theme.textMuted }]}>{entry.subtitle}</Text>
          </Pressable>
        ))}
      </View>
      <LegalLinks />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontSize: TYPE.display, fontWeight: "800", paddingHorizontal: SPACE.lg, marginBottom: SPACE.md },
  list: { paddingHorizontal: SPACE.lg, gap: SPACE.md },
  row: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACE.lg, gap: SPACE.xs, minHeight: 64 },
  rowTitle: { fontSize: TYPE.body, fontWeight: "700" },
  rowSubtitle: { fontSize: TYPE.caption },
});
