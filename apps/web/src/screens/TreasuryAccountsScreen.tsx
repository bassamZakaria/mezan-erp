import { useMemo, useState, type FormEvent } from "react";
import { DocumentList, Money as MoneyDisplay, StatusPill, Chip, Card, Button, SidePanel, MoneyInput, type DocumentListColumn, type PillTone } from "@mezan/ui";
import { TREASURY_ACCOUNT_TYPE_DEFINITIONS, getTreasuryAccountTypeLabel, type TreasuryAccountType as DomainTreasuryAccountType } from "@mezan/domain";
import type { TreasuryAccountDTO, TreasuryAccountStatusDTO, TreasuryAccountTypeDTO } from "@mezan/contracts";
import { demoTreasuryAccounts } from "../accounting-treasury-sample-data";
import { sampleBranches, branchName } from "../settings/sample-data";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";

/** حسابات الخزينة (Treasury Accounts) — docs/catalog/04 §"حسابات الخزينة". List + detail + add dialog. */

const STATUS_LABEL: Record<TreasuryAccountStatusDTO, string> = { active: "نشط", inactive: "غير نشط" };
const STATUS_TONE: Record<TreasuryAccountStatusDTO, PillTone> = { active: "success", inactive: "neutral" };

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

interface TreasuryAccountDraft {
  code: string;
  name: string;
  type: TreasuryAccountTypeDTO;
  currency: string;
  branchId: string;
  glAccountId: string;
  openingBalance: number | null;
  openingBalanceDate: string;
  active: boolean;
}

function blankDraft(): TreasuryAccountDraft {
  return {
    code: "",
    name: "",
    type: "cash",
    currency: "EGP",
    branchId: sampleBranches[0]?.id ?? "",
    glAccountId: "",
    openingBalance: 0,
    openingBalanceDate: "",
    active: true,
  };
}

function draftFromAccount(account: TreasuryAccountDTO): TreasuryAccountDraft {
  return {
    code: account.code,
    name: account.name,
    type: account.type,
    currency: account.currency,
    branchId: account.branchId,
    glAccountId: account.glAccountId ?? "",
    openingBalance: toMajor(account.openingBalance),
    openingBalanceDate: account.openingBalanceDate ?? "",
    active: account.status === "active",
  };
}

function validateDraft(draft: TreasuryAccountDraft, existing: TreasuryAccountDTO[], editingId: string | null): string | null {
  const code = draft.code.trim();
  if (code === "") return "الكود مطلوب.";
  if (existing.some((a) => a.code === code && a.id !== editingId)) return `الكود "${code}" مستخدم بالفعل — اختر كوداً آخر.`;
  if (draft.name.trim() === "") return "اسم الحساب مطلوب.";
  if (draft.branchId.trim() === "") return "الفرع مطلوب.";
  if (draft.type === "cash" && (draft.openingBalance ?? 0) < 0) {
    return "لا يمكن أن يكون الرصيد الافتتاحي لحساب نقدي رصيداً سالباً.";
  }
  return null;
}

