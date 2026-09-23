import { useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/card";
import { CountTile, StatTile } from "@/components/stat-tile";
import { Button, ButtonTone } from "@/components/button";
import { useCockpit, useDashboardSummary, usePendingApprovals } from "@/api/queries";
import { describeApiError } from "@/api/errors";
import { formatAsOf } from "@/domain/dates";
import { TreasuryAccountType } from "@/domain/enums";
import { useOffline } from "@/hooks/use-offline";
import { sumDecimals } from "@/money";
import { useStrings } from "@/i18n";
import { useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

export function Home() {
  const strings = useStrings();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, signOut, can } = useSession();
  const summary = useDashboardSummary();
  const cockpit = useCockpit(can("accounting.cockpit.view"));
  const canSeeApprovals = can("workflow.view");
  const approvals = usePendingApprovals(canSeeApprovals);
  const offline = useOffline();

  const bankBalances = cockpit.data?.cash?.accounts
    .filter((account) => account.type === TreasuryAccountType.Bank && account.balance !== null)
    .map((account) => account.balance as string);

  const bankTile =
    bankBalances === undefined || bankBalances.length === 0 ? null : (
      <StatTile label={strings.home.bank} amount={sumDecimals(bankBalances)} />
    );

  const salesTodayTile =
    cockpit.data === undefined ? null : <StatTile label={strings.home.salesToday} amount={cockpit.data.pulse.sales.today} />;

  const refresh = () => {
    void summary.refetch();
    if (cockpit.isFetched) void cockpit.refetch();
    if (canSeeApprovals) void approvals.refetch();
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SPACE.lg, paddingBottom: SPACE.xxl }]}
      refreshControl={
        <RefreshControl
          refreshing={summary.isRefetching}
          onRefresh={refresh}
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

      {offline ? <Text style={[styles.stale, { color: theme.warning }]}>{strings.common.offline}</Text> : null}
      {summary.data === undefined ? null : (
        <Text style={[styles.asOf, { color: theme.textMuted }]}>
          {strings.home.asOf} {formatAsOf(summary.data.generatedAt)}
        </Text>
      )}

      <View style={styles.tiles}>
        {salesTodayTile}
        {summary.data === undefined ? null : (
          <>
            <StatTile label={strings.home.cash} amount={summary.data.gl.cash} />
            {bankTile}
            <StatTile label={strings.home.receivables} amount={summary.data.gl.receivables} />
            <StatTile label={strings.home.payables} amount={summary.data.gl.payables} />
            <StatTile amount={summary.data.gl.netProfit} emphasiseNegative label={strings.home.netProfit} />
          </>
        )}
        {summary.data === undefined ? bankTile : null}
        {canSeeApprovals && approvals.data !== undefined ? (
          <CountTile count={approvals.data.length} label={strings.home.approvalsWaiting} onPress={() => router.push("/approvals")} />
        ) : null}
      </View>

      {summary.data === undefined ? null : (
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
  asOf: { fontSize: TYPE.caption },
});
