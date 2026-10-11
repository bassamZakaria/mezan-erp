import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BranchDTO, CustomerDTO, ItemDTO, WarehouseDTO } from "@mezan/contracts";
import { Button, ButtonTone } from "@/components/button";
import { Card } from "@/components/card";
import { EntityPicker, filterPickerOptions, type PickerOption } from "@/components/entity-picker";
import { OfflineNotice } from "@/components/offline-notice";
import { Segmented } from "@/components/segmented";
import { TextField } from "@/components/text-field";
import { describeWriteError } from "@/api/errors";
import {
  useBranches,
  useCreateSalesInvoice,
  useConfirmSalesInvoice,
  useCreateSalesQuote,
  useCustomers,
  useItemSearch,
  useWarehouses,
} from "@/api/queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useStrings } from "@/i18n";
import { useFormPadding } from "@/layout";
import { formatAmountWithCurrency, isPositiveDecimal, toAmountInput } from "@/money";
import { DEFAULT_GL_ACCOUNTS } from "@/domain/accounts";
import { addDaysIso, todayIso } from "@/domain/dates";
import { DocumentKind, ItemType } from "@/domain/enums";
import { makeLocalId } from "@/domain/local-id";
import { useDocumentId } from "@/hooks/use-document-id";
import { resolveDefaultBranch, resolveDefaultWarehouse } from "@/domain/working-location";
import { useSession } from "@/session/SessionProvider";
import { RADIUS, SPACE, TYPE, useTheme } from "@/theme";

const QUOTE_VALIDITY_DAYS = 14;

interface LineDraft {
  readonly lineId: string;
  readonly item: ItemDTO | null;
  readonly qty: string;
  readonly unitPrice: string;
}

function blankLine(): LineDraft {
  return { lineId: makeLocalId("line"), item: null, qty: "1", unitPrice: "" };
}

function lineComplete(line: LineDraft): boolean {
  return line.item !== null && isPositiveDecimal(line.qty) && isPositiveDecimal(line.unitPrice);
}

function toOption(customer: CustomerDTO): PickerOption {
  return { id: customer.id, label: customer.nameAr, sublabel: customer.code };
}

function branchOption(branch: BranchDTO): PickerOption {
  return { id: branch.id, label: branch.name, sublabel: branch.code };
}

function warehouseOption(warehouse: WarehouseDTO): PickerOption {
  return { id: warehouse.id, label: warehouse.name, sublabel: warehouse.code };
}

function itemOption(item: ItemDTO): PickerOption {
  return { id: item.id, label: item.nameAr, sublabel: item.code };
}

