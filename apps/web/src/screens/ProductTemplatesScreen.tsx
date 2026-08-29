import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  Checkbox,
  DocumentList,
  EmptyState,
  SidePanel,
  StatusPill,
  TextInput,
  type DocumentListColumn,
} from "@mezan/ui";
import type { CreateProductTemplateDTO, ProductTemplateDTO } from "@mezan/contracts";
import {
  ApiError,
  useAddAttributeValue,
  useAddTemplateAttribute,
  useCreateProductTemplate,
  useDeleteAttributeValue,
  useDeleteTemplateAttribute,
  useGenerateVariants,
  useProductTemplates,
  useTemplateVariants,
} from "../data/hooks";
import { useConfirmAction } from "../lib/use-confirm-action";
import { SelectField, TextField } from "../settings/form-controls";
import { useItemSpecifications } from "../data/item-catalog-hooks";
import { useAppTranslation } from "../i18n";
import { EMPTY } from "../lib/empty";
import { useUrlNumber } from "../lib/url-state";

/**
 * قوالب المنتجات (Product Templates) — docs/archive/catalog/03-inventory.md §"قوالب
 * المنتجات". Attribute-driven variant/SKU generation: define a product once
 * with named characteristics (color, size, ...), enumerate each attribute's
 * values, then mass-generate the resulting combinations as real, independent
 * Items.
 */

interface CreateDraft {
  code: string;
  nameAr: string;
  baseUnitCode: string;
  defaultSalePrice: string;
  defaultCost: string;
}

function blankCreateDraft(): CreateDraft {
  return { code: "", nameAr: "", baseUnitCode: "PCS", defaultSalePrice: "", defaultCost: "" };
}

/** Order-independent key matching the domain's `variantKey` exactly. */
function comboKey(values: Record<string, string>): string {
  return Object.keys(values).sort().map((k) => `${k}=${values[k]}`).join("|");
}

function cartesianCombinations(attributes: ProductTemplateDTO["attributes"]): Record<string, string>[] {
  return attributes.reduce<Record<string, string>[]>((acc, attr) => {
    if (attr.values.length === 0) return acc;
    if (acc.length === 0) return attr.values.map((v) => ({ [attr.id]: v }));
    return acc.flatMap((combo) => attr.values.map((v) => ({ ...combo, [attr.id]: v })));
  }, []);
}

