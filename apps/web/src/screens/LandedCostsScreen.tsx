import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  Money as MoneyDisplay,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import { Money, Qty, distributeLandedCost, type AllocatedLandedCostLine } from "@mezan/domain";
import type {
  DocumentStatusDTO,
  LandedCostDistributionMethodDTO,
  LandedCostItemEntryDTO,
  LandedCostTargetDTO,
  LandedCostTypeDTO,
} from "@mezan/contracts";
import { SelectField, NumberField, TextField } from "../settings/form-controls";
import {
  useCancelLandedCost,
  useConfirmLandedCost,
  useCreateLandedCost,
  useItems,
  useLandedCosts,
  usePurchaseInvoices,
  useWarehouses,
} from "../data/hooks";
import { DOC_STATUS_TONE, documentStatusLabel } from "../doc-status";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** التكاليف الإضافية (Landed Costs) — docs/catalog/02. Distributes freight/customs/etc across a confirmed purchase invoice's item costs, by value or by quantity. */

const COST_TYPE_KEY: Record<LandedCostTypeDTO, AppTranslationKey> = {
  SHIPPING: "landedCosts.type.SHIPPING",
  CUSTOMS: "landedCosts.type.CUSTOMS",
  INSURANCE: "landedCosts.type.INSURANCE",
  CLEARANCE: "landedCosts.type.CLEARANCE",
  OTHER: "landedCosts.type.OTHER",
};

const METHOD_KEY: Record<LandedCostDistributionMethodDTO, AppTranslationKey> = { BY_VALUE: "landedCosts.method.BY_VALUE", BY_QUANTITY: "landedCosts.method.BY_QUANTITY" };


const num = (v: string) => Number(v);

interface CostItemDraft {
  key: string;
  costType: LandedCostTypeDTO;
  description: string;
  amount: number;
}
interface TargetDraft {
  key: string;
  itemId: string;
  qty: number;
  unitCost: number;
}
let seq = 0;
function blankCostItem(): CostItemDraft {
  seq += 1;
  return { key: `c${seq}`, costType: "SHIPPING", description: "", amount: 0 };
}
function blankTarget(itemId: string, qty: number, unitCost: number): TargetDraft {
  seq += 1;
  return { key: `t${seq}`, itemId, qty, unitCost };
}

