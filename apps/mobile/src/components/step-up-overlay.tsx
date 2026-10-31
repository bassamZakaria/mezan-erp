import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, ButtonTone } from "@/components/button";
import { TextField } from "@/components/text-field";
import { useStrings } from "@/i18n";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

interface StepUpOverlayProps {
  readonly message: string;
  readonly onConfirm: (password: string) => Promise<string | null>;
  readonly onCancel: () => void;
}

export function StepUpOverlay({ message, onConfirm, onCancel }: StepUpOverlayProps) {
  const strings = useStrings();
  const theme = useTheme();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    if (busy || password === "") return;
    setBusy(true);
    setError(null);
    const refusal = await onConfirm(password);
    setBusy(false);
    if (refusal !== null) {
      setError(refusal);
      setPassword("");
    }
  };

  return (
    <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>{strings.stepUp.title}</Text>
        <Text style={[styles.message, { color: theme.textMuted }]}>{message}</Text>
        <TextField
          label={strings.stepUp.password}
          onChangeText={setPassword}
          secureTextEntry
          testID="step-up-password"
          value={password}
        />
        {error ? <Text style={[styles.error, { color: theme.negative }]}>{error}</Text> : null}
        <Button busy={busy} disabled={password === ""} label={strings.stepUp.confirm} onPress={() => void confirm()} testID="step-up-confirm" />
        <Button disabled={busy} label={strings.common.cancel} onPress={onCancel} testID="step-up-cancel" tone={ButtonTone.Quiet} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", padding: SPACE.lg },
  card: { alignSelf: "stretch", borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, gap: SPACE.md, padding: SPACE.lg },
  title: { fontSize: TYPE.title, fontWeight: "700" },
  message: { fontSize: TYPE.body },
  error: { fontSize: TYPE.body },
});
