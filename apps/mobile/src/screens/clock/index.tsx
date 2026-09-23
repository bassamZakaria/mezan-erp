import { SelfClockActionDTO } from "@mezan/contracts";
import { CameraView } from "expo-camera";
import { useRef, useState } from "react";
import { Image, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, ButtonTone } from "@/components/button";
import { Card } from "@/components/card";
import { CameraAccess, CameraPermissionPrompt, useCameraAccess } from "@/components/camera-permission";
import { describeWriteError } from "@/api/errors";
import { useSelfClockPunch, useSelfClockStatus } from "@/api/queries";
import { useStrings } from "@/i18n";
import { useFormPadding } from "@/layout";
import { useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

interface Selfie {
  readonly contentBase64: string;
  readonly mimeType: string;
}

export function Clock() {
  const strings = useStrings();
  const theme = useTheme();
  const { can } = useSession();
  const allowed = can("hr.self.clock");
  const formPadding = useFormPadding();

  const status = useSelfClockStatus(allowed);
  const punch = useSelfClockPunch();

  const [selfie, setSelfie] = useState<Selfie | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const camera = useCameraAccess();
  const cameraRef = useRef<CameraView>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function capture() {
    const picture = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.5 });
    if (!picture?.base64) return;
    setSelfie({ contentBase64: picture.base64, mimeType: picture.format === "png" ? "image/png" : "image/jpeg" });
    setCameraOpen(false);
  }

  async function submit(action: SelfClockActionDTO) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await punch.mutateAsync({ action, selfie: selfie ?? undefined });
      const time = action === SelfClockActionDTO.In ? result.entry.checkIn : result.entry.checkOut;
      setNotice(
        `${action === SelfClockActionDTO.In ? strings.clock.punchedIn : strings.clock.punchedOut} — ${time ?? ""}`,
      );
      setSelfie(null);
    } catch (err) {
      setError(describeWriteError(err, strings));
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Text style={[styles.notice, { color: theme.negative }]}>{strings.clock.noPermission}</Text>
      </View>
    );
  }

  if (status.isLoading) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Text style={[styles.notice, { color: theme.textMuted }]}>{strings.common.loading}</Text>
      </View>
    );
  }

  if (status.data === undefined || status.data.employeeId === null) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Text style={[styles.notice, { color: theme.textMuted }]}>{strings.clock.notLinked}</Text>
      </View>
    );
  }

  const data = status.data;
  const action = data.openEntry ? SelfClockActionDTO.Out : SelfClockActionDTO.In;
  const dayComplete = !data.openEntry && data.todayEntry?.checkIn != null && data.todayEntry?.checkOut != null;
  const selfieReady = !data.requireSelfie || selfie !== null;
  const canSubmit = !data.requireBiometric && selfieReady && !dayComplete;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        formPadding,
        { paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
      ]}
      style={{ backgroundColor: theme.background }}
    >

      <Card>
        <Text style={[styles.row, { color: theme.text }]}>
          {strings.clock.clockedInAt}: {data.todayEntry?.checkIn ?? "—"}
        </Text>
        <Text style={[styles.row, { color: theme.text }]}>
          {strings.clock.clockedOutAt}: {data.todayEntry?.checkOut ?? "—"}
        </Text>
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          {data.today} · {data.serverTime} ({strings.clock.serverTime})
        </Text>
      </Card>

      {data.requireBiometric ? (
        <Card>
          <Text style={[styles.notice, { color: theme.negative }]}>{strings.clock.biometricBlocked}</Text>
        </Card>
      ) : null}

      {!data.requireBiometric && data.requireSelfie ? (
        <Card title={strings.clock.needsSelfie}>
          {selfie ? (
            <Image source={{ uri: `data:${selfie.mimeType};base64,${selfie.contentBase64}` }} style={styles.selfie} />
          ) : null}
          <Button
            label={selfie ? strings.clock.retake : strings.clock.takeSelfie}
            onPress={() => setCameraOpen(true)}
            tone={ButtonTone.Quiet}
          />
        </Card>
      ) : null}

      {error ? <Text style={[styles.notice, { color: theme.negative }]}>{error}</Text> : null}
      {notice ? <Text style={[styles.notice, { color: theme.positive }]}>{notice}</Text> : null}

      {dayComplete ? (
        <Text style={[styles.hint, { color: theme.textMuted }]}>{strings.clock.dayComplete}</Text>
      ) : (
        <Button
          busy={busy}
          disabled={!canSubmit}
          label={action === SelfClockActionDTO.In ? strings.clock.clockIn : strings.clock.clockOut}
          onPress={() => {
            void submit(action);
          }}
        />
      )}

      <Modal animationType="slide" onRequestClose={() => setCameraOpen(false)} visible={cameraOpen}>
        <View style={styles.cameraWrap}>
          {camera.access === CameraAccess.Granted ? (
            <CameraView facing="front" ref={cameraRef} style={styles.camera} />
          ) : (
            <CameraPermissionPrompt access={camera.access} reason={strings.clock.cameraPermission} request={camera.request} />
          )}
          <View style={styles.cameraActions}>
            {camera.access === CameraAccess.Granted ? (
              <Button
                label={strings.clock.takeSelfie}
                onPress={() => {
                  void capture();
                }}
              />
            ) : null}
            <Button label={strings.common.cancel} onPress={() => setCameraOpen(false)} tone={ButtonTone.Quiet} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: SPACE.lg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACE.lg, gap: SPACE.md },
  row: { fontSize: TYPE.body, fontWeight: "600" },
  hint: { fontSize: TYPE.caption },
  notice: { fontSize: TYPE.label, fontWeight: "600" },
  selfie: { width: "100%", aspectRatio: 1, borderRadius: 12 },
  cameraWrap: { flex: 1, backgroundColor: "#000000" },
  camera: { flex: 1 },
  cameraActions: { padding: SPACE.lg, gap: SPACE.sm },
});
