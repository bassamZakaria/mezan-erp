import * as Linking from "expo-linking";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PUBLIC_SITE_URL } from "@/config";
import { LegalPage, legalUrl } from "@/domain/legal";
import { activeLocale, useStrings } from "@/i18n";
import { SPACE, TYPE, useTheme } from "@/theme";

export function LegalLinks() {
  const strings = useStrings();
  const theme = useTheme();
  const locale = activeLocale();
  const links = [
    { page: LegalPage.Privacy, label: strings.legal.privacy },
    { page: LegalPage.AccountDeletion, label: strings.legal.accountDeletion },
  ];
  return (
    <View style={styles.row}>
      {links.map((link) => (
        <Pressable
          accessibilityRole="link"
          hitSlop={SPACE.sm}
          key={link.page}
          onPress={() => {
            void Linking.openURL(legalUrl(PUBLIC_SITE_URL, link.page, locale));
          }}
        >
          <Text style={[styles.link, { color: theme.brand }]}>{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: SPACE.lg, paddingVertical: SPACE.sm },
  link: { fontSize: TYPE.label, fontWeight: "600", textDecorationLine: "underline" },
});
