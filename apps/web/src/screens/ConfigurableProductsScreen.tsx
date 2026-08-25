import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  EntityPicker,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import {
  useConfigurableProducts,
  useCreateConfigurableProduct,
  useDeactivateConfigurableProduct,
  useItems,
  type ConfigurableProductRecord,
} from "../data/hooks";
import { TextField, NumberField, SelectField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

type Status = ConfigurableProductRecord["status"];

const STATUS_KEY: Record<Status, AppTranslationKey> = { active: "configProducts.status.active", inactive: "configProducts.status.inactive" };
const STATUS_TONE: Record<Status, PillTone> = { active: "success", inactive: "neutral" };
/** An unknown pricing method shows its own code rather than a humanized key. */
function pricingLabel(method: string, t: (key: AppTranslationKey) => string): string {
  const key = PRICING_KEY[method];
  return key ? t(key) : method;
}

const PRICING_KEY: Record<string, AppTranslationKey> = { manual: "configProducts.pricing.manual", formula: "configProducts.pricing.formula" };

interface DraftInput {
  id: string;
  labelAr: string;
  min: number | null;
  max: number | null;
}

interface DraftMaterial {
  itemId: string;
  qtyFormula: string;
  wastePercent: number;
}

function ProductDetail({
  product,
  itemName,
  onBack,
  onDeactivate,
  deactivating,
}: {
  product: ConfigurableProductRecord;
  itemName: (id: string) => string;
  onBack: () => void;
  onDeactivate: () => void;
  deactivating: boolean;
}) {
  const { t } = useAppTranslation();
  return (
    <DocumentDetail
      title={`${product.nameAr} (${product.code})`}
      statusLabel={t(STATUS_KEY[product.status])}
      statusTone={STATUS_TONE[product.status]}
      subtitle={t("configProducts.subtitle", { product: itemName(product.outputItemId) })}
      actions={
        <>
          {product.status === "active" ? (
            <Button onClick={onDeactivate} disabled={deactivating}>
              {t("configProducts.deactivate")}
            </Button>
          ) : null}
          <Button onClick={onBack}>{t("configProducts.backToConfigurableProducts")}</Button>
        </>
      }
      summary={[
        { label: t("common.code"), value: product.code },
        { label: t("configProducts.finishedProductUnit"), value: product.unit },
        { label: t("configProducts.inputs"), value: <span className="mz-num">{product.inputs.length}</span> },
        { label: t("configProducts.materials"), value: <span className="mz-num">{product.materials.length}</span> },
        { label: t("configProducts.pricingMethod"), value: pricingLabel(product.pricingMethod, t) },
      ]}
      effects={[
        t("configProducts.formulasAreEvaluatedInA"),
        t("configProducts.everyCustomOrderEvaluatesThese"),
      ]}
      tabs={[
        {
          key: "inputs",
          label: t("configProducts.tab.inputs", { count: product.inputs.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("configProducts.identifier")}</th>
                    <th className="px-[12px] py-[9px] text-start">{t("configProducts.label")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("configProducts.minimum")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("configProducts.maximum")}</th>
                  </tr>
                </thead>
                <tbody>
                  {product.inputs.map((inp, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px] font-mono">{inp.id}</td>
                      <td className="px-[12px] py-[10px]">{inp.labelAr}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{inp.min ?? "—"}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{inp.max ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          key: "materials",
          label: t("configProducts.tab.materials", { count: product.materials.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-start">{t("configProducts.quantityFormula")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("configProducts.scrapRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {product.materials.map((m, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(m.itemId)}</td>
                      <td className="px-[12px] py-[10px] font-mono">{m.qtyFormula}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.wastePercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          key: "pricing",
          label: t("configProducts.pricingAndCost"),
          content: (
            <dl className="grid grid-cols-1 gap-[10px] text-[13px]">
              <div><dt className="text-ink-muted">{t("configProducts.priceFormula")}</dt><dd className="font-mono">{product.priceFormula ?? t("configProducts.pricedByHand")}</dd></div>
              <div><dt className="text-ink-muted">{t("configProducts.labourFormula")}</dt><dd className="font-mono">{product.laborFormula ?? "—"}</dd></div>
              <div><dt className="text-ink-muted">{t("configProducts.overheadFormula")}</dt><dd className="font-mono">{product.overheadFormula ?? "—"}</dd></div>
            </dl>
          ),
        },
      ]}
    />
  );
}

export function ConfigurableProductsScreen() {
  const { t } = useAppTranslation();
  const query = useConfigurableProducts();
  const itemsQuery = useItems();
  const createProduct = useCreateConfigurableProduct();
  const deactivateProduct = useDeactivateConfigurableProduct();

  const products = query.data ?? [];
  const items = itemsQuery.data ?? [];

  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);
  const itemOptions: EntityPickerOption[] = items.map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.code }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [outputItem, setOutputItem] = useState<EntityPickerOption | null>(null);
  const [unit, setUnit] = useState("PCS");
  const [description, setDescription] = useState("");
  const [inputs, setInputs] = useState<DraftInput[]>([{ id: "", labelAr: "", min: null, max: null }]);
  const [materials, setMaterials] = useState<DraftMaterial[]>([{ itemId: "", qtyFormula: "", wastePercent: 0 }]);
  const [pricingMethod, setPricingMethod] = useState<"manual" | "formula">("manual");
  const [priceFormula, setPriceFormula] = useState("");
  const [laborFormula, setLaborFormula] = useState("");
  const [overheadFormula, setOverheadFormula] = useState("");
  const [itemPolicy, setItemPolicy] = useState<"per_order" | "per_spec">("per_order");
  const [formError, setFormError] = useState<string | null>(null);

  const selected = products.find((p) => p.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = products;
    if (statusFilter !== "all") rows = rows.filter((p) => p.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((p) => p.code.toLowerCase().includes(q) || p.nameAr.includes(search.trim()));
    }
    return rows;
  }, [products, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: products.length },
    { key: "active", label: t("common.active"), count: products.filter((p) => p.status === "active").length },
    { key: "inactive", label: t("common.inactive"), count: products.filter((p) => p.status === "inactive").length },
  ];

  const columns: DocumentListColumn<ConfigurableProductRecord>[] = [
    { key: "code", header: t("common.code"), render: (p) => <span className="font-semibold text-ink">{p.code}</span> },
    { key: "name", header: t("common.name"), render: (p) => p.nameAr },
    { key: "inputs", header: t("configProducts.configurationInputs"), render: (p) => p.inputs.map((i) => i.labelAr).join(t("common.notes")) },
    { key: "materials", header: t("configProducts.manufacturingMaterials"), align: "end", render: (p) => <span className="mz-num">{p.materials.length}</span> },
    { key: "unit", header: t("configProducts.productUnit"), render: (p) => p.unit },
    { key: "status", header: t("common.status"), render: (p) => <StatusPill label={t(STATUS_KEY[p.status])} tone={STATUS_TONE[p.status]} /> },
  ];

  function openCreate() {
    setCode("");
    setNameAr("");
    setNameEn("");
    setOutputItem(null);
    setUnit("PCS");
    setDescription("");
    setInputs([{ id: "", labelAr: "", min: null, max: null }]);
    setMaterials([{ itemId: "", qtyFormula: "", wastePercent: 0 }]);
    setPricingMethod("manual");
    setPriceFormula("");
    setLaborFormula("");
    setOverheadFormula("");
    setItemPolicy("per_order");
    setFormError(null);
    setPanelOpen(true);
  }

  const validInputs = inputs.filter((i) => i.id.trim() !== "" && i.labelAr.trim() !== "");
  const validMaterials = materials.filter((m) => m.itemId !== "" && m.qtyFormula.trim() !== "");
  const canSave =
    code.trim() !== "" &&
    nameAr.trim() !== "" &&
    outputItem !== null &&
    validInputs.length > 0 &&
    validMaterials.length > 0 &&
    (pricingMethod !== "formula" || priceFormula.trim() !== "");

  async function save() {
    if (!outputItem) return;
    setFormError(null);
    try {
      await createProduct.mutateAsync({
        id: crypto.randomUUID(),
        code: code.trim(),
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim() === "" ? null : nameEn.trim(),
        outputItemId: outputItem.id,
        unit,
        description: description.trim() === "" ? null : description.trim(),
        inputs: validInputs.map((i) => ({ id: i.id.trim(), labelAr: i.labelAr.trim(), min: i.min, max: i.max })),
        materials: validMaterials.map((m) => ({ itemId: m.itemId, qtyFormula: m.qtyFormula.trim(), wastePercent: m.wastePercent })),
        pricingMethod,
        priceFormula: pricingMethod === "formula" && priceFormula.trim() !== "" ? priceFormula.trim() : null,
        laborFormula: laborFormula.trim() === "" ? null : laborFormula.trim(),
        overheadFormula: overheadFormula.trim() === "" ? null : overheadFormula.trim(),
        itemPolicy,
      });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("configProducts.theConfigurableProductCouldNot"));
    }
  }

  async function deactivate(id: string) {
    try {
      await deactivateProduct.mutateAsync(id);
    } catch {
      // The list/detail re-render from the failed mutation's settled cache; nothing further to do here.
    }
  }

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t("configProducts.newConfigurableProduct")} description={t("configProducts.defineTheInputsAndThe")}>
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-[10px]">
          <TextField label={t("configProducts.code")} value={code} onChange={setCode} />
          <TextField label={t("configProducts.arabicName")} value={nameAr} onChange={setNameAr} />
        </div>
        <TextField label={t("configProducts.englishName")} value={nameEn} onChange={setNameEn} />
        <EntityPicker
          label={t("configProducts.resultingProduct")}
          value={outputItem}
          onChange={(opt) => {
            setOutputItem(opt);
            const item = items.find((i) => i.id === opt?.id);
            if (item) setUnit(item.baseUnitCode);
          }}
          options={itemOptions}
          placeholder={t("configProducts.chooseTheResultingProduct")}
        />
        <TextField label={t("configProducts.finishedProductUnit")} value={unit} onChange={setUnit} />
        <TextField label={t("configProducts.description")} value={description} onChange={setDescription} />

        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">{t("configProducts.configurationInputs2")}</span>
          {inputs.map((inp, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
              <div className="grid grid-cols-2 gap-[10px]">
                <TextField
                  label={t("configProducts.identifierForFormulas")}
                  value={inp.id}
                  onChange={(v) => setInputs((prev) => prev.map((x, j) => (j === i ? { ...x, id: v } : x)))}
                  placeholder="width"
                />
                <TextField
                  label={t("configProducts.label")}
                  value={inp.labelAr}
                  onChange={(v) => setInputs((prev) => prev.map((x, j) => (j === i ? { ...x, labelAr: v } : x)))}
                  placeholder={t("configProducts.display")}
                />
              </div>
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <NumberField
                  label={t("configProducts.minimum")}
                  value={inp.min ?? Number.NaN}
                  onChange={(v) => setInputs((prev) => prev.map((x, j) => (j === i ? { ...x, min: Number.isNaN(v) ? null : v } : x)))}
                />
                <NumberField
                  label={t("configProducts.maximum")}
                  value={inp.max ?? Number.NaN}
                  onChange={(v) => setInputs((prev) => prev.map((x, j) => (j === i ? { ...x, max: Number.isNaN(v) ? null : v } : x)))}
                />
              </div>
              {inputs.length > 1 ? (
                <div className="mt-[8px] flex justify-end">
                  <Button onClick={() => setInputs((prev) => prev.filter((_, j) => j !== i))}>{t("configProducts.removeInput")}</Button>
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => setInputs((prev) => [...prev, { id: "", labelAr: "", min: null, max: null }])}>{t("configProducts.addInput")}</Button>
        </div>

        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">{t("configProducts.manufacturingMaterials2")}</span>
          {materials.map((m, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
              <EntityPicker
                label={t("common.item")}
                value={itemOptions.find((o) => o.id === m.itemId) ?? null}
                onChange={(opt) => setMaterials((prev) => prev.map((x, j) => (j === i ? { ...x, itemId: opt?.id ?? "" } : x)))}
                options={itemOptions}
                placeholder={t("configProducts.chooseAnItem")}
              />
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <TextField
                  label={t("configProducts.quantityFormula")}
                  value={m.qtyFormula}
                  onChange={(v) => setMaterials((prev) => prev.map((x, j) => (j === i ? { ...x, qtyFormula: v } : x)))}
                  placeholder="width*height/10000"
                />
                <NumberField
                  label={t("configProducts.scrapRate2")}
                  value={m.wastePercent}
                  min={0}
                  onChange={(v) => setMaterials((prev) => prev.map((x, j) => (j === i ? { ...x, wastePercent: v } : x)))}
                />
              </div>
              {materials.length > 1 ? (
                <div className="mt-[8px] flex justify-end">
                  <Button onClick={() => setMaterials((prev) => prev.filter((_, j) => j !== i))}>{t("configProducts.removeMaterial")}</Button>
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => setMaterials((prev) => [...prev, { itemId: "", qtyFormula: "", wastePercent: 0 }])}>{t("configProducts.addMaterial")}</Button>
        </div>

        <SelectField
          label={t("configProducts.pricingMethod")}
          value={pricingMethod}
          onChange={(v) => setPricingMethod(v as "manual" | "formula")}
          options={[
            { value: "manual", label: t("configProducts.nonePricedByHand") },
            { value: "formula", label: t("configProducts.formula") },
          ]}
        />
        {pricingMethod === "formula" ? (
          <TextField label={t("configProducts.priceFormulaPerUnit")} value={priceFormula} onChange={setPriceFormula} placeholder="width*height*3.5/100" />
        ) : null}
        <TextField label={t("configProducts.labourCostFormulaPerUnit")} value={laborFormula} onChange={setLaborFormula} placeholder="width/10" />
        <TextField label={t("configProducts.overheadFormulaPerUnit")} value={overheadFormula} onChange={setOverheadFormula} placeholder="5" />
        <SelectField
          label={t("configProducts.itemPolicy")}
          value={itemPolicy}
          onChange={(v) => setItemPolicy(v as "per_order" | "per_spec")}
          options={[
            { value: "per_order", label: t("configProducts.oneItemPerOrder") },
            { value: "per_spec", label: t("configProducts.oneItemPerSpecification") },
          ]}
        />

        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createProduct.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <ProductDetail
          product={selected}
          itemName={itemName}
          onBack={() => setSelectedId(null)}
          onDeactivate={() => deactivate(selected.id)}
          deactivating={deactivateProduct.isPending}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("configProducts.configurableProductsCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<ConfigurableProductRecord>
        title={t("configProducts.configurableProducts")}
        description={t("configProducts.productsWhoseMaterialsAndPrice")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("configProducts.addConfigurableProduct")}
          </Button>
        }
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{products.length}</span> },
          { label: t("common.active"), value: <span className="mz-num">{products.filter((p) => p.status === "active").length}</span> },
          { label: t("common.inactive"), value: <span className="mz-num">{products.filter((p) => p.status === "inactive").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as Status | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("configProducts.searchByCodeOrName")}
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
        onRowClick={(p) => setSelectedId(p.id)}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{products.length}</span> {t("configProducts.products")}</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? t("common.loading") : t("configProducts.noMatchingConfigurableProductsAdd")}
          </div>
        }
      />
      {panel}
    </>
  );
}