function comboLabel(attributes: ProductTemplateDTO["attributes"], values: Record<string, string>): string {
  return attributes.map((a) => values[a.id]).join(" / ");
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function ProductTemplatesScreen() {
  const { t } = useAppTranslation();
  const query = useProductTemplates();
  const createTemplate = useCreateProductTemplate();
  const addAttribute = useAddTemplateAttribute();
  const deleteAttribute = useDeleteTemplateAttribute();
  const addValue = useAddAttributeValue();
  const deleteValue = useDeleteAttributeValue();
  const generate = useGenerateVariants();

  const templates = query.data ?? [];

  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const pageCount = Math.max(1, Math.ceil(templates.length / pageSize));
  const pageRows = templates.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(blankCreateDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attrError, setAttrError] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const [newAttrName, setNewAttrName] = useState("");
  const [newAttrValues, setNewAttrValues] = useState("");
  const [newAttrSpecCode, setNewAttrSpecCode] = useState("");
  const [selectedCombos, setSelectedCombos] = useState<Set<string>>(new Set());

  const selected = selectedId ? templates.find((t) => t.id === selectedId) ?? null : null;
  const variantsQuery = useTemplateVariants(selectedId);
  const variants = variantsQuery.data ?? EMPTY;
  const existingKeys = useMemo(() => new Set(variants.map((v) => comboKey(v.values))), [variants]);
  const combos = useMemo(() => (selected ? cartesianCombinations(selected.attributes) : []), [selected]);

  const specificationsQuery = useItemSpecifications();
  const specificationOptions = useMemo(() => {
    const selectable = (specificationsQuery.data ?? []).filter((s) => s.type === "select" && s.status === "active");
    return [{ value: "", label: t("templates.anAttributeSpecificToThis") }, ...selectable.map((s) => ({ value: s.code, label: `${s.nameAr} (${s.code})` }))];
  }, [specificationsQuery.data, t]);

  function openCreateForm() {
    setDraft(blankCreateDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.code.trim() === "" || draft.nameAr.trim() === "" || draft.baseUnitCode.trim() === "") {
      setFormError(t("templates.codeNameAndUnitOf"));
      return;
    }
    setFormError(null);
    const body: CreateProductTemplateDTO = {
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      baseUnitCode: draft.baseUnitCode.trim(),
      defaultSalePrice: draft.defaultSalePrice.trim() === "" ? null : draft.defaultSalePrice.trim(),
      defaultCost: draft.defaultCost.trim() === "" ? null : draft.defaultCost.trim(),
    };
    try {
      const created = await createTemplate.mutateAsync(body);
      setFormOpen(false);
      setSelectedId(created.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("templates.theProductTemplateCouldNot"));
    }
  }

  async function handleAddAttribute() {
    if (!selected) return;
    setAttrError(null);
    try {
      if (newAttrSpecCode !== "") {
        await addAttribute.mutateAsync({ templateId: selected.id, body: { specificationCode: newAttrSpecCode } });
      } else {
        const values = newAttrValues.split(",").map((v) => v.trim()).filter((v) => v !== "");
        if (newAttrName.trim() === "" || values.length === 0) {
          setAttrError(t("templates.theAttributeNeedsAName"));
          return;
        }
        await addAttribute.mutateAsync({ templateId: selected.id, body: { nameAr: newAttrName.trim(), values } });
      }
      setNewAttrName("");
      setNewAttrValues("");
      setNewAttrSpecCode("");
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : t("templates.theAttributeCouldNotBe"));
    }
  }

  async function handleDeleteAttribute(attributeId: string) {
    if (!selected) return;
    setAttrError(null);
    try {
      await deleteAttribute.mutateAsync({ templateId: selected.id, attributeId });
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : t("templates.theAttributeCouldNotBe2"));
    }
  }

  async function handleDeleteValue(attributeId: string, value: string) {
    if (!selected) return;
    setAttrError(null);
    try {
      await deleteValue.mutateAsync({ templateId: selected.id, attributeId, value });
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : t("templates.theValueCouldNotBe"));
    }
  }

  async function handleAddValue(attributeId: string, value: string) {
    if (!selected || value.trim() === "") return;
    setAttrError(null);
    try {
      await addValue.mutateAsync({ templateId: selected.id, attributeId, body: { value: value.trim() } });
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : t("templates.theValueCouldNotBe2"));
    }
  }

  function toggleCombo(key: string) {
    setSelectedCombos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleGenerate() {
    if (!selected) return;
    const selections = combos.filter((c) => selectedCombos.has(comboKey(c))).map((values) => ({ values }));
    if (selections.length === 0) return;
    setAttrError(null);
    try {
      await generate.mutateAsync({ templateId: selected.id, body: { selections } });
      setSelectedCombos(new Set());
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : t("templates.theVariantsCouldNotBe"));
    }
  }

  const columns: DocumentListColumn<ProductTemplateDTO>[] = [
    { key: "name", header: t("templates.productName"), render: (row) => <span className="font-semibold text-ink">{row.nameAr}</span> },
    { key: "code", header: t("common.code"), render: (row) => <span className="mz-num text-ink-faint">{row.code}</span> },
    { key: "attributes", header: t("templates.attributes"), align: "end", render: (row) => <span className="mz-num">{row.attributes.length}</span> },
    { key: "status", header: t("common.status"), render: (row) => <StatusPill label={row.status === "active" ? t("common.active") : t("common.inactive")} tone={row.status === "active" ? "success" : "neutral"} /> },
  ];

  const newComboCount = combos.filter((c) => !existingKeys.has(comboKey(c))).length;

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("templates.productTemplatesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<ProductTemplateDTO>
        title={t("templates.productTemplates")}
        description={t("templates.defineAProductWithAttributes")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("templates.newTemplate")}
          </Button>
        }
        listKey="product-templates"
        statsCollapsible
        stats={[{ label: t("templates.totalTemplates"), value: <span className="mz-num">{templates.length}</span> }]}
        columns={columns}
        rows={pageRows}
        loading={specificationsQuery.isLoading}
        rowKey={(t) => t.id}
        onRowClick={(t) => {
          setSelectedId(t.id);
          setSelectedCombos(new Set());
          setAttrError(null);
        }}
        page={page}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{templates.length}</span> {t("templates.templates")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("templates.noProductTemplatesYetCreate")}
            description={t("templates.emptyBody")}
            action={{ label: t("templates.newTemplate"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("templates.newProductTemplate")}>
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <TextField label={t("templates.productName2")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label={t("templates.code")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} />
          <TextField label={t("templates.baseUnitOfMeasure")} value={draft.baseUnitCode} onChange={(v) => setDraft((d) => ({ ...d, baseUnitCode: v }))} />
          <TextField label={t("templates.defaultPrice")} value={draft.defaultSalePrice} onChange={(v) => setDraft((d) => ({ ...d, defaultSalePrice: v }))} placeholder="0.00" />
          <TextField label={t("templates.defaultCost")} value={draft.defaultCost} onChange={(v) => setDraft((d) => ({ ...d, defaultCost: v }))} placeholder="0.00" />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("templates.create")}
            </Button>
          </div>
        </form>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? selected.nameAr : ""} description={selected ? selected.code : undefined}>
        {selected ? (
          <div className="flex flex-col gap-[18px]">
            {attrError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {attrError}
              </div>
            ) : null}

            <div>
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">{t("templates.attributes")}</h3>
              <div className="flex flex-col gap-[10px]">
                {selected.attributes.map((attr) => (
                  <Card key={attr.id} className="p-[12px_14px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-ink">
                        {attr.nameAr} <span className="text-ink-faint">({attr.values.length})</span>
                      </span>
                      <Button
                        size="sm"
                        onClick={() =>
                          confirm.ask({
                            title: t("templates.confirmRemoveAttributeTitle"),
                            consequence: t("templates.confirmRemoveAttributeBody", { name: attr.nameAr }),
                            confirmLabel: t("templates.removeAttribute"),
                            onConfirm: () => handleDeleteAttribute(attr.id),
                          })
                        }
                      >
                        {t("templates.removeAttribute")}
                      </Button>
                    </div>
                    <div className="mt-[8px] flex flex-wrap gap-[6px]">
                      {attr.values.map((value) => (
                        <span key={value} className="inline-flex items-center gap-[6px] rounded-full border border-border bg-surface-2 px-[10px] py-[3px] text-[12px] text-ink">
                          {value}
                          <button
                            type="button"
                            className="text-ink-faint hover:text-danger-ink"
                            aria-label={t("templates.deleteValue", { value })}
                            onClick={() =>
                              confirm.ask({
                                title: t("templates.confirmRemoveValueTitle"),
                                consequence: t("templates.confirmRemoveValueBody", { value }),
                                confirmLabel: t("common.delete"),
                                onConfirm: () => handleDeleteValue(attr.id, value),
                              })
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <AddValueInline onAdd={(v) => void handleAddValue(attr.id, v)} />
                    </div>
                  </Card>
                ))}
                {selected.attributes.length === 0 ? <p className="text-[12.5px] text-ink-muted">{t("templates.noAttributesYet")}</p> : null}
              </div>

              <Card className="mt-[10px] p-[12px_14px]">
                <div className="flex flex-col gap-[8px]">
                  {specificationOptions.length > 1 ? (
                    <SelectField
                      label={t("templates.fromTheSpecificationRegister")}
                      value={newAttrSpecCode}
                      onChange={setNewAttrSpecCode}
                      options={specificationOptions}
                      hint={t("templates.pickAReadyMadeSpecification")}
                    />
                  ) : null}
                  {newAttrSpecCode === "" ? (
                    <>
                      <TextField label={t("templates.attributeName")} value={newAttrName} onChange={setNewAttrName} placeholder={t("templates.forExampleColour")} />
                      <TextField label={t("templates.valuesSeparatedByCommas")} value={newAttrValues} onChange={setNewAttrValues} placeholder={t("templates.redBlueGreen")} />
                    </>
                  ) : null}
                  <Button size="sm" onClick={() => void handleAddAttribute()}>
                    {t("templates.addAttribute")}
                  </Button>
                </div>
              </Card>
            </div>

            {selected.attributes.length > 0 ? (
              <div>
                <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">
                  {t("templates.generateVariants")} <span className="mz-num">{combos.length}</span> {t("templates.possibleCombinations")}{" "}
                  <span className="mz-num">{existingKeys.size}</span> {t("templates.alreadyExist")}
                </h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-surface-2 text-ink-faint">
                      <tr>
                        <th className="p-[8px_10px] text-start font-semibold" />
                        <th className="p-[8px_10px] text-start font-semibold">{t("templates.combination")}</th>
                        <th className="p-[8px_10px] text-end font-semibold">{t("common.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {combos.map((combo) => {
                        const key = comboKey(combo);
                        const exists = existingKeys.has(key);
                        return (
                          <tr key={key} className="border-t border-border">
                            <td className="p-[8px_10px]">
                              <Checkbox
                                disabled={exists}
                                checked={exists || selectedCombos.has(key)}
                                onChange={() => toggleCombo(key)}
                                aria-label={comboLabel(selected.attributes, combo)}
                              />
                            </td>
                            <td className="mz-num p-[8px_10px] text-ink">{comboLabel(selected.attributes, combo)}</td>
                            <td className="p-[8px_10px] text-end">{exists ? <StatusPill label={t("templates.exists")} tone="neutral" /> : <StatusPill label={t("templates.new")} tone="success" />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Button
                  variant="primary"
                  className="mt-[10px]"
                  disabled={selectedCombos.size === 0}
                  onClick={() => void handleGenerate()}
                >
                  {t("templates.generate")}{selectedCombos.size})
                </Button>
                {newComboCount === 0 && combos.length > 0 ? <p className="mt-[6px] text-[12px] text-ink-muted">{t("templates.everyPossibleCombinationHasBeen")}</p> : null}
              </div>
            ) : null}

            <div>
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">
                {t("templates.variants")}<span className="mz-num">{variants.length}</span>)
              </h3>
              <div className="flex flex-col gap-[8px]">
                {variants.map((v) => (
                  <Card key={v.id} className="flex items-center justify-between p-[10px_14px]">
                    <span className="text-[13px] font-semibold text-ink">{comboLabel(selected.attributes, v.values)}</span>
                    <span className="mz-num text-[12px] text-ink-faint">{v.itemCode}</span>
                  </Card>
                ))}
                {variants.length === 0 ? <p className="text-[12.5px] text-ink-muted">{t("templates.noVariantsGeneratedYet")}</p> : null}
              </div>
            </div>
          </div>
        ) : null}
      </SidePanel>
      {confirm.dialog}
    </div>
  );
}

function AddValueInline({ onAdd }: { onAdd: (value: string) => void }) {
  const { t } = useAppTranslation();
  const [value, setValue] = useState("");
  return (
    <span className="inline-flex items-center gap-[4px]">
      <TextInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("templates.value")}
        aria-label={t("templates.addValue")}
        className="w-[90px] min-h-0 rounded-pill border-dashed bg-transparent px-[10px] py-[3px] text-[12px]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim() !== "") {
            e.preventDefault();
            onAdd(value.trim());
            setValue("");
          }
        }}
      />
    </span>
  );
}