export function LandedCostsScreen() {
  const { t } = useAppTranslation();
  const query = useLandedCosts();
  const invoicesQuery = usePurchaseInvoices();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const createLandedCost = useCreateLandedCost();
  const confirmLandedCost = useConfirmLandedCost();
  const cancelLandedCost = useCancelLandedCost();

  const documents = query.data ?? [];
  const invoices = (invoicesQuery.data ?? []).filter((i) => i.status === "confirmed");
  const warehouses = warehousesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatusDTO>("all");
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [method, setMethod] = useState<LandedCostDistributionMethodDTO>("BY_VALUE");
  const [costItems, setCostItems] = useState<CostItemDraft[]>([]);
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Defaults the create form's invoice/warehouse pickers once their queries resolve —
  // `openCreate` alone can't do this if the panel is opened before `invoices`/`warehouses` load.
  useEffect(() => {
    if (panel !== "create" || invoiceId !== "") return;
    const firstInvoice = invoices[0];
    if (!firstInvoice) return;
    setInvoiceId(firstInvoice.id);
    const firstLine = firstInvoice.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
  }, [panel, invoices, invoiceId]);

  useEffect(() => {
    if (panel !== "create" || warehouseId !== "") return;
    const firstWarehouse = warehouses[0];
    if (firstWarehouse) setWarehouseId(firstWarehouse.id);
  }, [panel, warehouses, warehouseId]);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const invoiceStockLines = useMemo(
    () => (selectedInvoice?.lines ?? []).filter((l) => l.kind === "inventory" && l.itemId !== null),
    [selectedInvoice],
  );

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, confirmed: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      if (d.status === "confirmed") c.confirmed += 1;
    }
    return c;
  }, [documents]);

  const filtered = statusFilter === "all" ? documents : documents.filter((d) => d.status === statusFilter);
  const selected = typeof panel === "object" ? (documents.find((d) => d.id === panel.id) ?? null) : null;

  const totalCost = costItems.reduce((s, c) => s + (c.amount || 0), 0);

  const preview: AllocatedLandedCostLine[] | null = useMemo(() => {
    const usableCosts = costItems.filter((c) => c.amount > 0);
    if (usableCosts.length === 0 || targets.length === 0) return null;
    try {
      return distributeLandedCost(
        usableCosts.map((c) => ({ costType: c.costType, description: c.description, amount: Money.fromMajor(String(c.amount)) })),
        method,
        targets.map((target) => ({
          itemId: target.itemId,
          warehouseId,
          sourceInvoiceId: invoiceId,
          sourceInvoiceNumber: selectedInvoice?.number ?? null,
          qty: Qty.fromMajor(String(target.qty)),
          unitCost: Money.fromMajor(String(target.unitCost)),
        })),
      );
    } catch {
      return null;
    }
  }, [costItems, method, targets, warehouseId, invoiceId, selectedInvoice]);

  function openCreate() {
    setError(null);
    const firstInvoice = invoices[0] ?? null;
    setInvoiceId(firstInvoice?.id ?? "");
    setWarehouseId(warehouses[0]?.id ?? "");
    setMethod("BY_VALUE");
    setCostItems([blankCostItem()]);
    const firstLine = firstInvoice?.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
    setPanel("create");
  }

  function changeInvoice(id: string) {
    setInvoiceId(id);
    const invoice = invoices.find((i) => i.id === id) ?? null;
    const firstLine = invoice?.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
  }

  function changeTargetItem(key: string, itemId: string) {
    const line = invoiceStockLines.find((l) => l.itemId === itemId);
    setTargets((prev) =>
      prev.map((target) => (target.key === key ? { ...target, itemId, qty: line ? Number(line.qty) : target.qty, unitCost: line ? Number(line.unitCost) : target.unitCost } : target)),
    );
  }

  async function submit(confirmAfter: boolean) {
    setError(null);
    if (!invoiceId || !warehouseId) {
      setError(t("landedCosts.error.needInvoice"));
      return;
    }
    const usableCosts = costItems.filter((c) => c.amount > 0);
    const usableTargets = targets.filter((target) => target.itemId !== "" && target.qty > 0);
    if (usableCosts.length === 0 || usableTargets.length === 0) {
      setError(t("landedCosts.error.needLines"));
      return;
    }
    const costItemEntries: LandedCostItemEntryDTO[] = usableCosts.map((c) => ({ costType: c.costType, description: c.description, amount: String(c.amount) }));
    const targetEntries: LandedCostTargetDTO[] = usableTargets.map((target) => ({
      itemId: target.itemId,
      warehouseId,
      sourceInvoiceId: invoiceId,
      sourceInvoiceNumber: selectedInvoice?.number ?? null,
      qty: String(target.qty),
      unitCost: String(target.unitCost),
    }));
    try {
      const id = crypto.randomUUID();
      const created = await createLandedCost.mutateAsync({
        id,
        date: new Date().toISOString().slice(0, 10),
        memo: "",
        distributionMethod: method,
        costItems: costItemEntries,
        targets: targetEntries,
      });
      if (confirmAfter) await confirmLandedCost.mutateAsync(created.id);
      setPanel("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmExisting(id: string) {
    setError(null);
    try {
      await confirmLandedCost.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelExisting(id: string) {
    setError(null);
    try {
      await cancelLandedCost.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all },
    { key: "draft", label: t("docStatus.draft"), count: counts.draft },
    { key: "confirmed", label: t("docStatus.confirmed"), count: counts.confirmed },
  ];

  const columns: DocumentListColumn<(typeof documents)[number]>[] = [
    { key: "docNo", header: t("landedCosts.col.docNo"), render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</span> },
    { key: "method", header: t("landedCosts.col.method"), render: (d) => t(METHOD_KEY[d.lines[0]?.distributionMethod ?? "BY_VALUE"]) },
    { key: "total", header: t("landedCosts.col.total"), align: "end", render: (d) => <MoneyDisplay value={d.lines.reduce((s, l) => s + num(l.allocatedAmount), 0)} /> },
    { key: "status", header: t("common.status"), render: (d) => <StatusPill label={documentStatusLabel(d.status, t)} tone={DOC_STATUS_TONE[d.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("landedCosts.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<(typeof documents)[number]>
        eyebrow={t("eyebrow.purchases.landedCosts")}
        title={t("landedCosts.title")}
        description={t("landedCosts.description")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("landedCosts.new")}
          </Button>
        }
        stats={[
          { label: t("landedCosts.stat.total"), value: <span className="mz-num">{counts.all}</span> },
          { label: t("landedCosts.stat.confirmed"), value: <span className="mz-num">{counts.confirmed}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatusDTO)}
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => setPanel({ id: d.id })}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{counts.all}</span> {t("landedCosts.showingSuffix")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("landedCosts.empty")}</div>}
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title={t("landedCosts.panel.title")}>
        <div className="flex flex-col gap-4 p-5">
          <SelectField label={t("landedCosts.field.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField
            label={t("landedCosts.field.invoice")}
            value={invoiceId}
            onChange={changeInvoice}
            options={invoices.map((i) => ({ value: i.id, label: i.number }))}
          />
          <SelectField
            label={t("landedCosts.field.method")}
            value={method}
            onChange={(v) => setMethod(v as LandedCostDistributionMethodDTO)}
            options={Object.entries(METHOD_KEY).map(([value, key]) => ({ value, label: t(key) }))}
          />

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">{t("landedCosts.costLinesHeading")}</span>
            {costItems.map((c) => (
              <div key={c.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="w-[110px]">
                  <SelectField
                    label={t("landedCosts.field.type")}
                    value={c.costType}
                    onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, costType: v as LandedCostTypeDTO } : x)))}
                    options={Object.entries(COST_TYPE_KEY).map(([value, key]) => ({ value, label: t(key) }))}
                  />
                </div>
                <div className="flex-1">
                  <TextField label={t("landedCosts.field.description")} value={c.description} onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, description: v } : x)))} />
                </div>
                <div className="w-[100px]">
                  <NumberField label={t("landedCosts.field.amount")} value={c.amount} onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, amount: v } : x)))} min={0} />
                </div>
                <Button variant="ghost" onClick={() => setCostItems((prev) => prev.filter((x) => x.key !== c.key))} disabled={costItems.length === 1}>
                  {t("common.delete")}
                </Button>
              </div>
            ))}
            <Button variant="default" onClick={() => setCostItems((prev) => [...prev, blankCostItem()])}>
              {t("landedCosts.addCostLine")}
            </Button>
            <div className="text-end text-[13px] font-bold text-ink">
              {t("landedCosts.totalCost")} <MoneyDisplay value={totalCost} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">{t("landedCosts.targetsHeading")}</span>
            {invoiceStockLines.length === 0 ? (
              <div className="rounded-[8px] border border-border px-3 py-2 text-[12.5px] text-ink-muted">{t("landedCosts.noStockItems")}</div>
            ) : null}
            {targets.map((target) => (
              <div key={target.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="flex-1">
                  <SelectField
                    label={t("common.item")}
                    value={target.itemId}
                    onChange={(v) => changeTargetItem(target.key, v)}
                    options={invoiceStockLines.map((sl) => ({ value: sl.itemId as string, label: itemName(sl.itemId as string) }))}
                  />
                </div>
                <div className="w-[80px]">
                  <NumberField label={t("common.qty")} value={target.qty} onChange={(v) => setTargets((prev) => prev.map((x) => (x.key === target.key ? { ...x, qty: v } : x)))} min={0} />
                </div>
                <div className="w-[90px]">
                  <NumberField label={t("landedCosts.field.currentCost")} value={target.unitCost} onChange={(v) => setTargets((prev) => prev.map((x) => (x.key === target.key ? { ...x, unitCost: v } : x)))} min={0} />
                </div>
                <Button variant="ghost" onClick={() => setTargets((prev) => prev.filter((x) => x.key !== target.key))} disabled={targets.length === 1}>
                  {t("common.delete")}
                </Button>
              </div>
            ))}
            <Button
              variant="default"
              disabled={invoiceStockLines.length === 0}
              onClick={() => {
                const first = invoiceStockLines[0];
                setTargets((prev) => [...prev, blankTarget((first?.itemId as string) ?? "", first ? Number(first.qty) : 1, first ? Number(first.unitCost) : 0)]);
              }}
            >
              {t("landedCosts.addTarget")}
            </Button>
          </div>

          {preview ? (
            <div className="rounded-lg border border-border bg-surface p-[12px]">
              <div className="mb-[8px] text-[12.5px] font-semibold text-ink">{t("landedCosts.previewHeading")}</div>
              <table className="w-full border-collapse text-[12.5px]">
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="py-[7px]">{itemName(p.itemId)}</td>
                      <td className="mz-num py-[7px] text-end">+<MoneyDisplay value={Number(p.allocatedAmount.toString())} showUnit={false} /></td>
                      <td className="mz-num py-[7px] text-end"><MoneyDisplay value={Number(p.newUnitCost.toString())} showUnit={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => submit(false)}>
              {t("common.save")}
            </Button>
            <Button variant="primary" onClick={() => submit(true)}>
              {t("landedCosts.saveConfirm")}
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected?.docNo ?? t("landedCosts.detailTitle")}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={documentStatusLabel(selected.status, t)} tone={DOC_STATUS_TONE[selected.status]} />
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span>{itemName(l.itemId)}</span>
                  <span className="mz-num text-ink-muted">
                    +<MoneyDisplay value={num(l.allocatedAmount)} /> → {t("landedCosts.newUnitCost")} <MoneyDisplay value={num(l.newUnitCost)} />
                  </span>
                </div>
              ))}
            </div>
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
            {selected.status === "draft" ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => confirmExisting(selected.id)}>
                  {t("landedCosts.confirm")}
                </Button>
                <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : null}
            {selected.status === "confirmed" ? (
              <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                {t("landedCosts.void")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
