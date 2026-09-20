import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

export enum ButtonTone {
  Brand = "brand",
  Quiet = "quiet",
  Danger = "danger",
}

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: ButtonTone;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly style?: ViewStyle;
}

export function Button({ label, onPress, tone = ButtonTone.Brand, disabled, busy, style }: ButtonProps) {
  const theme = useTheme();
  const background =
    tone === ButtonTone.Brand ? theme.brand : tone === ButtonTone.Danger ? theme.negative : theme.surfaceMuted;
  const color = tone === ButtonTone.Quiet ? theme.text : theme.brandText;
  const inactive = disabled === true || busy === true;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: busy === true }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: background, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy === true ? <ActivityIndicator color={color} /> : <Text style={[styles.label, { color }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.lg,
  },
  label: { fontSize: TYPE.body, fontWeight: "600" },
});
