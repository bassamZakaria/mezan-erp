import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { formatAmountWithCurrency, isNegative } from "@/money";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

interface StatTileProps {
  readonly label: string;
  readonly amount: string;
  readonly emphasiseNegative?: boolean;
  readonly basis?: ViewStyle["flexBasis"];
}

export function StatTile({ label, amount, emphasiseNegative = false, basis }: StatTileProps) {
  const theme = useTheme();
  const negative = emphasiseNegative && isNegative(amount);
  return (
    <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border, flexBasis: basis }]}>
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

export function CountTile({
  label,
  count,
  onPress,
  basis,
}: {
  label: string;
  count: number;
  onPress: () => void;
  basis?: ViewStyle["flexBasis"];
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: theme.surface, borderColor: theme.border, flexBasis: basis, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.label, { color: theme.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.amount, { color: count > 0 ? theme.brand : theme.text }]}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACE.lg, gap: SPACE.xs },
  label: { fontSize: TYPE.caption },
  amount: { fontSize: TYPE.title, fontWeight: "700" },
});
