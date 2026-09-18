import { useMemo, useState, type ReactNode } from "react";
import { matchesSearch } from "@mezan/domain";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  EmptyState,
  Money as MoneyValue,
  RowMenu,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { PurchaseInvoiceStatusDTO, SupplierDTO } from "@mezan/contracts";
import {
  useCreateSupplier,
  usePurchaseInvoices,
  useSuppliers,
  useSupplierCounts,
  useSupplierStats,
  type SupplierListFilter,
  useUpdateSupplier,
} from "../data/hooks";
import {
  agingBucketsFor,
  moneyToNumber,
  sumMoney,
  useSupplierAging,
} from "../data/partner-detail-hooks";
import { TextField, NumberField, ToggleField } from "../settings/form-controls";
import { PartyStatementTab } from "./PartyStatementTab";
import { majorOf } from "../lib/money";
import { useNavigation } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";
import { EMPTY } from "../lib/empty";

/**
 * الموردون (Suppliers) — docs/archive/catalog/02-purchases.md "الموردون". The mirror
 * of CustomersScreen.tsx: same DocumentList/DocumentDetail/SidePanel shape,
 * backed by the real `/suppliers` API.
 *
 * فواتير المشتريات reads the live `GET /purchases/invoices` narrowed to this
 * supplier. كشف حساب المورد and the payable column both come from the server's
 * supplier aging ladder (`/reports/statements/suppliers/:id`, `owed`), so the
 * screen never derives a second payable of its own (D201).
 *
 * There is no attachments tab: this build has no file-storage subsystem of any
 * kind, so the tab would be a navigational dead end rather than an empty list.
 */

const PURCHASE_STATUS_KEY: Record<PurchaseInvoiceStatusDTO, AppTranslationKey> = {
  draft: "suppliers.status.draft",
  confirmed: "suppliers.status.confirmed",
  cancelled: "suppliers.status.cancelled",
};

const PURCHASE_STATUS_TONE: Record<PurchaseInvoiceStatusDTO, PillTone> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function isoToDisplay(date: string): string {
  return date.split("-").reverse().join("/");
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useAppTranslation();
  return (
    <Card className="p-[18px_20px]">
      <p className="text-[13px] font-semibold text-danger-ink">{message}</p>
      <Button size="sm" className="mt-[10px]" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </Card>
  );
}

