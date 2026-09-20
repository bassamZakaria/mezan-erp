import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/card";
import { describeApiError } from "@/api/errors";
import { useCustomer } from "@/api/queries";
import { useStrings } from "@/i18n";
import { formatAmountWithCurrency } from "@/money";
import { SPACE, TYPE, useTheme } from "@/theme";

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

export function Customer({ id }: { id: string }) {
  const strings = useStrings();
  const theme = useTheme();
  const customer = useCustomer(id);

  if (customer.isError) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Text style={[styles.notice, { color: theme.negative }]}>{describeApiError(customer.error, strings)}</Text>
      </View>
    );
  }

  if (customer.data === undefined) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Text style={[styles.notice, { color: theme.textMuted }]}>{strings.common.loading}</Text>
      </View>
    );
  }

  const row = customer.data;
  return (
    <ScrollView contentContainerStyle={styles.content} style={{ backgroundColor: theme.background }}>
      <Text style={[styles.title, { color: theme.text }]}>{row.nameAr}</Text>
      <Card>
        <Row label={strings.home.receivables} value={row.owed == null ? "—" : formatAmountWithCurrency(row.owed)} />
        <Row label={strings.customer.creditLimit} value={formatAmountWithCurrency(row.creditLimit)} />
        <Row label={strings.customer.paymentTerms} value={`${row.paymentTermsDays}`} />
        <Row label={strings.customer.currency} value={row.currency} />
        {row.phone === null ? null : <Row label={strings.customer.phone} value={row.phone} />}
        {row.taxNumber === null ? null : <Row label={strings.customer.taxNumber} value={row.taxNumber} />}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACE.lg, gap: SPACE.lg },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACE.lg },
  title: { fontSize: TYPE.title, fontWeight: "700" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md },
  rowLabel: { fontSize: TYPE.label },
  rowValue: { fontSize: TYPE.label, fontWeight: "600" },
  notice: { fontSize: TYPE.label },
});
