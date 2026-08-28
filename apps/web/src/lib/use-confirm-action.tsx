import { useCallback, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@mezan/ui";

/**
 * The app's confirm convention, for a destructive control that is not a
 * `RowMenu` item.
 *
 * WHY THIS EXISTS. `RowMenu` asks before it destroys; several screens put the
 * same destructive actions on bare icon buttons instead — delete a holiday,
 * revoke an API key, delete a leave policy or a product template — and those
 * fired immediately on click, with nothing between a mis-aimed tap and gone.
 * The dialog already existed; what was missing was a way to reach it without
 * hand-rolling the open/pending state on every screen.
 *
 * `consequence` is required, and is what the action WILL DO — the dialog's own
 * contract calls for that rather than a bare "are you sure?", because the
 * question a person can actually answer is "what am I about to lose".
 */
export interface ConfirmRequest {
  readonly title: ReactNode;
  readonly consequence: ReactNode;
  readonly confirmLabel: string;
  readonly onConfirm: () => void | Promise<void>;
}

export function useConfirmAction(): { ask: (request: ConfirmRequest) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const ask = useCallback((request: ConfirmRequest) => setPending(request), []);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ""}
      consequence={pending?.consequence ?? ""}
      confirmLabel={pending?.confirmLabel ?? ""}
      // Always danger: every caller here is deleting or revoking something, and
      // the dialog puts initial focus on Cancel in that tone, so Enter on a
      // dialog the user did not expect cancels rather than destroys.
      tone="danger"
      onConfirm={() => {
        const request = pending;
        setPending(null);
        if (request) void request.onConfirm();
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { ask, dialog };
}
