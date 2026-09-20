import { StyleSheet, Text, View } from "react-native";
import { formatAmountWithCurrency, isNegative } from "@/money";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

interface StatTileProps {
  readonly label: string;
  readonly amount: string;
  readonly emphasiseNegative?: boolean;
}

export function StatTile({ label, amount, emphasiseNegative = false }: StatTileProps) {
  const theme = useTheme();
  const negative = emphasiseNegative && isNegative(amount);
  return (
    <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.label, { color: theme.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        numberOfLines={1}
        style={[styles.amount, { color: negative ? theme.negative : theme.text }]}
      >
        {formatAmountWithCurrency(amount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACE.lg, gap: SPACE.xs },
  label: { fontSize: TYPE.caption },
  amount: { fontSize: TYPE.title, fontWeight: "700" },
});
