import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { LegalLinks } from "@/components/legal-links";
import { TextField } from "@/components/text-field";
import { describeApiError } from "@/api/errors";
import { useStrings } from "@/i18n";
import { useFormPadding } from "@/layout";
import { useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

const PIN_LENGTH = 6;

export function SignIn() {
  const strings = useStrings();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { connection, signIn } = useSession();
  const formPadding = useFormPadding();

  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [tenantCode, setTenantCode] = useState(connection.tenantCode ?? "");
  const [email, setEmail] = useState(connection.email ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const complete = baseUrl.trim().length > 0 && email.trim().length > 0 && pin.length === PIN_LENGTH;

  const submit = (): void => {
    if (busy || !complete) return;
    setBusy(true);
    setFailure(null);
    void signIn({
      baseUrl: baseUrl.trim(),
      tenantCode: tenantCode.trim() === "" ? null : tenantCode.trim(),
      email: email.trim(),
      pin,
    })
      .then(() => {
        router.replace("/(tabs)");
      })
      .catch((error: unknown) => {
        setFailure(describeApiError(error, strings));
        setPin("");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          formPadding,
          { paddingTop: insets.top + SPACE.xxl, paddingBottom: insets.bottom + SPACE.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={[styles.brand, { color: theme.brand }]}>{strings.appName}</Text>
          <Text style={[styles.title, { color: theme.text }]}>{strings.signIn.title}</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>{strings.signIn.subtitle}</Text>
        </View>

        <TextField
          hint={strings.signIn.serverHint}
          keyboardType="url"
          label={strings.signIn.serverLabel}
          onChangeText={setBaseUrl}
          value={baseUrl}
        />
        <TextField
          hint={strings.signIn.tenantHint}
          label={strings.signIn.tenantLabel}
          onChangeText={setTenantCode}
          value={tenantCode}
        />
        <TextField
          keyboardType="email-address"
          label={strings.signIn.emailLabel}
          onChangeText={setEmail}
          value={email}
        />
        <TextField
          keyboardType="number-pad"
          label={strings.signIn.pinLabel}
          maxLength={PIN_LENGTH}
          onChangeText={(next) => {
            setPin(next.replace(/\D/g, ""));
          }}
          secureTextEntry
          value={pin}
        />

        {failure === null ? null : <Text style={[styles.failure, { color: theme.negative }]}>{failure}</Text>}

        <Button busy={busy} disabled={!complete} label={busy ? strings.signIn.submitting : strings.signIn.submit} onPress={submit} />
        <LegalLinks />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: SPACE.lg },
  header: { gap: SPACE.xs, marginBottom: SPACE.md },
  brand: { fontSize: TYPE.display, fontWeight: "800" },
  title: { fontSize: TYPE.title, fontWeight: "700" },
  subtitle: { fontSize: TYPE.label },
  failure: { fontSize: TYPE.label, fontWeight: "600" },
});
