import { useRouter } from "expo-router";
import { Children, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { LegalLinks } from "@/components/legal-links";
import { TextField } from "@/components/text-field";
import { describeApiError } from "@/api/errors";
import { useStrings } from "@/i18n";
import { SizeClass, useFormPadding, useSizeClass } from "@/layout";
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
  const paired = useSizeClass() !== SizeClass.Compact;

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

        <Pair paired={paired}>
          <TextField
            hint={strings.signIn.serverHint}
            keyboardType="url"
            label={strings.signIn.serverLabel}
            onChangeText={setBaseUrl}
            testID="sign-in-server"
            value={baseUrl}
          />
          <TextField
            hint={strings.signIn.tenantHint}
            label={strings.signIn.tenantLabel}
            onChangeText={setTenantCode}
            testID="sign-in-tenant"
            value={tenantCode}
          />
        </Pair>
        <Pair paired={paired}>
          <TextField
            keyboardType="email-address"
            label={strings.signIn.emailLabel}
            onChangeText={setEmail}
            testID="sign-in-email"
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
            testID="sign-in-pin"
            value={pin}
          />
        </Pair>

        {failure === null ? null : <Text style={[styles.failure, { color: theme.negative }]}>{failure}</Text>}

        <Button
          busy={busy}
          disabled={!complete}
          label={busy ? strings.signIn.submitting : strings.signIn.submit}
          onPress={submit}
          testID="sign-in-submit"
        />
        <LegalLinks />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Two fields to a row as soon as the window is wider than a phone in
 * portrait. On a phone in LANDSCAPE the keyboard leaves about 200dp of form
 * showing, and stacked fields put everything below the first one out of
 * reach; paired, the whole form fits.
 */
function Pair({ paired, children }: { paired: boolean; children: ReactNode }) {
  if (!paired) return <>{children}</>;
  return (
    <View style={styles.pair}>
      {Children.map(children, (child) => (
        <View style={styles.pairItem}>{child}</View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pair: { flexDirection: "row", gap: SPACE.md },
  pairItem: { flex: 1 },
  content: { gap: SPACE.lg },
  header: { gap: SPACE.xs, marginBottom: SPACE.md },
  brand: { fontSize: TYPE.display, fontWeight: "800" },
  title: { fontSize: TYPE.title, fontWeight: "700" },
  subtitle: { fontSize: TYPE.label },
  failure: { fontSize: TYPE.label, fontWeight: "600" },
});
