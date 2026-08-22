import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  DocumentDetail,
  Money as MoneyValue,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import { Money, createSupplier, updateSupplier, InvalidSupplierError, type Supplier } from "@mezan/domain";
import { demoSuppliers } from "../partners-sample-data";
import { TextField, NumberField, ToggleField } from "../settings/form-controls";

/**
 * الموردون (Suppliers) — docs/catalog/02-purchases.md "الموردون". The mirror
 * of CustomersScreen.tsx: same DocumentList/DocumentDetail/SidePanel shape,
 * sample-data-driven, no live API wiring yet (apps/server exposes the real
 * routes already). Purchase invoices/orders/returns and the running "المستحق
 * للمورد" balance are Phase-2 (document) work — تبويبات فواتير المشتريات/كشف
 * حساب/المرفقات render as explicit stubs; only the supplier master record
 * itself (incl. its `openingBalance`) is real.
 */

function toDisplayNumber(value: Money): number {
  return Number(value.toString());
}

function StubTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[8px] rounded-lg border border-dashed border-border p-[36px] text-center">
      <StatusPill label="قريباً" tone="info" />
      <p className="text-[12.5px] text-ink-muted">
        تبويب "{label}" يُعرض فور ربط المستندات (فواتير المشتريات) بسجل المورد — المرحلة الثانية.
      </p>
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

function draftFromSupplier(supplier: Supplier): SupplierDraft {
  return {
    code: supplier.code,
    nameAr: supplier.nameAr,
    nameEn: supplier.nameEn ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    contactPerson: supplier.contactPerson ?? "",
    taxNumber: supplier.taxNumber ?? "",
    category: supplier.category ?? "",
    notes: supplier.notes ?? "",
    paymentTermsDays: supplier.paymentTermsDays,
    currency: supplier.currency,
    openingBalance: toDisplayNumber(supplier.openingBalance),
    addressCity: supplier.addressCity ?? "",
    addressDistrict: supplier.addressDistrict ?? "",
    addressStreet: supplier.addressStreet ?? "",
    active: supplier.active,
  };
}

let nextId = demoSuppliers.length + 1;

function SupplierDetail({ supplier, onBack, onEdit }: { supplier: Supplier; onBack: () => void; onEdit: () => void }) {
  const address = [supplier.addressStreet, supplier.addressDistrict, supplier.addressCity].filter(Boolean).join("، ");
  return (
    <DocumentDetail
      title={`${supplier.nameAr} · ${supplier.code}`}
      statusLabel={supplier.active ? "نشط" : "غير نشط"}
      statusTone={supplier.active ? "success" : "neutral"}
      subtitle={supplier.nameEn ?? undefined}
      actions={
        <>
          <Button variant="primary" onClick={onEdit}>
            تعديل
          </Button>
          <Button onClick={onBack}>رجوع لقائمة الموردين</Button>
        </>
      }
      summary={[
        { label: "التصنيف", value: supplier.category ?? "بدون تصنيف" },
        { label: "شروط الدفع", value: <span className="mz-num">{supplier.paymentTermsDays} يوم</span> },
        { label: "العملة", value: supplier.currency },
        { label: "الهاتف", value: supplier.phone ?? "لا يوجد" },
        {
          label: "المستحق للمورد (الرصيد الافتتاحي)",
          value: <MoneyValue value={toDisplayNumber(supplier.openingBalance)} />,
        },
        { label: "تاريخ الإنشاء", value: "—" },
      ]}
      tabs={[
        {
          key: "overview",
          label: "نظرة عامة",
          content: (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
              {[
                { label: "البريد الإلكتروني", value: supplier.email ?? "لا يوجد" },
                { label: "جهة الاتصال", value: supplier.contactPerson ?? "لا يوجد" },
                { label: "الرقم الضريبي", value: supplier.taxNumber ?? "لا يوجد" },
                { label: "العنوان", value: address === "" ? "لا يوجد" : address },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{row.label}</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{row.value}</div>
                </div>
              ))}
              {supplier.notes ? (
                <div className="col-span-full rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">ملاحظات</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{supplier.notes}</div>
                </div>
              ) : null}
            </div>
          ),
        },
        { key: "invoices", label: "فواتير المشتريات", content: <StubTab label="فواتير المشتريات" /> },
        { key: "statement", label: "كشف حساب المورد", content: <StubTab label="كشف حساب المورد" /> },
        { key: "attachments", label: "المرفقات", content: <StubTab label="المرفقات" /> },
      ]}
    />
  );
}

