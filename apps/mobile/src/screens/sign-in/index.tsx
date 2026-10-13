import { useRouter } from "expo-router";
import { Children, useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ButtonTone } from "@/components/button";
import { LegalLinks } from "@/components/legal-links";
import { TextField } from "@/components/text-field";
import { ApiError, ApiFailure, describeApiError } from "@/api/errors";
import { useStrings, WaitUnit, type Strings, type WaitForms } from "@/i18n";
import { SizeClass, useFormPadding, useSizeClass } from "@/layout";
import { SessionEnded, useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

const PIN_LENGTH = 6;
const SECOND_MS = 1000;
const SHOWN_AS_MINUTES_FROM = 120;

enum Hold {
  None = "none",
  Throttled = "throttled",
  ServerBusy = "server-busy",
}

const FEW = 10;

function counted(count: number, forms: WaitForms): string {
  const form = count === 1 ? forms.one : count === 2 ? forms.two : count <= FEW ? forms.few : forms.many;
  return form.replace("{count}", String(count));
}

function formatWait(seconds: number, strings: Strings): string {
  if (seconds < SHOWN_AS_MINUTES_FROM) return counted(seconds, strings.signIn.wait[WaitUnit.Seconds]);
  return counted(Math.ceil(seconds / 60), strings.signIn.wait[WaitUnit.Minutes]);
}

// The wait is counted down in ONE place, on the button. A throttle's own
// sentence names a number of seconds that is stale a second later, so the
// screen says what happened and leaves the number to the button.
function refusalSentence(error: unknown, hold: Hold, strings: Strings): string {
  return hold === Hold.Throttled ? strings.signIn.tooManyAttempts : describeApiError(error, strings);
}

function holdFor(error: unknown): { readonly hold: Hold; readonly seconds: number } {
  if (!(error instanceof ApiError) || error.retryAfterSeconds === null) return { hold: Hold.None, seconds: 0 };
  if (error.failure === ApiFailure.Throttled) return { hold: Hold.Throttled, seconds: error.retryAfterSeconds };
  if (error.failure === ApiFailure.Unavailable) return { hold: Hold.ServerBusy, seconds: error.retryAfterSeconds };
  return { hold: Hold.None, seconds: 0 };
}

export function SignIn() {
  const strings = useStrings();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { connection, signIn, unlockAccount, sessionEnded, acknowledgeSessionEnded } = useSession();
  const formPadding = useFormPadding();
  const paired = useSizeClass() !== SizeClass.Compact;

  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [tenantCode, setTenantCode] = useState(connection.tenantCode ?? "");
  const [email, setEmail] = useState(connection.email ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hold, setHold] = useState(Hold.None);
  const [heldForSeconds, setHeldForSeconds] = useState(0);
  const [unlockOffered, setUnlockOffered] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const held = heldForSeconds > 0;
  useEffect(() => {
    if (held || hold !== Hold.Throttled) return;
    setFailure(null);
    setHold(Hold.None);
  }, [held, hold]);
  useEffect(() => {
    if (!held) return;
    const timer = setInterval(() => {
      setHeldForSeconds((seconds) => Math.max(0, seconds - 1));
    }, SECOND_MS);
    return () => {
      clearInterval(timer);
    };
  }, [held]);

  const complete = baseUrl.trim().length > 0 && email.trim().length > 0 && pin.length === PIN_LENGTH;
  const tenant = tenantCode.trim() === "" ? null : tenantCode.trim();

  const submitUnlockCode = (): void => {
    const code = unlockCode.trim();
    if (unlocking || held || code === "") return;
    setUnlocking(true);
    void unlockAccount({ baseUrl: baseUrl.trim(), tenantCode: tenant, email: email.trim(), code })
      .then(() => {
        setUnlockOffered(false);
        setUnlockCode("");
        setFailure(null);
        setNotice(strings.signIn.unlockDone);
      })
      .catch((error: unknown) => {
        const wait = holdFor(error);
        setFailure(refusalSentence(error, wait.hold, strings));
        setHold(wait.hold);
        setHeldForSeconds(wait.seconds);
      })
      .finally(() => {
        setUnlocking(false);
      });
  };

  const submit = (): void => {
    if (busy || !complete || held) return;
    setBusy(true);
    setFailure(null);
    setNotice(null);
    void signIn({
      baseUrl: baseUrl.trim(),
      tenantCode: tenant,
      email: email.trim(),
      pin,
    })
      .then(() => {
        acknowledgeSessionEnded();
        router.replace("/(tabs)");
      })
      .catch((error: unknown) => {
        const wait = holdFor(error);
        setFailure(refusalSentence(error, wait.hold, strings));
        setUnlockOffered(error instanceof ApiError && error.failure === ApiFailure.Locked && error.unlockByCode);
        setHold(wait.hold);
        setHeldForSeconds(wait.seconds);
        setPin("");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <KeyboardAvoidingView
      /**
       * "padding" on BOTH platforms. Android 15 draws every app edge to edge,
       * and an edge-to-edge window is no longer resized by
       * android:windowSoftInputMode="adjustResize" — so with the keyboard up
       * the form did not shrink, did not scroll, and the PIN field and the
       * sign-in button could not be reached at all. Measured on a 360x640dp
       * emulator.
       */
      behavior="padding"
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

        {sessionEnded === null || failure !== null ? null : (
          <Text accessibilityRole="alert" style={[styles.failure, { color: theme.negative }]} testID="sign-in-session-ended">
            {sessionEnded === SessionEnded.Displaced ? strings.signIn.sessionDisplaced : strings.signIn.sessionExpired}
          </Text>
        )}
        {failure === null ? null : (
          <Text accessibilityRole="alert" style={[styles.failure, { color: theme.negative }]} testID="sign-in-failure">
            {failure}
          </Text>
        )}
        {notice === null ? null : (
          <Text style={[styles.failure, { color: theme.positive }]} testID="sign-in-notice">
            {notice}
          </Text>
        )}

        {unlockOffered ? (
          <View style={styles.unlock}>
            <TextField
              autoCapitalize="characters"
              label={strings.signIn.unlockCodeLabel}
              onChangeText={setUnlockCode}
              testID="sign-in-unlock-code"
              value={unlockCode}
            />
            <Button
              busy={unlocking}
              disabled={unlockCode.trim() === "" || held}
              label={strings.signIn.unlockSubmit}
              onPress={submitUnlockCode}
              testID="sign-in-unlock-submit"
              tone={ButtonTone.Quiet}
            />
          </View>
        ) : null}

        <Button
          busy={busy}
          disabled={!complete || held}
          label={
            held
              ? `${hold === Hold.ServerBusy ? strings.signIn.busyFor : strings.signIn.throttledFor} ${formatWait(heldForSeconds, strings)}`
              : busy
                ? strings.signIn.submitting
                : strings.signIn.submit
          }
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
  unlock: { gap: SPACE.sm },
});
