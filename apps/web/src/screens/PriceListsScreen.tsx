import { useState } from "react";
import {
  Button,
  DocumentList,
  SidePanel,
  StatusPill,
  TextArea,
  type DocumentListColumn,
} from "@mezan/ui";
import type { PriceListDTO } from "@mezan/contracts";
import { Field, TextField, ToggleField } from "../settings/form-controls";
import { useCreatePriceList, usePriceLists } from "../data/hooks";
import { useAppTranslation } from "../i18n";

/**
 * قوائم الأسعار (Price Lists — docs/catalog/01). Real data only: the list, the
 * create form and every count on this screen come from `GET/POST /price-lists`
 * through TanStack Query — no sample arrays.
 */
export function PriceListsScreen() {
  const { t } = useAppTranslation();
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
      header: t("priceLists.col.name"),
      render: (pl) => (
        <div>
          <div className="font-semibold text-ink">{pl.nameAr}</div>
          <div className="mz-num text-[11px] text-ink-muted">{pl.code}</div>
        </div>
      ),
    },
    { key: "description", header: t("priceLists.col.description"), render: (pl) => pl.description ?? "—" },
    {
      key: "lines",
      header: t("priceLists.col.items"),
      align: "end",
      render: (pl) => <span className="mz-num">{pl.lines.length}</span>,
    },
    {
      key: "status",
      header: t("priceLists.col.status"),
      render: (pl) => (
        <div className="flex items-center gap-1.5">
          <StatusPill label={pl.active ? t("priceLists.active") : t("priceLists.inactive")} tone={pl.active ? "success" : "neutral"} />
          {pl.isBase ? <StatusPill label={t("priceLists.base")} tone="info" /> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<PriceListDTO>
        title={t("priceLists.title")}
        description={t("priceLists.description")}
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            {t("priceLists.new")}
          </Button>
        }
        listKey="price-lists"
        statsCollapsible
        stats={[
          { label: t("priceLists.stat.total"), value: <span className="mz-num">{priceLists.length}</span> },
          { label: t("priceLists.stat.active"), value: <span className="mz-num">{priceLists.filter((p) => p.active).length}</span> },
        ]}
        columns={columns}
        rows={priceLists}
        rowKey={(pl) => pl.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("priceLists.showingPrefix")} <span className="mz-num">{priceLists.length}</span> {t("priceLists.showingOf")} <span className="mz-num">{priceLists.length}</span> {t("priceLists.showingSuffix")}
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? t("priceLists.loading") : t("priceLists.empty")}
          </div>
        }
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t("priceLists.new")}>
        <div className="flex flex-col gap-4 p-5">
          <TextField label={t("priceLists.field.name")} value={nameAr} onChange={setNameAr} placeholder={t("priceLists.field.namePlaceholder")} />
          <TextField label={t("priceLists.field.code")} value={code} onChange={setCode} placeholder="PL-001" />
          <Field label={t("priceLists.field.description")}>
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
          <ToggleField label={t("priceLists.field.isBase")} checked={isBase} onChange={setIsBase} hint={t("priceLists.field.isBaseHint")} />

          {create.isError ? (
            <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{create.error.message}</div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => setPanelOpen(false)}>
              {t("priceLists.cancel")}
            </Button>
            <Button variant="primary" onClick={submit} disabled={create.isPending || !code.trim() || !nameAr.trim()}>
              {t("priceLists.save")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}
