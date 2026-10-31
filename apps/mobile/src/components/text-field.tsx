import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly secureTextEntry?: boolean;
  readonly maxLength?: number;
  readonly autoCapitalize?: "none" | "sentences" | "words" | "characters";
  readonly editable?: boolean;
  readonly testID?: string;
}

export function TextField({
  label,
  value,
  onChangeText,
  hint,
  placeholder,
  keyboardType,
  secureTextEntry,
  maxLength,
  autoCapitalize = "none",
  editable = true,
  testID,
}: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        keyboardType={keyboardType}
        maxLength={maxLength}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        secureTextEntry={secureTextEntry}
        testID={testID}
        style={[
          styles.input,
          { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text, textAlign: "auto" },
        ]}
        value={value}
      />
      {hint === undefined ? null : <Text style={[styles.hint, { color: theme.textMuted }]}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACE.xs },
  label: { fontSize: TYPE.label, fontWeight: "600" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
    fontSize: TYPE.body,
  },
  hint: { fontSize: TYPE.caption },
});
