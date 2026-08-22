import { useState } from "react";
import { Button, DocumentList, StatusPill, SidePanel, type DocumentListColumn } from "@mezan/ui";
import type { PriceListDTO } from "@mezan/contracts";
import { Field, TextField, ToggleField } from "../settings/form-controls";
import { useCreatePriceList, usePriceLists } from "../data/hooks";

/**
 * قوائم الأسعار (Price Lists — docs/catalog/01). Real data only: the list, the
 * create form and every count on this screen come from `GET/POST /price-lists`
 * through TanStack Query — no sample arrays.
 */
export function PriceListsScreen() {
  const query = usePriceLists();
  const priceLists = query.data ?? [];
  const create = useCreatePriceList();

  const [panelOpen, setPanelOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [description, setDescription] = useState("");
  const [isBase, setIsBase] = useState(false);

  function resetForm() {
    setCode("");
    setNameAr("");
    setDescription("");
    setIsBase(false);
  }

  async function submit() {
    if (!code.trim() || !nameAr.trim()) return;
    await create.mutateAsync({ code: code.trim(), nameAr: nameAr.trim(), description: description.trim() || null, isBase });
    setPanelOpen(false);
    resetForm();
  }

  const columns: DocumentListColumn<PriceListDTO>[] = [
    {
      key: "name",
      header: "الاسم",
      render: (pl) => (
        <div>
          <div className="font-semibold text-ink">{pl.nameAr}</div>
          <div className="mz-num text-[11px] text-ink-muted">{pl.code}</div>
        </div>
      ),
    },
    { key: "description", header: "الوصف", render: (pl) => pl.description ?? "—" },
    {
      key: "lines",
      header: "عدد الأصناف",
      align: "end",
      render: (pl) => <span className="mz-num">{pl.lines.length}</span>,
    },
    {
      key: "status",
      header: "الحالة",
      render: (pl) => (
        <div className="flex items-center gap-1.5">
          <StatusPill label={pl.active ? "نشطة" : "غير نشطة"} tone={pl.active ? "success" : "neutral"} />
          {pl.isBase ? <StatusPill label="قائمة أساسية" tone="info" /> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<PriceListDTO>
        eyebrow="Sales · Price Lists"
        title="قوائم الأسعار"
        description="قوائم أسعار بيع مخصصة يمكن ربطها بعميل أو تصنيف عملاء — تُطبّق على بنود الفواتير وعروض الأسعار."
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            قائمة أسعار جديدة
          </Button>
        }
        stats={[
          { label: "إجمالي القوائم", value: <span className="mz-num">{priceLists.length}</span> },
          { label: "النشطة", value: <span className="mz-num">{priceLists.filter((p) => p.active).length}</span> },
        ]}
        columns={columns}
        rows={priceLists}
        rowKey={(pl) => pl.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{priceLists.length}</span> من <span className="mz-num">{priceLists.length}</span> قائمة
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : "لا توجد قوائم أسعار — أنشئ قائمة جديدة"}
          </div>
        }
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="قائمة أسعار جديدة">
        <div className="flex flex-col gap-4 p-5">
          <TextField label="الاسم *" value={nameAr} onChange={setNameAr} placeholder="قائمة الأسعار الأساسية" />
          <TextField label="الكود *" value={code} onChange={setCode} placeholder="PL-001" />
          <Field label="الوصف">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none focus:border-brand"
            />
          </Field>
          <ToggleField label="قائمة أساسية" checked={isBase} onChange={setIsBase} hint="القائمة الأساسية تُطبّق افتراضياً على العملاء بلا قائمة أسعار محددة." />

          {create.isError ? (
            <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{create.error.message}</div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => setPanelOpen(false)}>
              إلغاء
            </Button>
            <Button variant="primary" onClick={submit} disabled={create.isPending || !code.trim() || !nameAr.trim()}>
              حفظ
            </Button>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}
