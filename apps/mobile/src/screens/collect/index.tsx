import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import type { BranchDTO, CustomerDTO, OpenInvoiceDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { EntityPicker, filterPickerOptions, type PickerOption } from "@/components/entity-picker";
import { OfflineNotice } from "@/components/offline-notice";
import { TextField } from "@/components/text-field";
import { describeWriteError } from "@/api/errors";
import {
  useBranches,
  useCreateCollection,
  useCustomers,
  useOpenInvoices,
  useSalesInvoice,
  useTreasuryAccounts,
} from "@/api/queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useStrings } from "@/i18n";
import { useFormWidth, useSafeHorizontalPadding } from "@/layout";
import { formatAmountWithCurrency, isPositiveDecimal, toAmountInput } from "@/money";
import { todayIso } from "@/domain/dates";
import { AllocationInvoiceKind, CollectPaymentMethod, TreasuryAccountStatus } from "@/domain/enums";
import { resolveDefaultBranch } from "@/domain/working-location";
import { useSession } from "@/session/SessionProvider";
import { SPACE, TYPE, useTheme } from "@/theme";

function customerOption(customer: CustomerDTO): PickerOption {
  return { id: customer.id, label: customer.nameAr, sublabel: customer.code };
}

function branchOption(branch: BranchDTO): PickerOption {
  return { id: branch.id, label: branch.name, sublabel: branch.code };
}

function treasuryOption(account: TreasuryAccountDTO): PickerOption {
  return { id: account.id, label: account.name, sublabel: account.code };
}

function invoiceOption(invoice: OpenInvoiceDTO): PickerOption {
  return { id: invoice.id, label: invoice.invoiceNo, sublabel: formatAmountWithCurrency(invoice.outstanding) };
}

export function Collect() {
  const strings = useStrings();
  const theme = useTheme();
  const { can } = useSession();
  const allowed = can("treasury.cash_voucher.create");
  const formWidth = useFormWidth();
  const sidePadding = useSafeHorizontalPadding();

  const [customerQuery, setCustomerQuery] = useState("");
  const debouncedCustomerQuery = useDebouncedValue(customerQuery);
  const [customer, setCustomer] = useState<CustomerDTO | null>(null);
  const customersQuery = useCustomers(debouncedCustomerQuery);

  const [invoice, setInvoice] = useState<OpenInvoiceDTO | null>(null);
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const openInvoicesQuery = useOpenInvoices(AllocationInvoiceKind.Sales, customer?.id ?? null);

  const invoiceDetail = useSalesInvoice(invoice?.id ?? null);
  const invoiceCurrency = invoiceDetail.data?.currency ?? null;

  const [amount, setAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");

  const branchesQuery = useBranches();
  const [branch, setBranch] = useState<BranchDTO | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  useEffect(() => {
    if (branch || !branchesQuery.data) return;
    const resolved = resolveDefaultBranch(branchesQuery.data);
    if (resolved) setBranch(resolved);
  }, [branch, branchesQuery.data]);

  const treasuryQuery = useTreasuryAccounts();
  const [treasuryAccount, setTreasuryAccount] = useState<TreasuryAccountDTO | null>(null);
  const [treasuryAccountQuery, setTreasuryAccountQuery] = useState("");
  const treasuryInCurrency = (treasuryQuery.data ?? []).filter(
    (account) => account.status === TreasuryAccountStatus.Active && account.currency === invoiceCurrency,
  );

  // The open-invoice figure is in BASE currency, so it is only a valid voucher
  // amount when the invoice itself is in base currency (no confirm-time rate).
  useEffect(() => {
    if (!invoice || !invoiceDetail.data || invoiceDetail.data.id !== invoice.id) return;
    setAmount(invoiceDetail.data.fxRate === null ? toAmountInput(invoice.outstanding) : "");
  }, [invoice, invoiceDetail.data]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const createCollection = useCreateCollection();

  async function submit() {
    setNotice(null);
    if (!customer || !invoice) {
      setError(strings.collect.invoiceRequired);
      return;
    }
    if (!branch || !treasuryAccount || !isPositiveDecimal(amount)) {
      setError(strings.collect.detailsRequired);
      return;
    }
    if (invoiceCurrency === null || !invoiceDetail.data || treasuryAccount.currency !== invoiceCurrency) {
      setError(strings.collect.currencyUnknown);
      return;
    }
    if (!treasuryAccount.glAccountId) {
      setError(strings.collect.missingGlAccount);
      return;
    }
    const voucherAmount = amount.trim();
    const inBaseCurrency = invoiceDetail.data.fxRate === null;
    setBusy(true);
    setError(null);
    try {
      const result = await createCollection.mutateAsync({
        date: todayIso(),
        customerId: customer.id,
        branchId: branch.id,
        treasuryAccountId: treasuryAccount.id,
        amount: voucherAmount,
        paymentMethod: CollectPaymentMethod.Cash,
        referenceNo: referenceNo.trim() === "" ? null : referenceNo.trim(),
        // The allocation is in base currency. Only a base-currency collection
        // can name it from the typed figure; a foreign one lets the server
        // allocate the voucher's base amount at its own approved rate.
        allocations: [inBaseCurrency ? { invoiceId: invoice.id, amount: voucherAmount } : { invoiceId: invoice.id }],
      });
      const docNo = result.voucher.docNo ?? result.voucher.id;
      setNotice(result.held ? `${strings.collect.held} — ${docNo}` : `${strings.collect.success} ${invoice.invoiceNo} — ${docNo}`);
      setAmount("");
      setReferenceNo("");
      setInvoice(null);
      setTreasuryAccount(null);
    } catch (err) {
      setError(describeWriteError(err, strings));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        formWidth,
        { paddingTop: SPACE.lg, paddingBottom: SPACE.xxl, paddingHorizontal: SPACE.lg + sidePadding },
      ]}
      style={{ backgroundColor: theme.background }}
    >
      <OfflineNotice />

      {allowed ? null : (
        <Card>
          <Text style={[styles.notice, { color: theme.negative }]}>{strings.collect.noPermission}</Text>
        </Card>
      )}

      <EntityPicker
        emptyLabel={strings.picker.empty}
        label={strings.collect.customer}
        loading={customersQuery.isLoading}
        onQueryChange={setCustomerQuery}
        onSelect={(option) => {
          const found = customersQuery.data?.find((c) => c.id === option.id) ?? null;
          setCustomer(found);
          setInvoice(null);
          setTreasuryAccount(null);
          setAmount("");
        }}
        options={(customersQuery.data ?? []).filter((c) => c.active).map(customerOption)}
        placeholder={strings.collect.customerPlaceholder}
        query={customerQuery}
        searchLabel={strings.picker.search}
        value={customer ? customerOption(customer) : null}
      />

      <EntityPicker
        disabled={!customer}
        emptyLabel={strings.collect.invoiceEmpty}
        label={strings.collect.invoice}
        loading={openInvoicesQuery.isLoading}
        onQueryChange={setInvoiceQuery}
        onSelect={(option) => {
          const found = openInvoicesQuery.data?.find((i) => i.id === option.id) ?? null;
          setInvoice(found);
          setAmount("");
          setTreasuryAccount(null);
        }}
        options={filterPickerOptions((openInvoicesQuery.data ?? []).map(invoiceOption), invoiceQuery)}
        placeholder={strings.collect.invoicePlaceholder}
        query={invoiceQuery}
        searchLabel={strings.picker.search}
        value={invoice ? invoiceOption(invoice) : null}
      />

      <TextField keyboardType="decimal-pad" label={strings.collect.amount} onChangeText={setAmount} value={amount} />

      {invoiceDetail.isError ? <Text style={[styles.notice, { color: theme.negative }]}>{strings.collect.currencyUnknown}</Text> : null}

      <EntityPicker
        disabled={invoiceCurrency === null}
        emptyLabel={strings.collect.treasuryAccountEmpty}
        label={invoiceCurrency === null ? strings.collect.treasuryAccount : `${strings.collect.treasuryAccount} · ${invoiceCurrency}`}
        onQueryChange={setTreasuryAccountQuery}
        onSelect={(option) => {
          const found = treasuryQuery.data?.find((a) => a.id === option.id) ?? null;
          setTreasuryAccount(found);
        }}
        options={filterPickerOptions(treasuryInCurrency.map(treasuryOption), treasuryAccountQuery)}
        placeholder={strings.collect.treasuryAccountPlaceholder}
        query={treasuryAccountQuery}
        searchLabel={strings.picker.search}
        value={treasuryAccount ? treasuryOption(treasuryAccount) : null}
      />

      <EntityPicker
        emptyLabel={strings.picker.empty}
        label={strings.collect.branch}
        onQueryChange={setBranchQuery}
        onSelect={(option) => {
          const found = branchesQuery.data?.find((b) => b.id === option.id) ?? null;
          setBranch(found);
        }}
        options={filterPickerOptions((branchesQuery.data ?? []).filter((b) => b.active).map(branchOption), branchQuery)}
        placeholder={strings.collect.branch}
        query={branchQuery}
        searchLabel={strings.picker.search}
        value={branch ? branchOption(branch) : null}
      />

      <TextField label={strings.collect.referenceNo} onChangeText={setReferenceNo} value={referenceNo} />

      {error ? <Text style={[styles.notice, { color: theme.negative }]}>{error}</Text> : null}
      {notice ? <Text style={[styles.notice, { color: theme.positive }]}>{notice}</Text> : null}

      <Button
        busy={busy}
        disabled={!allowed}
        label={strings.collect.submit}
        onPress={() => {
          void submit();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: SPACE.lg },
  notice: { fontSize: TYPE.label, fontWeight: "600" },
});