export function Sell() {
  const strings = useStrings();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { can } = useSession();
  const formPadding = useFormPadding();

  const [kind, setKind] = useState<DocumentKind>(DocumentKind.Invoice);

  const [customerQuery, setCustomerQuery] = useState("");
  const debouncedCustomerQuery = useDebouncedValue(customerQuery);
  const [customer, setCustomer] = useState<CustomerDTO | null>(null);
  const customersQuery = useCustomers(debouncedCustomerQuery);

  const branchesQuery = useBranches();
  const warehousesQuery = useWarehouses();
  const [branch, setBranch] = useState<BranchDTO | null>(null);
  const [warehouse, setWarehouse] = useState<WarehouseDTO | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  const [warehouseQuery, setWarehouseQuery] = useState("");

  useEffect(() => {
    if (branch || !branchesQuery.data) return;
    const resolved = resolveDefaultBranch(branchesQuery.data);
    if (resolved) setBranch(resolved);
  }, [branch, branchesQuery.data]);

  useEffect(() => {
    if (warehouse || !warehousesQuery.data || !branch) return;
    const resolved = resolveDefaultWarehouse(warehousesQuery.data, branch.id);
    if (resolved) setWarehouse(resolved);
  }, [warehouse, warehousesQuery.data, branch]);

  const [date] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayIso());
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [expiryDate, setExpiryDate] = useState(addDaysIso(todayIso(), QUOTE_VALIDITY_DAYS));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dueDateTouched || !customer) return;
    setDueDate(addDaysIso(date, customer.paymentTermsDays));
  }, [customer, date, dueDateTouched]);

  const createInvoice = useCreateSalesInvoice();
  // ONE id per invoice the rep means to create. It survives an attempt whose
  // answer never arrived, so pressing again is answered with the invoice
  // already created; it is replaced once a create is known to have succeeded.
  const invoiceId = useDocumentId((savedId) => {
    setNotice(`${strings.common.alreadySaved} — ${savedId}`);
    setLines([blankLine()]);
    setNotes("");
  });
  const confirmInvoice = useConfirmSalesInvoice();
  const createQuote = useCreateSalesQuote();

  function updateLine(lineId: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(lineId: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.lineId !== lineId)));
  }

  const canQuote = can("sales.quote.create");
  const canInvoice = can("sales.invoice.create");

  const linesReady = lines.length > 0 && lines.every(lineComplete);
  const locationReady = branch !== null && (kind === DocumentKind.Quote || warehouse !== null);

  async function submit() {
    if (!customer) {
      setError(strings.sell.customerRequired);
      return;
    }
    if (!locationReady || !branch) {
      setError(strings.sell.locationRequired);
      return;
    }
    if (!linesReady) {
      setError(strings.sell.lineIncomplete);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (kind === DocumentKind.Quote) {
        const created = await createQuote.mutateAsync({
          date,
          expiryDate,
          customerId: customer.id,
          customerNameAr: customer.nameAr,
          customerTaxExempt: customer.taxExempt,
          branchId: branch.id,
          currency: customer.currency,
          notes: notes.trim() === "" ? null : notes.trim(),
          lines: lines.map((line) => ({
            lineId: line.lineId,
            itemId: line.item!.id,
            itemNameAr: line.item!.nameAr,
            qty: line.qty.trim(),
            unitPrice: line.unitPrice.trim(),
            taxRatePercent: line.item!.taxRatePercent,
          })),
        });
        setNotice(`${strings.sell.quoteCreated} — ${created.docNo ?? created.id}`);
      } else {
        if (!warehouse) {
          setError(strings.sell.locationRequired);
          return;
        }
        const created = await createInvoice.mutateAsync({
          id: invoiceId.current(),
          date,
          dueDate,
          customerId: customer.id,
          customerNameAr: customer.nameAr,
          customerTaxExempt: customer.taxExempt,
          warehouseId: warehouse.id,
          branchId: branch.id,
          currency: customer.currency,
          notes: notes.trim() === "" ? null : notes.trim(),
          arAccountId: DEFAULT_GL_ACCOUNTS.accountsReceivable,
          taxAccountId: DEFAULT_GL_ACCOUNTS.tax,
          lines: lines.map((line) => {
            const item = line.item!;
            const isStock = item.type === ItemType.Stock;
            return {
              lineId: line.lineId,
              itemId: item.id,
              itemNameAr: item.nameAr,
              isStock,
              qty: line.qty.trim(),
              unitPrice: line.unitPrice.trim(),
              taxRatePercent: item.taxRatePercent,
              revenueAccountId: item.revenueAccountId ?? DEFAULT_GL_ACCOUNTS.revenue,
              cogsAccountId: isStock ? (item.cogsAccountId ?? DEFAULT_GL_ACCOUNTS.cogs) : null,
              inventoryAccountId: isStock ? (item.inventoryAccountId ?? DEFAULT_GL_ACCOUNTS.inventory) : null,
            };
          }),
        });
        const confirmed = await confirmInvoice.mutateAsync({ id: created.id });
        invoiceId.renew();
        const total = confirmed.totals?.grandTotal;
        setNotice(
          `${strings.sell.invoiceCreated} — ${confirmed.docNo ?? confirmed.id}` +
            (total ? ` — ${formatAmountWithCurrency(total)}` : ""),
        );
      }
      setLines([blankLine()]);
      setNotes("");
    } catch (err) {
      if (invoiceId.recover(err)) return;
      setError(describeWriteError(err, strings));
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = kind === DocumentKind.Quote ? strings.sell.submitQuote : strings.sell.submitInvoice;
  const canSubmitKind = kind === DocumentKind.Quote ? canQuote : canInvoice;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        formPadding,
        { paddingTop: insets.top + SPACE.lg, paddingBottom: SPACE.xxl },
      ]}
      style={{ backgroundColor: theme.background }}
    >
      <Text style={[styles.title, { color: theme.text }]}>{strings.sell.title}</Text>
      <OfflineNotice />

      <Segmented
        label={strings.sell.documentType}
        onChange={setKind}
        options={[
          { value: DocumentKind.Invoice, label: strings.sell.kindInvoice },
          { value: DocumentKind.Quote, label: strings.sell.kindQuote },
        ]}
        value={kind}
      />

      {canSubmitKind ? null : (
        <Card>
          <Text style={[styles.notice, { color: theme.negative }]}>{strings.sell.noPermission}</Text>
        </Card>
      )}

      <EntityPicker
        emptyLabel={strings.picker.empty}
        label={strings.sell.customer}
        loading={customersQuery.isLoading}
        onQueryChange={setCustomerQuery}
        onSelect={(option) => {
          const found = customersQuery.data?.find((c) => c.id === option.id) ?? null;
          setCustomer(found);
          setDueDateTouched(false);
        }}
        options={(customersQuery.data ?? []).filter((c) => c.active).map(toOption)}
        placeholder={strings.sell.customerPlaceholder}
        query={customerQuery}
        searchLabel={strings.picker.search}
        value={customer ? toOption(customer) : null}
      />

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <EntityPicker
            emptyLabel={strings.picker.empty}
            label={strings.sell.branch}
            onQueryChange={setBranchQuery}
            onSelect={(option) => {
              const found = branchesQuery.data?.find((b) => b.id === option.id) ?? null;
              setBranch(found);
              setWarehouse(null);
            }}
            options={filterPickerOptions((branchesQuery.data ?? []).filter((b) => b.active).map(branchOption), branchQuery)}
            placeholder={strings.sell.branchPlaceholder}
            query={branchQuery}
            searchLabel={strings.picker.search}
            value={branch ? branchOption(branch) : null}
          />
        </View>
        {kind === DocumentKind.Invoice ? (
          <View style={styles.rowItem}>
            <EntityPicker
              emptyLabel={strings.picker.empty}
              label={strings.sell.warehouse}
              onQueryChange={setWarehouseQuery}
              onSelect={(option) => {
                const found = warehousesQuery.data?.find((w) => w.id === option.id) ?? null;
                setWarehouse(found);
              }}
              options={filterPickerOptions(
                (warehousesQuery.data ?? []).filter((w) => w.active && (!branch || w.branchId === branch.id)).map(warehouseOption),
                warehouseQuery,
              )}
              placeholder={strings.sell.warehousePlaceholder}
              query={warehouseQuery}
              searchLabel={strings.picker.search}
              value={warehouse ? warehouseOption(warehouse) : null}
            />
          </View>
        ) : null}
      </View>

      {kind === DocumentKind.Invoice ? (
        <TextField label={strings.sell.dueDate} onChangeText={(v) => { setDueDateTouched(true); setDueDate(v); }} value={dueDate} />
      ) : (
        <TextField label={strings.sell.expiryDate} onChangeText={setExpiryDate} value={expiryDate} />
      )}

      <Text style={[styles.sectionTitle, { color: theme.text }]}>{strings.sell.lines}</Text>
      {lines.map((line, index) => (
        <LineRow
          index={index}
          key={line.lineId}
          line={line}
          onChange={(patch) => updateLine(line.lineId, patch)}
          onRemove={() => removeLine(line.lineId)}
          removable={lines.length > 1}
        />
      ))}
      <Button label={strings.sell.addLine} onPress={addLine} tone={ButtonTone.Quiet} />

      <TextField label={strings.sell.notes} onChangeText={setNotes} value={notes} />

      {error ? <Text style={[styles.notice, { color: theme.negative }]}>{error}</Text> : null}
      {notice ? <Text style={[styles.notice, { color: theme.positive }]}>{notice}</Text> : null}

      <Button
        busy={busy}
        disabled={!canSubmitKind}
        label={submitLabel}
        onPress={() => {
          void submit();
        }}
      />
    </ScrollView>
  );
}

