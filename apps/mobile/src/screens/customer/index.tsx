import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/card";
import { describeApiError } from "@/api/errors";
import { useCustomer, useCustomerAging, useCustomerInvoices, type CustomerAgingRow } from "@/api/queries";
import { useStrings, type Strings } from "@/i18n";
import { formatAmountWithCurrency, formatWireAmount } from "@/money";
import { useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[strong ? styles.rowValueStrong : styles.rowValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function agingBuckets(row: CustomerAgingRow, strings: Strings): { label: string; amount: string | number }[] {
  return [
    { label: strings.customer.agingCurrent, amount: row.current },
    { label: strings.customer.aging31to60, amount: row.d31to60 },
    { label: strings.customer.aging61to90, amount: row.d61to90 },
    { label: strings.customer.aging91to120, amount: row.d91to120 },
    { label: strings.customer.agingOver120, amount: row.over120 },
  ];
}

export function Customer({ id }: { id: string }) {
  const strings = useStrings();
  const theme = useTheme();
  const { can } = useSession();
  const customer = useCustomer(id);
  const aging = useCustomerAging(id, can("sales.invoice.view"));
  const invoices = useCustomerInvoices(
    id,
    can("sales.invoice.view") || can("sales.invoice.view_all") || can("sales.invoice.view_own"),
  );

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

      {aging.isFetched || aging.isError ? (
        <Card title={strings.customer.aging}>
          {aging.isError ? (
            <Text style={[styles.notice, { color: theme.negative }]}>{describeApiError(aging.error, strings)}</Text>
          ) : aging.data ? (
            <>
              {agingBuckets(aging.data, strings).map((bucket) => (
                <Row key={bucket.label} label={bucket.label} value={formatWireAmount(bucket.amount)} />
              ))}
              <Row label={strings.customer.agingTotal} strong value={formatWireAmount(aging.data.total)} />
            </>
          ) : (
            <Text style={[styles.notice, { color: theme.textMuted }]}>{strings.customer.noDebt}</Text>
          )}
        </Card>
      ) : null}

      {invoices.isFetched || invoices.isError ? (
        <Card title={strings.customer.lastInvoices}>
          {invoices.isError ? (
            <Text style={[styles.notice, { color: theme.negative }]}>{describeApiError(invoices.error, strings)}</Text>
          ) : (invoices.data ?? []).length === 0 ? (
            <Text style={[styles.notice, { color: theme.textMuted }]}>{strings.customer.noInvoices}</Text>
          ) : (
            (invoices.data ?? []).map((invoice) => (
              <View key={invoice.id} style={styles.invoice}>
                <View style={styles.row}>
                  <Text style={[styles.rowValue, { color: theme.text }]}>{invoice.docNo ?? invoice.id}</Text>
                  <Text style={[styles.rowValue, { color: theme.text }]}>{formatAmountWithCurrency(invoice.baseGrandTotal)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={[styles.caption, { color: theme.textMuted }]}>{invoice.date}</Text>
                  <Text style={[styles.caption, { color: theme.textMuted }]}>
                    {strings.customer.remaining} {formatAmountWithCurrency(invoice.remainingBalance)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      ) : null}
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
  rowValueStrong: { fontSize: TYPE.body, fontWeight: "800" },
  invoice: { gap: 2 },
  caption: { fontSize: TYPE.caption },
  notice: { fontSize: TYPE.label },
});
