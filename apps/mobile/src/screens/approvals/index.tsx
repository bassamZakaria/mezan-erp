import type { ApprovalRequestDTO } from "@mezan/contracts";
import { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Button, ButtonTone } from "@/components/button";
import { Card } from "@/components/card";
import { TextField } from "@/components/text-field";
import { describeApiError, describeWriteError } from "@/api/errors";
import { useDecideApproval, usePendingApprovals, useUser } from "@/api/queries";
import { OfflineNotice } from "@/components/offline-notice";
import { useStrings } from "@/i18n";
import { ApprovalDecision } from "@/domain/enums";
import { useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

export function Approvals() {
  const strings = useStrings();
  const theme = useTheme();
  const { can } = useSession();
  const allowed = can("workflow.view");

  const pending = usePendingApprovals();
  const decide = useDecideApproval();

  // Which rows are currently submitting, and which row has its reject
  // reason open — per-item. A row's own action guards against a second tap
  // on ITSELF (early-return below); it never disables any other row.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  function markPending(id: string) {
    setPendingIds((prev) => new Set(prev).add(id));
  }
  function clearPending(id: string) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function approve(request: ApprovalRequestDTO) {
    if (pendingIds.has(request.id)) return;
    markPending(request.id);
    setRowError(null);
    try {
      await decide.mutateAsync({ id: request.id, body: { decision: ApprovalDecision.Approve } });
    } catch (err) {
      setRowError({ id: request.id, message: describeWriteError(err, strings) });
    } finally {
      clearPending(request.id);
    }
  }

  async function reject(request: ApprovalRequestDTO) {
    if (pendingIds.has(request.id)) return;
    if (reason.trim() === "") {
      setRowError({ id: request.id, message: strings.approvals.reasonRequired });
      return;
    }
    markPending(request.id);
    setRowError(null);
    try {
      await decide.mutateAsync({ id: request.id, body: { decision: ApprovalDecision.Reject, comment: reason.trim() } });
      setRejectingId(null);
      setReason("");
    } catch (err) {
      setRowError({ id: request.id, message: describeWriteError(err, strings) });
    } finally {
      clearPending(request.id);
    }
  }

  if (!allowed) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Text style={[styles.notice, { color: theme.negative }]}>{strings.approvals.noPermission}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.background, paddingTop: SPACE.md }]}>
      <View style={styles.padded}>
        <OfflineNotice />
      </View>

      {pending.isError ? (
        <Text style={[styles.notice, { color: theme.negative }]}>{describeApiError(pending.error, strings)}</Text>
      ) : null}

      <FlatList
        contentContainerStyle={styles.list}
        data={pending.data ?? []}
        keyExtractor={(row) => row.id}
        ListEmptyComponent={
          pending.isLoading ? null : <Text style={[styles.empty, { color: theme.textMuted }]}>{strings.approvals.empty}</Text>
        }
        renderItem={({ item }) => {
          const rowBusy = pendingIds.has(item.id);
          const isRejecting = rejectingId === item.id;
          return (
            <Card>
              <Text style={[styles.rowLabel, { color: theme.text }]}>{item.entityLabel ?? item.actionType}</Text>
              <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                {strings.approvals.submittedBy} <Submitter userId={item.submittedBy} /> · {strings.approvals.step} {item.currentStep + 1}/{item.steps.length}
              </Text>

              {rowError && rowError.id === item.id ? (
                <Text style={[styles.notice, { color: theme.negative }]}>{rowError.message}</Text>
              ) : null}

              {isRejecting ? (
                <View style={styles.rejectWrap}>
                  <TextField label={strings.approvals.reason} onChangeText={setReason} placeholder={strings.approvals.reasonPlaceholder} value={reason} />
                  <View style={styles.actions}>
                    <Button
                      busy={rowBusy}
                      label={strings.approvals.confirmReject}
                      onPress={() => {
                        void reject(item);
                      }}
                      tone={ButtonTone.Danger}
                    />
                    <Button
                      disabled={rowBusy}
                      label={strings.common.cancel}
                      onPress={() => {
                        setRejectingId(null);
                        setReason("");
                      }}
                      tone={ButtonTone.Quiet}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  <Button
                    busy={rowBusy}
                    disabled={rowBusy}
                    label={strings.approvals.approve}
                    onPress={() => {
                      void approve(item);
                    }}
                  />
                  <Button
                    disabled={rowBusy}
                    label={strings.approvals.reject}
                    onPress={() => {
                      setRejectingId(item.id);
                      setReason("");
                    }}
                    tone={ButtonTone.Danger}
                  />
                </View>
              )}
            </Card>
          );
        }}
      />
    </View>
  );
}

/**
 * The approval carries only the submitter's id. `GET /users/:id` is the one
 * route that names a user, and it is gated on `admin.users.view`: without that
 * right, or when the id names no user, the id itself is shown — never a guess.
 */
function Submitter({ userId }: { userId: string }) {
  const { session, can } = useSession();
  const own = session?.userId === userId;
  const user = useUser(userId, !own && can("admin.users.view"));
  if (own) return <>{session.nameAr}</>;
  return <>{user.data?.nameAr ?? userId}</>;
}

const styles = StyleSheet.create({
  padded: { paddingHorizontal: SPACE.lg },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACE.lg },
  list: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xxl, gap: SPACE.md },
  rowLabel: { fontSize: TYPE.body, fontWeight: "700" },
  rowMeta: { fontSize: TYPE.caption },
  notice: { fontSize: TYPE.label, fontWeight: "600" },
  empty: { fontSize: TYPE.label, textAlign: "auto", paddingTop: SPACE.xl },
  actions: { flexDirection: "row", gap: SPACE.sm },
  rejectWrap: { gap: SPACE.sm },
});