export function SuppliersScreen() {
  const [suppliers, setSuppliers] = useState<Supplier[]>(demoSuppliers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SupplierDraft>(BLANK_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const selected = suppliers.find((s) => s.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = suppliers;
    if (statusFilter !== "all") rows = rows.filter((s) => (statusFilter === "active" ? s.active : !s.active));
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (s) => s.nameAr.includes(search.trim()) || s.code.toLowerCase().includes(q) || (s.phone ?? "").includes(search.trim()),
      );
    }
    return rows;
  }, [suppliers, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: suppliers.length },
    { key: "active", label: "نشط", count: suppliers.filter((s) => s.active).length },
    { key: "inactive", label: "غير نشط", count: suppliers.filter((s) => !s.active).length },
  ];

  const columns: DocumentListColumn<Supplier>[] = [
    {
      key: "name",
      header: "المورد",
      render: (s) => (
        <div>
          <div className="font-semibold text-ink">{s.nameAr}</div>
          <div className="mz-num text-[11.5px] text-ink-faint">{s.code}</div>
        </div>
      ),
    },
    { key: "phone", header: "الهاتف", render: (s) => s.phone ?? "—" },
    { key: "terms", header: "شروط الدفع", render: (s) => <span className="mz-num">{s.paymentTermsDays} يوم</span> },
    { key: "category", header: "التصنيف", render: (s) => s.category ?? "بدون تصنيف" },
    { key: "openingBalance", header: "المستحق للمورد", align: "end", render: (s) => <MoneyValue value={toDisplayNumber(s.openingBalance)} /> },
    {
      key: "status",
      header: "الحالة",
      render: (s) => <StatusPill label={s.active ? "نشط" : "غير نشط"} tone={(s.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setError(null);
    setPanelOpen(true);
  }

  function openEditForm(supplier: Supplier) {
    setEditingId(supplier.id);
    setDraft(draftFromSupplier(supplier));
    setError(null);
    setPanelOpen(true);
  }

  function submit() {
    setError(null);
    try {
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
        openingBalance: Money.fromMajor(String(draft.openingBalance || 0)),
        addressCity: draft.addressCity.trim() === "" ? null : draft.addressCity.trim(),
        addressDistrict: draft.addressDistrict.trim() === "" ? null : draft.addressDistrict.trim(),
        addressStreet: draft.addressStreet.trim() === "" ? null : draft.addressStreet.trim(),
      };
      if (editingId) {
        const current = suppliers.find((s) => s.id === editingId);
        if (!current) return;
        const updated = updateSupplier(current, { ...fields, code: current.code, active: draft.active });
        setSuppliers((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
      } else {
        // "الكود: تلقائي إذا فارغ" — auto-generate a sequential code when left blank.
        const code = draft.code.trim() === "" ? `S${String(nextId).padStart(6, "0")}` : draft.code.trim();
        const created = createSupplier({ id: `sup-${nextId++}`, code, ...fields });
        setSuppliers((prev) => [...prev, created]);
      }
      setPanelOpen(false);
    } catch (err) {
      setError(err instanceof InvalidSupplierError ? err.message : "تعذر حفظ بيانات المورد");
    }
  }

  const formFields = (
    <div className="flex flex-col gap-[14px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <TextField label="اسم المورد *" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
      <TextField
        label="الكود"
        value={draft.code}
        onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
        placeholder="تلقائي إذا فارغ"
        disabled={editingId !== null}
      />
      <TextField label="الهاتف" type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} placeholder="01xxxxxxxx" />
      <NumberField
        label="شروط الدفع (أيام)"
        value={draft.paymentTermsDays}
        onChange={(v) => setDraft((d) => ({ ...d, paymentTermsDays: v }))}
        min={0}
      />
      <TextField label="العملة" value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v }))} placeholder="EGP" />
      <TextField label="التصنيف" value={draft.category} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} placeholder="بدون تصنيف" />
      <NumberField
        label="الرصيد الافتتاحي"
        value={draft.openingBalance}
        onChange={(v) => setDraft((d) => ({ ...d, openingBalance: v }))}
        hint="المبلغ المستحق للمورد عند بدء التعامل معه في مزان"
      />
      <TextField label="الاسم بالإنجليزي" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
      <TextField label="البريد الإلكتروني" type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
      <TextField label="الرقم الضريبي" value={draft.taxNumber} onChange={(v) => setDraft((d) => ({ ...d, taxNumber: v }))} placeholder="300xxxxxxxxx" />
      <TextField label="جهة الاتصال" value={draft.contactPerson} onChange={(v) => setDraft((d) => ({ ...d, contactPerson: v }))} />
      <TextField label="المدينة" value={draft.addressCity} onChange={(v) => setDraft((d) => ({ ...d, addressCity: v }))} />
      <TextField label="الحي" value={draft.addressDistrict} onChange={(v) => setDraft((d) => ({ ...d, addressDistrict: v }))} />
      <TextField label="الشارع" value={draft.addressStreet} onChange={(v) => setDraft((d) => ({ ...d, addressStreet: v }))} />
      <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
      {editingId ? <ToggleField label="نشط" checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} /> : null}
      <div className="flex justify-end gap-[9px]">
        <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
        <Button variant="primary" onClick={submit}>
          {editingId ? "حفظ التعديلات" : "إضافة مورد"}
        </Button>
      </div>
    </div>
  );

  if (selected) {
    return (
      <>
        <SupplierDetail supplier={selected} onBack={() => setSelectedId(null)} onEdit={() => openEditForm(selected)} />
        <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? "تعديل مورد" : "إضافة مورد"} description="بيانات المورد الأساسية">
          {formFields}
        </SidePanel>
      </>
    );
  }

  return (
    <>
      <DocumentList<Supplier>
        eyebrow="Purchases · Suppliers"
        title="الموردون"
        description="السجل المركزي للموردين — بيانات الاتصال، شروط الدفع، والتصنيف والعنوان"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة مورد
          </Button>
        }
        stats={[
          { label: "إجمالي الموردين", value: <span className="mz-num">{suppliers.length}</span> },
          { label: "نشط", value: <span className="mz-num">{suppliers.filter((s) => s.active).length}</span> },
          {
            label: "المستحق للموردين",
            value: <MoneyValue value={suppliers.reduce((sum, s) => sum + toDisplayNumber(s.openingBalance), 0)} showUnit={false} />,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as typeof statusFilter)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث باسم المورد أو الكود أو الهاتف…"
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.id}
        onRowClick={(s) => setSelectedId(s.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{suppliers.length}</span> مورد
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا يوجد موردون مطابقون</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? "تعديل مورد" : "إضافة مورد"} description="بيانات المورد الأساسية">
        {formFields}
      </SidePanel>
    </>
  );
}