export function TreasuryAccountsScreen() {
  const [accounts, setAccounts] = useState<TreasuryAccountDTO[]>(demoTreasuryAccounts);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "cash" | "bank" | "inactive">("all");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TreasuryAccountDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = accounts;
    if (filter === "active") rows = rows.filter((a) => a.status === "active");
    else if (filter === "inactive") rows = rows.filter((a) => a.status === "inactive");
    else if (filter === "cash") rows = rows.filter((a) => a.type === "cash");
    else if (filter === "bank") rows = rows.filter((a) => a.type === "bank");
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
    }
    return rows;
  }, [accounts, filter, search]);

  const totalBalance = accounts.reduce((sum, a) => sum + toMajor(a.openingBalance), 0);
  const cashBalance = accounts.filter((a) => a.type === "cash").reduce((sum, a) => sum + toMajor(a.openingBalance), 0);
  const bankBalance = accounts.filter((a) => a.type === "bank").reduce((sum, a) => sum + toMajor(a.openingBalance), 0);

  const selected = selectedId ? accounts.find((a) => a.id === selectedId) ?? null : null;

  function openCreateForm() {
    setEditingId(null);
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(account: TreasuryAccountDTO) {
    setEditingId(account.id);
    setDraft(draftFromAccount(account));
    setFormError(null);
    setFormOpen(true);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, accounts, editingId);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    if (editingId) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === editingId
            ? {
                ...a,
                code: draft.code.trim(),
                name: draft.name.trim(),
                type: draft.type,
                currency: draft.currency,
                branchId: draft.branchId,
                glAccountId: draft.glAccountId.trim() === "" ? null : draft.glAccountId.trim(),
                openingBalance: (draft.openingBalance ?? 0).toFixed(6),
                openingBalanceDate: draft.openingBalanceDate.trim() === "" ? null : draft.openingBalanceDate.trim(),
                status: draft.active ? "active" : "inactive",
              }
            : a,
        ),
      );
    } else {
      const newAccount: TreasuryAccountDTO = {
        id: `ta-${draft.code.trim()}-${Date.now()}`,
        code: draft.code.trim(),
        name: draft.name.trim(),
        type: draft.type,
        currency: draft.currency,
        branchId: draft.branchId,
        glAccountId: draft.glAccountId.trim() === "" ? null : draft.glAccountId.trim(),
        openingBalance: (draft.openingBalance ?? 0).toFixed(6),
        openingBalanceDate: draft.openingBalanceDate.trim() === "" ? null : draft.openingBalanceDate.trim(),
        status: "active",
      };
      setAccounts((prev) => [...prev, newAccount]);
    }
    setFormOpen(false);
  }

  const columns: DocumentListColumn<TreasuryAccountDTO>[] = [
    {
      key: "name",
      header: "اسم الحساب",
      render: (a) => (
        <div>
          <div className="font-semibold text-ink">{a.name}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">
            {a.code} · {branchName(a.branchId, sampleBranches)}
          </div>
        </div>
      ),
    },
    { key: "type", header: "نوع الحساب", render: (a) => <StatusPill label={getTreasuryAccountTypeLabel(a.type as DomainTreasuryAccountType)} tone="info" /> },
    { key: "currency", header: "العملة", render: (a) => a.currency },
    { key: "balance", header: "الرصيد", render: (a) => <MoneyDisplay value={toMajor(a.openingBalance)} /> },
    { key: "status", header: "الحالة", render: (a) => <StatusPill label={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} /> },
  ];

  return (
    <div className="w-full">
      <DocumentList<TreasuryAccountDTO>
        eyebrow="Treasury · Accounts"
        title="حسابات الخزينة"
        description="صناديق نقدية وحسابات بنكية، كل حساب مرتبط بفرع وبحساب دفتر أستاذ"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة حساب
          </Button>
        }
        stats={[
          { label: "إجمالي الحسابات", value: <span className="mz-num">{accounts.length}</span> },
          { label: "إجمالي الأرصدة", value: <MoneyDisplay value={totalBalance} /> },
          { label: "النقد المتاح", value: <MoneyDisplay value={cashBalance} /> },
          { label: "الرصيد البنكي", value: <MoneyDisplay value={bankBalance} /> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم..."
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            {(
              [
                ["all", "الكل"],
                ["active", "نشط"],
                ["cash", "نقدي"],
                ["bank", "بنكي"],
                ["inactive", "غير نشط"],
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} active={filter === value} onClick={() => setFilter(value)}>
                {label}
              </Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(a) => a.id}
        onRowClick={(a) => setSelectedId(a.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{accounts.length}</span> حساب
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد حسابات خزينة مطابقة</div>}
      />

      {/* -------- Treasury account detail panel -------- */}
      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? `كشف حساب — ${selected.name}` : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
                <StatusPill label={getTreasuryAccountTypeLabel(selected.type as DomainTreasuryAccountType)} tone="info" />
              </div>
              <Button variant="primary" onClick={() => openEditForm(selected)}>
                تعديل
              </Button>
            </div>
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الكود</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.code}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">العملة</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.currency}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الفرع</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{branchName(selected.branchId, sampleBranches)}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">حساب دفتر الأستاذ</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.glAccountId ?? "تلقائي حسب النوع"}</div>
              </div>
            </Card>
            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">الرصيد الختامي</div>
              <div className="mt-[6px]">
                <MoneyDisplay value={toMajor(selected.openingBalance)} className="text-[18px] font-bold" />
              </div>
              {selected.openingBalanceDate ? (
                <div className="mz-num mt-[6px] text-[11.5px] text-ink-faint">اعتباراً من {selected.openingBalanceDate}</div>
              ) : null}
            </Card>
            <div className="rounded-md border border-dashed border-border p-[18px] text-center text-[12.5px] text-ink-muted">
              ستُعرض حركات الحساب هنا فور ربط السندات النقدية بالخزينة (المرحلة الثانية).
            </div>
          </div>
        ) : null}
      </SidePanel>

      {/* -------- Add/edit treasury account form -------- */}
      <SidePanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? "تعديل حساب" : "إضافة حساب"}
        description="بيانات الحساب الأساسية"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label="اسم الحساب *" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label="الكود *" value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="CASH-003" />
          <SelectField
            label="نوع الحساب *"
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as TreasuryAccountTypeDTO }))}
            options={TREASURY_ACCOUNT_TYPE_DEFINITIONS.map((d) => ({ value: d.code, label: d.labelAr }))}
          />
          <TextField label="العملة *" value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v.toUpperCase() }))} />
          <SelectField
            label="الفرع *"
            value={draft.branchId}
            onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
            options={sampleBranches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <TextField
            label="حساب دفتر الأستاذ"
            value={draft.glAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, glAccountId: v }))}
            hint="لا تحتاج إلى تعبئة هذا الحقل غالباً. سيختار النظام الحساب المناسب تلقائياً حسب النوع."
          />

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">الرصيد الافتتاحي (اختياري)</h3>
            <div className="flex flex-col gap-[12px]">
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">الرصيد الافتتاحي</div>
                <MoneyInput value={draft.openingBalance} onChange={(v) => setDraft((d) => ({ ...d, openingBalance: v }))} />
              </div>
              <TextField
                label="تاريخ الرصيد الافتتاحي"
                value={draft.openingBalanceDate}
                onChange={(v) => setDraft((d) => ({ ...d, openingBalanceDate: v }))}
                placeholder="YYYY-MM-DD"
              />
            </div>
          </div>

          {editingId ? (
            <ToggleField label="نشط" checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
          ) : null}

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? "حفظ التعديلات" : "إضافة"}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