/** أعمار فواتير هذا المورد — the supplier's own row on the aging ladder, bucket by bucket. */
function SupplierAgingCard({ supplierId }: { supplierId: string }) {
  const { t } = useAppTranslation();
  const agingQuery = useSupplierAging();
  const buckets = agingBucketsFor(agingQuery.data?.rows.find((row) => row.supplierId === supplierId));
  return (
    <div className="rounded-lg border border-border bg-surface p-[16px_18px]">
      <h3 className="font-display text-[13.5px] font-bold text-ink">{t("suppliers.aging.heading")}</h3>
      <p className="mt-[4px] max-w-[80ch] text-[11.5px] leading-[1.8] text-ink-faint">{t("suppliers.aging.description")}</p>
      {agingQuery.isError ? (
        <div className="mt-[12px]">
          <TabError message={t("suppliers.aging.loadFailed")} onRetry={() => agingQuery.refetch()} />
        </div>
      ) : (
        <div className="mt-[14px] overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-ink-muted">
                <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.current")}</th>
                <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.d31to60")}</th>
                <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.d61to90")}</th>
                <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.d91to120")}</th>
                <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.over120")}</th>
                <th className="p-[8px] text-end font-semibold">{t("common.total")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {[buckets.current, buckets.d31to60, buckets.d61to90, buckets.d91to120, buckets.over120].map((value, index) => (
                  <td key={index} className="p-[8px] text-end text-ink">
                    <MoneyValue value={value} showUnit={false} />
                  </td>
                ))}
                <td className="p-[8px] text-end font-semibold text-ink">
                  <MoneyValue value={buckets.total} showUnit={false} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[13px_15px]">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[5px] text-[14.5px] font-bold text-ink">{value}</div>
    </div>
  );
}

/** فواتير مشتريات المورد — `GET /purchases/invoices`, narrowed to this supplier. */
function SupplierInvoicesTab({ supplierId }: { supplierId: string }) {
  const { t } = useAppTranslation();
  const query = usePurchaseInvoices();
  const invoices = useMemo(
    () =>
      (query.data ?? [])
        .filter((inv) => inv.supplierId === supplierId)
        .sort((a, b) => (a.date === b.date ? a.number.localeCompare(b.number) : b.date.localeCompare(a.date))),
    [query.data, supplierId],
  );

  if (query.isError) return <TabError message={t("suppliers.invoices.loadFailed")} onRetry={() => query.refetch()} />;
  if (query.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">{t("suppliers.invoices.loading")}</p>;
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-[22px_24px]">
        <p className="text-[13.5px] font-semibold text-ink">{t("suppliers.invoices.emptyTitle")}</p>
        <p className="mt-[8px] max-w-[70ch] text-[12.5px] leading-[1.9] text-ink-muted">
          {t("suppliers.invoices.emptyBody")}
        </p>
      </div>
    );
  }

  const confirmed = invoices.filter((inv) => inv.status === "confirmed");
  const confirmedTotal = sumMoney(confirmed.map((inv) => inv.baseTotal ?? inv.total));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <MiniStat label={t("suppliers.invoices.count")} value={<span className="mz-num">{invoices.length}</span>} />
        <MiniStat label={t("suppliers.invoices.confirmed")} value={<span className="mz-num">{confirmed.length}</span>} />
        <MiniStat label={t("suppliers.invoices.confirmedTotal")} value={<MoneyValue value={moneyToNumber(confirmedTotal)} showUnit={false} />} />
        <MiniStat
          label={t("suppliers.invoices.last")}
          value={<span className="mz-num">{invoices[0] ? isoToDisplay(invoices[0].date) : "—"}</span>}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">{t("suppliers.invoices.col.number")}</th>
              <th className="p-[10px] text-start font-semibold">{t("suppliers.invoices.col.supplierNumber")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.date")}</th>
              <th className="p-[10px] text-start font-semibold">{t("suppliers.invoices.col.due")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.status")}</th>
              <th className="p-[10px] text-end font-semibold">{t("suppliers.invoices.col.beforeTax")}</th>
              <th className="p-[10px] text-end font-semibold">{t("suppliers.invoices.col.tax")}</th>
              <th className="p-[10px] text-end font-semibold">{t("common.total")}</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-border last:border-b-0">
                <td className="mz-num p-[10px] font-semibold text-ink">{inv.number}</td>
                <td className="mz-num p-[10px] text-ink-muted">{inv.supplierInvoiceNumber ?? "—"}</td>
                <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(inv.date)}</td>
                <td className="mz-num p-[10px] text-ink-muted">{inv.dueDate ? isoToDisplay(inv.dueDate) : "—"}</td>
                <td className="p-[10px]">
                  <StatusPill label={t(PURCHASE_STATUS_KEY[inv.status])} tone={PURCHASE_STATUS_TONE[inv.status]} />
                </td>
                <td className="p-[10px] text-end text-ink-muted">
                  <MoneyValue value={num(inv.subtotal)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end text-ink-muted">
                  <MoneyValue value={num(inv.tax)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end font-semibold text-ink">
                  <MoneyValue value={num(inv.total)} showUnit={false} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


interface SupplierDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  email: string;
  contactPerson: string;
  taxNumber: string;
  bankAccount: string;
  category: string;
  notes: string;
  paymentTermsDays: number;
  currency: string;
  openingBalance: number;
  addressCity: string;
  addressDistrict: string;
  addressStreet: string;
  active: boolean;
}

const BLANK_DRAFT: SupplierDraft = {
  code: "",
  nameAr: "",
  nameEn: "",
  phone: "",
  email: "",
  contactPerson: "",
  taxNumber: "",
  bankAccount: "",
  category: "",
  notes: "",
  paymentTermsDays: 30,
  currency: "EGP",
  openingBalance: 0,
  addressCity: "",
  addressDistrict: "",
  addressStreet: "",
  active: true,
};

const PAGE_SIZES = [10, 25, 50, 100] as const;

function draftFromSupplier(supplier: SupplierDTO): SupplierDraft {
  return {
    code: supplier.code,
    nameAr: supplier.nameAr,
    nameEn: supplier.nameEn ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    contactPerson: supplier.contactPerson ?? "",
    taxNumber: supplier.taxNumber ?? "",
    bankAccount: supplier.bankAccount ?? "",
    category: supplier.category ?? "",
    notes: supplier.notes ?? "",
    paymentTermsDays: supplier.paymentTermsDays,
    currency: supplier.currency,
    openingBalance: num(supplier.openingBalance),
    addressCity: supplier.addressCity ?? "",
    addressDistrict: supplier.addressDistrict ?? "",
    addressStreet: supplier.addressStreet ?? "",
    active: supplier.active,
  };
}

function SupplierDetail({ supplier, onBack, onEdit }: { supplier: SupplierDTO; onBack: () => void; onEdit: () => void }) {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  const address = [supplier.addressStreet, supplier.addressDistrict, supplier.addressCity].filter(Boolean).join(t("suppliers.addressSeparator"));
  return (
    <DocumentDetail
      title={`${supplier.nameAr} · ${supplier.code}`}
      statusLabel={supplier.active ? t("common.active") : t("common.inactive")}
      statusTone={supplier.active ? "success" : "neutral"}
      subtitle={supplier.nameEn ?? undefined}
      actions={
        <>
          <Button variant="primary" onClick={() => navigate("purchase-invoices", { kind: "create", prefill: { supplierId: supplier.id } })}>
            {t("suppliers.action.newInvoice")}
          </Button>
          <Button onClick={() => navigate("treasury-vouchers", { kind: "create", prefill: { supplierId: supplier.id } })}>
            {t("suppliers.action.payment")}
          </Button>
          <Button onClick={() => navigate("purchase-orders", { kind: "create", prefill: { supplierId: supplier.id } })}>
            {t("suppliers.action.newOrder")}
          </Button>
          <Button onClick={onEdit}>{t("suppliers.edit")}</Button>
          <Button variant="ghost" onClick={onBack}>
            {t("suppliers.backToList")}
          </Button>
        </>
      }
      summary={[
        { label: t("suppliers.detail.category"), value: supplier.category ?? t("common.uncategorized") },
        { label: t("suppliers.detail.paymentTerms"), value: <span className="mz-num">{t("suppliers.detail.days", { days: supplier.paymentTermsDays })}</span> },
        { label: t("suppliers.detail.currency"), value: supplier.currency },
        { label: t("common.phone"), value: supplier.phone ?? t("common.none") },
        {
          label: t("suppliers.detail.payableOpening"),
          value: <MoneyValue value={num(supplier.openingBalance)} />,
        },
        { label: t("common.taxNumber"), value: supplier.taxNumber ?? t("common.none") },
      ]}
      tabs={[
        {
          key: "overview",
          label: t("common.overview"),
          content: (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
              {[
                { label: t("common.email"), value: supplier.email ?? t("common.none") },
                { label: t("suppliers.detail.contactPerson"), value: supplier.contactPerson ?? t("common.none") },
                { label: t("common.taxNumber"), value: supplier.taxNumber ?? t("common.none") },
                { label: t("suppliers.field.bankAccount"), value: supplier.bankAccount ?? t("common.none") },
                { label: t("suppliers.detail.address"), value: address === "" ? t("common.none") : address },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{row.label}</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{row.value}</div>
                </div>
              ))}
              {supplier.notes ? (
                <div className="col-span-full rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{t("common.notes")}</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{supplier.notes}</div>
                </div>
              ) : null}
            </div>
          ),
        },
        { key: "invoices", label: t("suppliers.tab.invoices"), content: <SupplierInvoicesTab supplierId={supplier.id} /> },
        { key: "statement", label: t("suppliers.tab.statement"), content: (
            <div className="flex flex-col gap-[16px]">
              <PartyStatementTab kind="supplier" partyId={supplier.id} />
              <SupplierAgingCard supplierId={supplier.id} />
            </div>
          ), },
      ]}
    />
  );
}

export function SuppliersScreen() {
  const { t } = useAppTranslation();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();

  const { navigate } = useNavigation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The query is in the URL; see lib/url-state.ts for what belongs there.
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | "active" | "inactive",
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SupplierDraft>(BLANK_DRAFT);
  const [error, setError] = useState<string | null>(null);

  /**
   * One filter for the rows, the chips and the KPI strip (R1.1). The payable
   * tile used to be a float sum over every supplier the server had sent, so a
   * status chip moved the table and left the header on the whole book.
   */
  const filter = useMemo<SupplierListFilter>(
    () => ({ status: statusFilter, q: search.trim() || undefined }),
    [statusFilter, search],
  );

  const query = useSuppliers(filter);
  const suppliers = query.data ?? EMPTY;
  const filtered = suppliers;
  const counts = useSupplierCounts(filter).data ?? {};
  const stats = useSupplierStats(filter).data ?? {};

  // The payable a supplier ROW shows is the server's `owed`: their row on the
  // supplier aging ladder, in base currency, opening balance included (D201).
  const payableOf = (id: string) => majorOf(suppliers.find((s) => s.id === id)?.owed ?? "0");

  const selected = suppliers.find((s) => s.id === selectedId) ?? null;

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    { key: "active", label: t("common.active"), count: counts.active ?? 0 },
    { key: "inactive", label: t("common.inactive"), count: counts.inactive ?? 0 },
  ];

  const columns: DocumentListColumn<SupplierDTO>[] = [
    {
      key: "name",
      header: t("suppliers.col.supplier"),
      render: (s) => (
        <div>
          <div className="font-semibold text-ink">{s.nameAr}</div>
          <div className="mz-num text-[11.5px] text-ink-faint">{s.code}</div>
        </div>
      ),
    },
    { key: "phone", header: t("common.phone"), render: (s) => s.phone ?? "—" },
    { key: "terms", header: t("suppliers.detail.paymentTerms"), render: (s) => <span className="mz-num">{t("suppliers.detail.days", { days: s.paymentTermsDays })}</span> },
    { key: "category", header: t("suppliers.detail.category"), render: (s) => s.category ?? t("common.uncategorized") },
    { key: "payable", header: t("suppliers.col.payable"), align: "end", render: (s) => <MoneyValue value={payableOf(s.id)} /> },
    {
      key: "status",
      header: t("common.status"),
      render: (s) => <StatusPill label={s.active ? t("common.active") : t("common.inactive")} tone={(s.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setError(null);
    setPanelOpen(true);
  }

  function openEditForm(supplier: SupplierDTO) {
    setEditingId(supplier.id);
    setDraft(draftFromSupplier(supplier));
    setError(null);
    setPanelOpen(true);
  }

  async function submit() {
    setError(null);
    if (draft.nameAr.trim() === "") {
      setError(t("suppliers.error.nameRequired"));
      return;
    }
    const fields = {
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      phone: draft.phone.trim() === "" ? null : draft.phone.trim(),
      email: draft.email.trim() === "" ? null : draft.email.trim(),
      contactPerson: draft.contactPerson.trim() === "" ? null : draft.contactPerson.trim(),
      taxNumber: draft.taxNumber.trim() === "" ? null : draft.taxNumber.trim(),
      bankAccount: draft.bankAccount.trim() === "" ? null : draft.bankAccount.trim(),
      category: draft.category.trim() === "" ? null : draft.category.trim(),
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      paymentTermsDays: draft.paymentTermsDays,
      currency: draft.currency.trim() === "" ? "EGP" : draft.currency.trim(),
      openingBalance: String(draft.openingBalance || 0),
      addressCity: draft.addressCity.trim() === "" ? null : draft.addressCity.trim(),
      addressDistrict: draft.addressDistrict.trim() === "" ? null : draft.addressDistrict.trim(),
      addressStreet: draft.addressStreet.trim() === "" ? null : draft.addressStreet.trim(),
    };
    try {
      if (editingId) {
        await updateSupplier.mutateAsync({ id: editingId, patch: { ...fields, active: draft.active } });
      } else {
        const code = draft.code.trim();
        await createSupplier.mutateAsync({ id: crypto.randomUUID(), ...(code === "" ? {} : { code }), ...fields });
      }
      setPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("suppliers.error.saveFailed"));
    }
  }

  const formFields = (
    <div className="flex flex-col gap-[14px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <TextField label={t("suppliers.field.name")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
      <TextField
        label={t("suppliers.field.code")}
        value={draft.code}
        onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
        placeholder={t("suppliers.field.codePlaceholder")}
        disabled={editingId !== null}
      />
      <TextField label={t("common.phone")} type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} placeholder="01xxxxxxxx" />
      <NumberField
        label={t("suppliers.field.paymentTerms")}
        value={draft.paymentTermsDays}
        onChange={(v) => setDraft((d) => ({ ...d, paymentTermsDays: v }))}
        min={0}
      />
      <TextField label={t("suppliers.field.currency")} value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v }))} placeholder="EGP" />
      <TextField label={t("suppliers.field.category")} value={draft.category} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} placeholder={t("common.uncategorized")} />
      <NumberField
        label={t("suppliers.field.openingBalance")}
        value={draft.openingBalance}
        onChange={(v) => setDraft((d) => ({ ...d, openingBalance: v }))}
        hint={t("suppliers.field.openingBalanceHint")}
      />
      <TextField label={t("suppliers.field.nameEn")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
      <TextField label={t("common.email")} type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
      <TextField label={t("suppliers.field.taxNumber")} value={draft.taxNumber} onChange={(v) => setDraft((d) => ({ ...d, taxNumber: v }))} placeholder="300xxxxxxxxx" />
      <TextField label={t("suppliers.field.bankAccount")} value={draft.bankAccount} onChange={(v) => setDraft((d) => ({ ...d, bankAccount: v }))} />
      <TextField label={t("suppliers.field.contactPerson")} value={draft.contactPerson} onChange={(v) => setDraft((d) => ({ ...d, contactPerson: v }))} />
      <TextField label={t("suppliers.field.city")} value={draft.addressCity} onChange={(v) => setDraft((d) => ({ ...d, addressCity: v }))} />
      <TextField label={t("suppliers.field.district")} value={draft.addressDistrict} onChange={(v) => setDraft((d) => ({ ...d, addressDistrict: v }))} />
      <TextField label={t("suppliers.field.street")} value={draft.addressStreet} onChange={(v) => setDraft((d) => ({ ...d, addressStreet: v }))} />
      <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
      {editingId ? <ToggleField label={t("common.active")} checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} /> : null}
      <div className="flex justify-end gap-[9px]">
        <Button onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit}>
          {editingId ? t("suppliers.saveEdits") : t("suppliers.addSupplier")}
        </Button>
      </div>
    </div>
  );

  if (selected) {
    return (
      <>
        <SupplierDetail supplier={selected} onBack={() => setSelectedId(null)} onEdit={() => openEditForm(selected)} />
        <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? t("suppliers.editSupplier") : t("suppliers.addSupplier")} description={t("suppliers.panel.description")}>
          {formFields}
        </SidePanel>
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("suppliers.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<SupplierDTO>
        loadFailed={query.isError}
        title={t("suppliers.title")}
        description={t("suppliers.description")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("suppliers.addSupplier")}
          </Button>
        }
        stats={[
          { label: t("suppliers.stat.total"), value: <span className="mz-num">{stats.count ?? 0}</span> },
          { label: t("common.active"), value: <span className="mz-num">{stats.active ?? 0}</span> },
          {
            label: t("suppliers.stat.payable"),
            value: <MoneyValue value={majorOf(String(stats.payable ?? "0"))} showUnit={false} />,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key as typeof statusFilter);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(v) => {
          setSearchText(v);
          setPage(1);
        }}
        searchPlaceholder={t("suppliers.searchPlaceholder")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(s) => s.id}
        onRowClick={(s) => setSelectedId(s.id)}
        rowAction={(s) => {
          // An archived supplier can still be opened and read, but nothing new may be raised against it.
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => setSelectedId(s.id) },
            ...(s.active
              ? [
                  {
                    key: "invoice",
                    label: t("suppliers.action.newInvoice"),
                    onSelect: () => navigate("purchase-invoices", { kind: "create", prefill: { supplierId: s.id } }),
                  },
                  {
                    key: "payment",
                    label: t("suppliers.action.payment"),
                    onSelect: () => navigate("treasury-vouchers", { kind: "create", prefill: { supplierId: s.id } }),
                  },
                  {
                    key: "order",
                    label: t("suppliers.action.newOrder"),
                    onSelect: () => navigate("purchase-orders", { kind: "create", prefill: { supplierId: s.id } }),
                  },
                  { key: "edit", label: t("common.edit"), onSelect: () => openEditForm(s) },
                ]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: s.nameAr })} />;
        }}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("suppliers.showingSuffix")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("suppliers.empty")}
            description={t("suppliers.emptyBody")}
            action={{ label: t("suppliers.addSupplier"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? t("suppliers.editSupplier") : t("suppliers.addSupplier")} description={t("suppliers.panel.description")}>
        {formFields}
      </SidePanel>
    </>
  );
}
