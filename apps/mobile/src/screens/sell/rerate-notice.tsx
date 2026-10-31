import { StyleSheet, Text, View } from "react-native";
import type { SalesInvoiceDTO } from "@mezan/contracts";
import { Button, ButtonTone } from "@/components/button";
import type { Strings } from "@/i18n";
import { formatAmountWithCurrency } from "@/money";
import { SPACE, TYPE, useTheme } from "@/theme";
import type { RerateAcknowledgement } from "./use-rerate-acknowledgement";

interface RerateNoticeProps {
  readonly rerate: RerateAcknowledgement;
  readonly strings: Strings;
  readonly onError?: (error: unknown) => void;
  readonly onConfirmed?: (invoice: SalesInvoiceDTO) => void;
  readonly onKeptDraft?: () => void;
}

export function RerateNotice({ rerate, strings, onError, onConfirmed, onKeptDraft }: RerateNoticeProps) {
  const theme = useTheme();
  const { pending, keptDraft } = rerate;

  if (keptDraft) {
    return (
      <Text accessibilityRole="alert" style={[styles.notice, { color: theme.text }]}>
        {strings.sell.rerateKeptDraft.replace("{recalculated}", formatAmountWithCurrency(keptDraft.recalculatedTotal))}
      </Text>
    );
  }
  if (!pending) return null;

  return (
    <View accessibilityRole="alert" style={styles.block}>
      {pending.message ? <Text style={[styles.notice, { color: theme.negative }]}>{pending.message}</Text> : null}
      <Text style={[styles.notice, { color: theme.negative }]}>
        {strings.sell.rerateTotals
          .replace("{recalculated}", formatAmountWithCurrency(pending.recalculatedTotal))
          .replace("{shown}", formatAmountWithCurrency(pending.shownTotal))}
      </Text>
      <Button
        busy={rerate.busy}
        label={strings.sell.rerateConfirm}
        onPress={() => {
          rerate
            .acknowledge()
            .then((invoice) => {
              if (invoice) onConfirmed?.(invoice);
            })
            .catch((error: unknown) => onError?.(error));
        }}
      />
      <Button
        disabled={rerate.busy}
        label={strings.sell.rerateKeepDraft}
        onPress={() => {
          rerate.keepDraft();
          onKeptDraft?.();
        }}
        tone={ButtonTone.Quiet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: SPACE.sm },
  notice: { fontSize: TYPE.body },
});
