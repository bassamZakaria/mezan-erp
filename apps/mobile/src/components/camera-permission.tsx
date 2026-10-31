import { useCameraPermissions } from "expo-camera";
import { useEffect } from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/button";
import { useStrings } from "@/i18n";
import { SPACE, TYPE, useTheme } from "@/theme";

export enum CameraAccess {
  Unknown = "unknown",
  Granted = "granted",
  Askable = "askable",
  Refused = "refused",
}

/**
 * Once iOS or Android records a refusal, `requestPermission` resolves
 * silently without showing anything, so the only way forward is the system
 * Settings screen. The permission is re-read on every return to the app,
 * because that is where the user comes back from Settings.
 */
export function useCameraAccess(): { access: CameraAccess; request: () => void } {
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission();
    });
    return () => subscription.remove();
  }, [getPermission]);

  const access =
    permission === null
      ? CameraAccess.Unknown
      : permission.granted
        ? CameraAccess.Granted
        : permission.canAskAgain
          ? CameraAccess.Askable
          : CameraAccess.Refused;

  return {
    access,
    request: () => {
      void requestPermission();
    },
  };
}

export function CameraPermissionPrompt({ reason, access, request }: { reason: string; access: CameraAccess; request: () => void }) {
  const strings = useStrings();
  const theme = useTheme();
  const refused = access === CameraAccess.Refused;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.background }]}>
      <Text style={[styles.reason, { color: theme.text }]}>{reason}</Text>
      {refused ? <Text style={[styles.detail, { color: theme.textMuted }]}>{strings.camera.denied}</Text> : null}
      <Button
        disabled={access === CameraAccess.Unknown}
        label={refused ? strings.camera.openSettings : strings.camera.grant}
        onPress={() => {
          if (refused) void Linking.openSettings();
          else request();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACE.md, padding: SPACE.lg },
  reason: { fontSize: TYPE.label, fontWeight: "600", textAlign: "center" },
  detail: { fontSize: TYPE.label, textAlign: "center" },
});