function LineRow({
  line,
  index,
  onChange,
  onRemove,
  removable,
}: {
  line: LineDraft;
  index: number;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const strings = useStrings();
  const theme = useTheme();
  const [itemQuery, setItemQuery] = useState("");
  const debouncedItemQuery = useDebouncedValue(itemQuery);
  const itemsQuery = useItemSearch(debouncedItemQuery, debouncedItemQuery.trim().length >= 2);
  const options = useMemo(() => (itemsQuery.data ?? []).map(itemOption), [itemsQuery.data]);

  return (
    <Card>
      <View style={styles.lineHeader}>
        <Text style={[styles.lineIndex, { color: theme.textMuted }]}>#{index + 1}</Text>
        {removable ? <Button label={strings.sell.removeLine} onPress={onRemove} tone={ButtonTone.Quiet} /> : null}
      </View>
      <EntityPicker
        emptyLabel={debouncedItemQuery.trim().length < 2 ? strings.picker.searchHint : strings.picker.empty}
        label={strings.sell.item}
        loading={itemsQuery.isLoading}
        onQueryChange={setItemQuery}
        onSelect={(option) => {
          const found = itemsQuery.data?.find((i) => i.id === option.id) ?? null;
          onChange({ item: found, unitPrice: toAmountInput(found?.salePrice ?? "") });
        }}
        options={options}
        placeholder={strings.sell.itemPlaceholder}
        query={itemQuery}
        searchLabel={strings.picker.search}
        value={line.item ? itemOption(line.item) : null}
      />
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <TextField
            keyboardType="decimal-pad"
            label={strings.sell.qty}
            onChangeText={(v) => onChange({ qty: v })}
            value={line.qty}
          />
        </View>
        <View style={styles.rowItem}>
          <TextField
            keyboardType="decimal-pad"
            label={strings.sell.unitPrice}
            onChangeText={(v) => onChange({ unitPrice: v })}
            value={line.unitPrice}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: SPACE.lg },
  title: { fontSize: TYPE.display, fontWeight: "800" },
  sectionTitle: { fontSize: TYPE.title, fontWeight: "700" },
  row: { flexDirection: "row", gap: SPACE.md },
  rowItem: { flex: 1 },
  lineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lineIndex: { fontSize: TYPE.label, fontWeight: "700" },
  notice: { fontSize: TYPE.label, fontWeight: "600", borderRadius: RADIUS.sm },
});
