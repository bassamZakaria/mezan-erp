import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ButtonTone } from "@/components/button";
import { useStrings } from "@/i18n";
import { useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

export function UnlockOverlay() {
  const strings = useStrings();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, unlock, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);

  const confirm = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    const confirmed = await unlock(strings.signIn.unlockPrompt, strings.signIn.unlockWithPassword);
    setBusy(false);
    if (!confirmed) setFailed(true);
  }, [strings, unlock]);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void confirm();
  }, [confirm]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: theme.background, paddingTop: insets.top + SPACE.xxl }]}>
      <Text style={[styles.brand, { color: theme.brand }]}>{strings.appName}</Text>
      <Text style={[styles.title, { color: theme.text }]}>{strings.signIn.unlockTitle}</Text>
      <Text style={[styles.name, { color: theme.text }]}>{session?.nameAr ?? ""}</Text>
      <Text style={[styles.explainer, { color: theme.textMuted }]}>{strings.signIn.unlockExplainer}</Text>
      {failed ? <Text style={[styles.failure, { color: theme.negative }]}>{strings.signIn.unlockFailed}</Text> : null}
      <Button
        busy={busy}
        label={strings.signIn.unlockWithBiometrics}
        onPress={() => {
          void confirm();
        }}
      />
      <Button
        disabled={busy}
        label={strings.signIn.unlockWithPassword}
        onPress={() => {
          void signOut().then(() => router.replace("/sign-in"));
        }}
        tone={ButtonTone.Quiet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACE.lg, gap: SPACE.lg },
  brand: { fontSize: TYPE.display, fontWeight: "800" },
  title: { fontSize: TYPE.title, fontWeight: "700" },
  name: { fontSize: TYPE.body, fontWeight: "600" },
  explainer: { fontSize: TYPE.label },
  failure: { fontSize: TYPE.label, fontWeight: "600" },
});
