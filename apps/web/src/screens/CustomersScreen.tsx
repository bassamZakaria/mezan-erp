import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  Money as MoneyValue,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import { ETA_BUYER_TYPES } from "@mezan/domain";
import type { CustomerDTO, EtaBuyerTypeDTO } from "@mezan/contracts";
import { useCreateCustomer, useCustomers, useUpdateCustomer } from "../data/hooks";
import { TextField, NumberField, SelectField, ToggleField } from "../settings/form-controls";

/**
 * العملاء (Customers) — docs/catalog/01-sales.md "العملاء (Customers —
 * Customer master)". List + detail (DocumentList/DocumentDetail) + add/edit
 * form (SidePanel), backed by the real `/customers` API.
 *
 * The invoices/statement rollup and the running "مديونية العميل" balance are
 * Phase-2 (document) work — the الفواتير/كشف حساب/المرفقات tabs below render
 * as explicit stubs; only the customer master record itself (incl. its
 * `openingBalance`) is real.
 */

const ETA_BUYER_TYPE_LABEL: Record<EtaBuyerTypeDTO, string> = {
  auto: "تلقائي (منشأة إذا وُجد رقم ضريبي، وإلا فرد)",
  business: "منشأة",
  individual: "فرد",
};

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function StubTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[8px] rounded-lg border border-dashed border-border p-[36px] text-center">
      <StatusPill label="قريباً" tone="info" />
      <p className="text-[12.5px] text-ink-muted">
        تبويب "{label}" يُعرض فور ربط المستندات (فواتير المبيعات) بسجل العميل — المرحلة الثانية.
      </p>
    </div>
  );
}

interface CustomerDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  email: string;
  contactPerson: string;
  taxNumber: string;
  category: string;
  notes: string;
  paymentTermsDays: number;
  currency: string;
  creditLimit: number;
  priceListId: string;
  taxExempt: boolean;
  etaBuyerType: EtaBuyerTypeDTO;
  nationalId: string;
  active: boolean;
}

const BLANK_DRAFT: CustomerDraft = {
  code: "",
  nameAr: "",
  nameEn: "",
  phone: "",
  email: "",
  contactPerson: "",
  taxNumber: "",
  category: "",
  notes: "",
  paymentTermsDays: 30,
  currency: "EGP",
  creditLimit: 0,
  priceListId: "",
  taxExempt: false,
  etaBuyerType: "auto",
  nationalId: "",
  active: true,
};

function draftFromCustomer(customer: CustomerDTO): CustomerDraft {
  return {
    code: customer.code,
    nameAr: customer.nameAr,
    nameEn: customer.nameEn ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    contactPerson: customer.contactPerson ?? "",
    taxNumber: customer.taxNumber ?? "",
    category: customer.category ?? "",
    notes: customer.notes ?? "",
    paymentTermsDays: customer.paymentTermsDays,
    currency: customer.currency,
    creditLimit: num(customer.creditLimit),
    priceListId: customer.priceListId ?? "",
    taxExempt: customer.taxExempt,
    etaBuyerType: customer.etaBuyerType,
    nationalId: customer.nationalId ?? "",
    active: customer.active,
  };
}

function CustomerDetail({ customer, onBack, onEdit }: { customer: CustomerDTO; onBack: () => void; onEdit: () => void }) {
  const remainingCredit = num(customer.creditLimit) - num(customer.openingBalance);
  return (
    <DocumentDetail
      title={`${customer.nameAr} · ${customer.code}`}
      statusLabel={customer.active ? "نشط" : "غير نشط"}
      statusTone={customer.active ? "success" : "neutral"}
      subtitle={customer.nameEn ?? undefined}
      actions={
        <>
          <Button variant="primary" onClick={onEdit}>
            تعديل
          </Button>
          <Button onClick={onBack}>رجوع لقائمة العملاء</Button>
        </>
      }
      summary={[
        { label: "التصنيف", value: customer.category ?? "بدون تصنيف" },
        { label: "شروط الدفع", value: <span className="mz-num">{customer.paymentTermsDays} يوم</span> },
        { label: "الحد الائتماني", value: <MoneyValue value={num(customer.creditLimit)} /> },
        { label: "الرصيد الافتتاحي", value: <MoneyValue value={num(customer.openingBalance)} /> },
        {
          label: "متبقي من الحد",
          value: <MoneyValue value={remainingCredit} />,
          valueTone: remainingCredit < 0 ? "danger" : "default",
        },
        { label: "نوع المشتري (ETA)", value: ETA_BUYER_TYPE_LABEL[customer.etaBuyerType] },
      ]}
      tabs={[
        {
          key: "overview",
          label: "نظرة عامة",
          content: (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
              {[
                { label: "الهاتف", value: customer.phone ?? "لا يوجد" },
                { label: "البريد الإلكتروني", value: customer.email ?? "لا يوجد" },
                { label: "جهة الاتصال", value: customer.contactPerson ?? "لا يوجد" },
                { label: "الرقم الضريبي", value: customer.taxNumber ?? "لا يوجد" },
                { label: "الرقم القومي", value: customer.nationalId ?? "لا يوجد" },
                { label: "العملة", value: customer.currency },
                { label: "إعفاء ضريبي", value: customer.taxExempt ? "نعم" : "لا" },
                { label: "قائمة الأسعار", value: customer.priceListId ?? "بدون قائمة أسعار" },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{row.label}</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{row.value}</div>
                </div>
              ))}
              {customer.notes ? (
                <div className="col-span-full rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">ملاحظات</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{customer.notes}</div>
                </div>
              ) : null}
            </div>
          ),
        },
        { key: "invoices", label: "الفواتير", content: <StubTab label="الفواتير" /> },
        { key: "statement", label: "كشف حساب", content: <StubTab label="كشف حساب" /> },
        { key: "attachments", label: "المرفقات", content: <StubTab label="المرفقات" /> },
      ]}
    />
  );
}

