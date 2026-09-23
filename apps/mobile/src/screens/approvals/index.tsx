import type { ApprovalRequestDTO } from "@mezan/contracts";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, ButtonTone } from "@/components/button";
import { Card } from "@/components/card";
import { SplitPlaceholder, SplitView } from "@/components/split-view";
import { TextField } from "@/components/text-field";
import { describeApiError, describeWriteError } from "@/api/errors";
import { useDecideApproval, usePendingApprovals, useUser } from "@/api/queries";
import { OfflineNotice } from "@/components/offline-notice";
import { useStrings, type Strings } from "@/i18n";
import { useFormWidth, useIsSplit, useSafeHorizontalPadding } from "@/layout";
import { ApprovalDecision } from "@/domain/enums";
import { useSession } from "@/session/SessionProvider";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

export function Approvals() {
  const strings = useStrings();
  const theme = useTheme();
  const { can } = useSession();
  const allowed = can("workflow.view");
  const split = useIsSplit();
  const sidePadding = useSafeHorizontalPadding();
  const formWidth = useFormWidth();

  const pending = usePendingApprovals();
  const decide = useDecideApproval();

  // Which rows are currently submitting, and which row has its reject
  // reason open — per-item. A row's own action guards against a second tap
  // on ITSELF (early-return below); it never disables any other row.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      if (selectedId === request.id) setSelectedId(null);
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
      if (selectedId === request.id) setSelectedId(null);
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

  const requests = pending.data ?? [];
  const selected = requests.find((row) => row.id === selectedId) ?? null;

  const card = (request: ApprovalRequestDTO) => (
    <ApprovalCard
      busy={pendingIds.has(request.id)}
      error={rowError && rowError.id === request.id ? rowError.message : null}
      onApprove={() => {
        void approve(request);
      }}
      onCancelReject={() => {
        setRejectingId(null);
        setReason("");
      }}
      onConfirmReject={() => {
        void reject(request);
      }}
      onReasonChange={setReason}
      onStartReject={() => {
        setRejectingId(request.id);
        setReason("");
      }}
      reason={reason}
      rejecting={rejectingId === request.id}
      request={request}
      strings={strings}
    />
  );

  const list = (
    <View style={styles.flex}>
      <View style={styles.padded}>
        <OfflineNotice />
      </View>

      {pending.isError ? (
        <Text style={[styles.notice, { color: theme.negative }]}>{describeApiError(pending.error, strings)}</Text>
      ) : null}

      <FlatList
        contentContainerStyle={[styles.list, split ? null : formWidth]}
        data={requests}
        keyExtractor={(row) => row.id}
        ListEmptyComponent={
          pending.isLoading ? null : <Text style={[styles.empty, { color: theme.textMuted }]}>{strings.approvals.empty}</Text>
        }
        renderItem={({ item }) => {
          if (!split) return card(item);
          const isSelected = item.id === selectedId;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              testID="approval-summary"
              onPress={() => {
                setSelectedId(item.id);
                setRejectingId(null);
                setReason("");
              }}
              style={({ pressed }) => [
                styles.summaryRow,
                {
                  backgroundColor: isSelected ? theme.surfaceMuted : theme.surface,
                  borderColor: isSelected ? theme.brand : theme.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={2}>
                {item.entityLabel ?? item.actionType}
              </Text>
              <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
                {strings.approvals.step} {item.currentStep + 1}/{item.steps.length}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );

  return (
    <View
      style={[styles.flex, { backgroundColor: theme.background, paddingTop: SPACE.md, paddingHorizontal: sidePadding }]}
    >
      {split ? (
        <SplitView
          detail={
            selected === null ? (
              <SplitPlaceholder label={strings.common.selectRequestToView} />
            ) : (
              <View style={styles.detailPane}>{card(selected)}</View>
            )
          }
          list={list}
        />
      ) : (
        list
      )}
    </View>
  );
}

interface ApprovalCardProps {
  readonly request: ApprovalRequestDTO;
  readonly strings: Strings;
  readonly busy: boolean;
  readonly rejecting: boolean;
  readonly reason: string;
  readonly error: string | null;
  readonly onApprove: () => void;
  readonly onStartReject: () => void;
  readonly onConfirmReject: () => void;
  readonly onCancelReject: () => void;
  readonly onReasonChange: (next: string) => void;
}

function ApprovalCard({
  request,
  strings,
  busy,
  rejecting,
  reason,
  error,
  onApprove,
  onStartReject,
  onConfirmReject,
  onCancelReject,
  onReasonChange,
}: ApprovalCardProps) {
  const theme = useTheme();
  return (
    <Card>
      <Text style={[styles.rowLabel, { color: theme.text }]}>{request.entityLabel ?? request.actionType}</Text>
      <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
        {strings.approvals.submittedBy} <Submitter userId={request.submittedBy} /> · {strings.approvals.step}{" "}
        {request.currentStep + 1}/{request.steps.length}
      </Text>

      {error === null ? null : <Text style={[styles.notice, { color: theme.negative }]}>{error}</Text>}

      {rejecting ? (
        <View style={styles.rejectWrap}>
          <TextField
            label={strings.approvals.reason}
            onChangeText={onReasonChange}
            placeholder={strings.approvals.reasonPlaceholder}
            value={reason}
          />
          <View style={styles.actions}>
            <Button busy={busy} label={strings.approvals.confirmReject} onPress={onConfirmReject} tone={ButtonTone.Danger} />
            <Button disabled={busy} label={strings.common.cancel} onPress={onCancelReject} tone={ButtonTone.Quiet} />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button busy={busy} disabled={busy} label={strings.approvals.approve} onPress={onApprove} />
          <Button disabled={busy} label={strings.approvals.reject} onPress={onStartReject} tone={ButtonTone.Danger} />
        </View>
      )}
    </Card>
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
  detailPane: { padding: SPACE.lg },
  summaryRow: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.md, gap: SPACE.xs, minHeight: 64 },
  rowLabel: { fontSize: TYPE.body, fontWeight: "700" },
  rowMeta: { fontSize: TYPE.caption },
  notice: { fontSize: TYPE.label, fontWeight: "600" },
  empty: { fontSize: TYPE.label, textAlign: "auto", paddingTop: SPACE.xl },
  actions: { flexDirection: "row", gap: SPACE.sm },
  rejectWrap: { gap: SPACE.sm },
});
