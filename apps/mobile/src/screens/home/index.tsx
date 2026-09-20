import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/card";
import { StatTile } from "@/components/stat-tile";
import { Button, ButtonTone } from "@/components/button";
import { useDashboardSummary } from "@/api/queries";
import { ApiFailure, describeApiError } from "@/api/errors";
import { useStrings } from "@/i18n";
import { useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

export function Home() {
  const strings = useStrings();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useSession();
  const summary = useDashboardSummary();
  // Only a dead connection makes the figures on screen "the last ones that
  // arrived". A refusal is the server answering, and saying otherwise sends
  // the user looking for a signal they already have.
  const unreachable = summary.isError && summary.error?.failure === ApiFailure.Network;

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SPACE.lg, paddingBottom: SPACE.xxl }]}
      refreshControl={
        <RefreshControl
          refreshing={summary.isRefetching}
          onRefresh={() => {
            void summary.refetch();
          }}
          tintColor={theme.brand}
        />
      }
      style={{ backgroundColor: theme.background }}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>{strings.home.title}</Text>
        <Text style={[styles.tenant, { color: theme.textMuted }]}>{session?.tenantName ?? ""}</Text>
      </View>

      {summary.isError ? (
        <Card>
          <Text style={[styles.failure, { color: theme.negative }]}>{describeApiError(summary.error, strings)}</Text>
          <Button
            label={strings.common.retry}
            onPress={() => {
              void summary.refetch();
            }}
            tone={ButtonTone.Quiet}
          />
        </Card>
      ) : null}

      {summary.data === undefined ? null : (
        <>
          {unreachable ? (
            <Text style={[styles.stale, { color: theme.warning }]}>{strings.common.offline}</Text>
          ) : null}
          <View style={styles.tiles}>
            <StatTile label={strings.home.cash} amount={summary.data.gl.cash} />
            <StatTile label={strings.home.receivables} amount={summary.data.gl.receivables} />
            <StatTile label={strings.home.payables} amount={summary.data.gl.payables} />
            <StatTile amount={summary.data.gl.netProfit} emphasiseNegative label={strings.home.netProfit} />
          </View>

          <Card title={strings.home.recentActivity}>
            {summary.data.recentActivity.length === 0 ? (
              <Text style={[styles.empty, { color: theme.textMuted }]}>{strings.common.empty}</Text>
            ) : (
              summary.data.recentActivity.map((row) => (
                <View key={row.id} style={styles.activityRow}>
                  <Text style={[styles.activityMemo, { color: theme.text }]} numberOfLines={1}>
                    {row.memo}
                  </Text>
                  <Text style={[styles.activityDate, { color: theme.textMuted }]}>{row.date}</Text>
                </View>
              ))
            )}
          </Card>
        </>
      )}

      <Button
        label={strings.common.signOut}
        onPress={() => {
          void signOut();
        }}
        tone={ButtonTone.Quiet}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACE.lg, gap: SPACE.lg },
  header: { gap: SPACE.xs },
  title: { fontSize: TYPE.display, fontWeight: "800" },
  tenant: { fontSize: TYPE.label },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  activityRow: { gap: 2 },
  activityMemo: { fontSize: TYPE.body },
  activityDate: { fontSize: TYPE.caption },
  empty: { fontSize: TYPE.label },
  failure: { fontSize: TYPE.label, fontWeight: "600" },
  stale: { fontSize: TYPE.caption, fontWeight: "600" },
});