export function CustomersScreen() {
  const query = useCustomers();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const customers = query.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomerDraft>(BLANK_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const selected = customers.find((c) => c.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = customers;
    if (statusFilter !== "all") rows = rows.filter((c) => (statusFilter === "active" ? c.active : !c.active));
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (c) => c.nameAr.includes(search.trim()) || c.code.toLowerCase().includes(q) || (c.phone ?? "").includes(search.trim()),
      );
    }
    return rows;
  }, [customers, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: customers.length },
    { key: "active", label: "نشط", count: customers.filter((c) => c.active).length },
    { key: "inactive", label: "غير نشط", count: customers.filter((c) => !c.active).length },
  ];

  const columns: DocumentListColumn<CustomerDTO>[] = [
    {
      key: "name",
      header: "اسم العميل",
      render: (c) => (
        <div>
          <div className="font-semibold text-ink">{c.nameAr}</div>
          <div className="mz-num text-[11.5px] text-ink-faint">{c.code}</div>
        </div>
      ),
    },
    { key: "phone", header: "الهاتف", render: (c) => c.phone ?? "—" },
    { key: "terms", header: "شروط الدفع", render: (c) => <span className="mz-num">{c.paymentTermsDays} يوم</span> },
    { key: "category", header: "التصنيف", render: (c) => c.category ?? "بدون تصنيف" },
    { key: "creditLimit", header: "الحد الائتماني", align: "end", render: (c) => <MoneyValue value={num(c.creditLimit)} /> },
    { key: "openingBalance", header: "الرصيد الافتتاحي", align: "end", render: (c) => <MoneyValue value={num(c.openingBalance)} /> },
    {
      key: "status",
      header: "الحالة",
      render: (c) => <StatusPill label={c.active ? "نشط" : "غير نشط"} tone={(c.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setError(null);
    setPanelOpen(true);
  }

  function openEditForm(customer: CustomerDTO) {
    setEditingId(customer.id);
    setDraft(draftFromCustomer(customer));
    setError(null);
    setPanelOpen(true);
  }

  async function submit() {
    setError(null);
    if (draft.nameAr.trim() === "") {
      setError("الاسم بالعربية مطلوب");
      return;
    }
    const fields = {
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      phone: draft.phone.trim() === "" ? null : draft.phone.trim(),
      email: draft.email.trim() === "" ? null : draft.email.trim(),
      contactPerson: draft.contactPerson.trim() === "" ? null : draft.contactPerson.trim(),
      taxNumber: draft.taxNumber.trim() === "" ? null : draft.taxNumber.trim(),
      category: draft.category.trim() === "" ? null : draft.category.trim(),
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      paymentTermsDays: draft.paymentTermsDays,
      currency: draft.currency.trim() === "" ? "EGP" : draft.currency.trim(),
      creditLimit: String(draft.creditLimit || 0),
      priceListId: draft.priceListId.trim() === "" ? null : draft.priceListId.trim(),
      taxExempt: draft.taxExempt,
      etaBuyerType: draft.etaBuyerType,
      nationalId: draft.nationalId.trim() === "" ? null : draft.nationalId.trim(),
    };
    try {
      if (editingId) {
        await updateCustomer.mutateAsync({ id: editingId, patch: { ...fields, active: draft.active } });
      } else {
        // "الكود: تلقائي إذا فارغ" — auto-generate a sequential code when left blank.
        const code = draft.code.trim() === "" ? `C${String(customers.length + 1).padStart(6, "0")}` : draft.code.trim();
        await createCustomer.mutateAsync({ id: crypto.randomUUID(), code, ...fields });
      }
      setPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ بيانات العميل");
    }
  }

  const formFields = (
      <div className="flex flex-col gap-[14px]">
        {error ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {error}
          </div>
        ) : null}
        <TextField label="اسم العميل *" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
        <TextField label="الاسم بالإنجليزي" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
        <TextField
          label="الكود"
          value={draft.code}
          onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
          placeholder="تلقائي إذا فارغ"
          disabled={editingId !== null}
        />
        <NumberField
          label="شروط الدفع (أيام)"
          value={draft.paymentTermsDays}
          onChange={(v) => setDraft((d) => ({ ...d, paymentTermsDays: v }))}
          min={0}
        />
        <TextField label="العملة" value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v }))} placeholder="EGP" />
        <NumberField
          label="الحد الائتماني"
          value={draft.creditLimit}
          onChange={(v) => setDraft((d) => ({ ...d, creditLimit: v }))}
          min={0}
          hint="دائماً بعملة المنشأة الأساسية بغض النظر عن عملة العميل"
        />
        <TextField label="التصنيف" value={draft.category} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} placeholder="بدون تصنيف" />
        <TextField label="قائمة الأسعار" value={draft.priceListId} onChange={(v) => setDraft((d) => ({ ...d, priceListId: v }))} placeholder="بدون قائمة أسعار" />
        <TextField label="الهاتف" type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} placeholder="01xxxxxxxx" />
        <TextField label="البريد الإلكتروني" type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
        <TextField label="الرقم الضريبي" value={draft.taxNumber} onChange={(v) => setDraft((d) => ({ ...d, taxNumber: v }))} placeholder="300xxxxxxxxx" />
        <SelectField
          label="نوع المشتري (ETA)"
          value={draft.etaBuyerType}
          onChange={(v) => setDraft((d) => ({ ...d, etaBuyerType: v as EtaBuyerTypeDTO }))}
          options={ETA_BUYER_TYPES.map((t) => ({ value: t, label: ETA_BUYER_TYPE_LABEL[t] }))}
        />
        <TextField label="الرقم القومي" value={draft.nationalId} onChange={(v) => setDraft((d) => ({ ...d, nationalId: v }))} />
        <ToggleField label="إعفاء ضريبي" checked={draft.taxExempt} onChange={(v) => setDraft((d) => ({ ...d, taxExempt: v }))} />
        <TextField label="جهة الاتصال" value={draft.contactPerson} onChange={(v) => setDraft((d) => ({ ...d, contactPerson: v }))} />
        <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
        {editingId ? <ToggleField label="نشط" checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} /> : null}
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={submit}>
            {editingId ? "حفظ التعديلات" : "إضافة عميل"}
          </Button>
        </div>
      </div>
  );

  if (selected) {
    return (
      <>
        <CustomerDetail customer={selected} onBack={() => setSelectedId(null)} onEdit={() => openEditForm(selected)} />
        <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? "تعديل عميل" : "إضافة عميل"} description="بيانات العميل الأساسية">
          {formFields}
        </SidePanel>
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل العملاء.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<CustomerDTO>
        eyebrow="Sales · Customers"
        title="العملاء"
        description="السجل المركزي للعملاء — بيانات الاتصال، شروط الائتمان، والتصنيف والتسعير"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة عميل
          </Button>
        }
        stats={[
          { label: "إجمالي العملاء", value: <span className="mz-num">{customers.length}</span> },
          { label: "نشط", value: <span className="mz-num">{customers.filter((c) => c.active).length}</span> },
          {
            label: "إجمالي حدود الائتمان",
            value: <MoneyValue value={customers.reduce((sum, c) => sum + num(c.creditLimit), 0)} showUnit={false} />,
          },
          {
            label: "إجمالي الأرصدة الافتتاحية",
            value: <MoneyValue value={customers.reduce((sum, c) => sum + num(c.openingBalance), 0)} showUnit={false} />,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as typeof statusFilter)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم أو الكود أو الهاتف…"
        columns={columns}
        rows={filtered}
        rowKey={(c) => c.id}
        onRowClick={(c) => setSelectedId(c.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{customers.length}</span> عميل
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا يوجد عملاء مطابقون</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? "تعديل عميل" : "إضافة عميل"} description="بيانات العميل الأساسية">
        {formFields}
      </SidePanel>
    </>
  );
}
