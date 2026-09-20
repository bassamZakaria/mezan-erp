import { Pressable, StyleSheet, Text, View } from "react-native";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <View style={[styles.track, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.segment, active ? { backgroundColor: theme.brand } : null]}
            >
              <Text style={[styles.segmentLabel, { color: active ? theme.brandText : theme.text }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACE.xs },
  label: { fontSize: TYPE.label, fontWeight: "600" },
  track: { flexDirection: "row", borderWidth: 1, borderRadius: RADIUS.md, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm },
  segmentLabel: { fontSize: TYPE.label, fontWeight: "600" },
});
