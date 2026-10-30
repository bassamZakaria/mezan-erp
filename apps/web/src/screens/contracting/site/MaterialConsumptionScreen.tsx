import { DOC_STATUS_TONE, documentStatusLabel } from "../../../doc-status";
import { ReversalDocumentType } from "@mezan/contracts";
import { DocumentStatusCode } from "@mezan/domain";
import { useReverseDocumentAction } from "../../../reversal/ReverseDocumentAction";
import { useEffect, useMemo, useState } from "react";
import {
  RowActionOutcome,
  Button,
  Card,
  DocumentList,
  EmptyState,
  EntityPicker,
  IconButton,
  modKeyLabel,
  RowMenu,
  Select,
  StatusPill,
  TextInput,
  useFormat,
  type DocumentListColumn,
  type RowMenuItem,
} from "@mezan/ui";
import type { MaterialConsumptionDTO } from "@mezan/contracts";
import {
  useConfirmMaterialConsumption,
  useCreateMaterialConsumption,
  useMaterialConsumptions,
} from "../../../data/contracting-site-hooks";
import { useContractBoq, useWorksContracts } from "../../../data/contracting-contracts-hooks";
import { useItemsByIds, useProjects, useStockBalance, useWarehouses } from "../../../data/hooks";
import { FormColumns, FormError, FormPage, SectionCard, SelectField, TextField } from "../../../settings/form-controls";
import { useSubPage } from "../../../navigation";
import { useAppTranslation } from "../../../i18n";
import { useEntityName } from "../../../lib/entity-names";
import { errorMessage } from "../../../lib/error-message";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { useUrlParam } from "../../../lib/url-state";
import { useMaySeeItemCost } from "../../../data/item-cost";
import { LinesTable, trimDecimal } from "./site-common";
import { ItemPicker, STOCKED_ITEMS } from "../../ItemPicker";


/**
 * استهلاك المواد — the ONLY document that turns stock into project cost
 * (D-11). It posts Dr أعمال تحت التنفيذ / Cr المخزون at the site store's own
 * moving average; nothing on this screen decides the amount.
 */

interface LineDraft {
  key: string;
  itemId: string;
  itemLabel: string;
  qty: string;
}

let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `c${lineSeq}`, itemId: "", itemLabel: "", qty: "" };
}

export function MaterialConsumptionScreen() {
  const reversal = useReverseDocumentAction(ReversalDocumentType.MaterialConsumption);
  const { t } = useAppTranslation();
  const { money } = useFormat();
  const showCost = useMaySeeItemCost();
  const nameOf = useEntityName();
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const [projectFilter, setProjectFilter] = useUrlParam("project", "all");

  const projects = useProjects().data ?? EMPTY;
  const warehouses = useWarehouses().data ?? EMPTY;
  const query = useMaterialConsumptions(projectFilter !== "all" ? { projectId: projectFilter } : {});
  const rows = query.data ?? EMPTY;
  const { byId: itemById } = useItemsByIds(rows.flatMap((d) => d.lines.map((line) => line.itemId)));
  const confirmConsumption = useConfirmMaterialConsumption();
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function warehouseLabel(id: string): string {
    return nameOf(warehouses.find((w) => w.id === id), id);
  }
  function itemLabel(id: string): string {
    const item = itemById.get(id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }

  async function confirmRow(id: string): Promise<RowActionOutcome | void> {
    if (rowPendingId) return;
    setRowError(null);
    setRowPendingId(id);
    try {
      await confirmConsumption.mutateAsync(id);
    } catch (err) {
      setRowError(errorMessage(err, t("common.failed")));
      return RowActionOutcome.Refused;
    } finally {
      setRowPendingId(null);
    }
  }

  if (firstSegment === "new") return <NewConsumptionView onDone={subPage.close} />;

  const columns: DocumentListColumn<MaterialConsumptionDTO>[] = [
    {
      key: "docNo",
      header: t("site.consumption.docNo"),
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</span>,
    },
    { key: "date", header: t("common.date"), sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    { key: "warehouse", header: t("site.consumption.warehouse"), render: (d) => warehouseLabel(d.warehouseId) },
    {
      key: "project",
      header: t("site.project"),
      render: (d) => projects.find((p) => p.id === d.projectId)?.nameAr ?? d.projectId,
    },
    { key: "boq", header: t("site.boqLine"), render: (d) => d.boqLineId ?? "—" },
    {
      key: "items",
      header: t("site.lines"),
      render: (d) => (
        <span className="text-ink-muted">
          {d.lines.map((line) => `${itemLabel(line.itemId)} × ${trimDecimal(line.qty)}`).join("، ")}
        </span>
      ),
    },
    ...(showCost
      ? [
          {
            key: "cost",
            header: t("site.consumption.cost"),
            align: "end" as const,
            render: (d: MaterialConsumptionDTO) => <span className="mz-num">{d.status === "confirmed" && d.totalCost !== undefined ? money(Number(d.totalCost)) : "—"}</span>,
          },
        ]
      : []),
    {
      key: "status",
      header: t("common.status"),
      render: (d) => (
        <StatusPill
          label={documentStatusLabel(d.status, t)}
          tone={DOC_STATUS_TONE[d.status]}
        />
      ),
    },
  ];

  return (
    <div className="w-full">
      {rowError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}
      <DocumentList<MaterialConsumptionDTO>
        title={t("site.consumption.title")}
        description={t("site.consumption.description")}
        actions={
          <Button variant="primary" shortcut={`${modKeyLabel()}+N`} onClick={() => subPage.open("new")}>
            {t("site.consumption.new")}
          </Button>
        }
        listKey="material-consumptions"
        stats={[
          { label: t("site.consumption.statTotal"), value: <span className="mz-num">{rows.length}</span> },
          {
            label: t("site.consumption.statConfirmed"),
            value: <span className="mz-num">{rows.filter((d) => d.status === "confirmed").length}</span>,
          },
        ]}
        filterBarExtra={
          <Select
            size="sm"
            aria-label={t("site.project")}
            value={projectFilter}
            onChange={setProjectFilter}
            options={[{ value: "all", label: t("site.allProjects") }, ...projects.map((p) => ({ value: p.id, label: p.nameAr }))]}
          />
        }
        columns={columns}
        rows={rows}
        loading={query.isLoading}
        rowKey={(d) => d.id}
        rowAction={(d) => {
          const menuItems: RowMenuItem[] = [
            ...(d.status === "draft"
              ? [{ key: "confirm", label: t("site.consumption.confirm"), disabled: rowPendingId === d.id, onSelect: () => confirmRow(d.id) }]
              : []),
            ...(d.status === DocumentStatusCode.Confirmed ? reversal.menuItems({ id: d.id, params: { id: d.id }, subject: d.docNo ?? d.id }) : []),
          ];
          return menuItems.length > 0 ? <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: d.docNo ?? d.id })} /> : null;
        }}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{rows.length}</span>
          </>
        }
        emptyState={
          <EmptyState
            title={t("site.consumption.emptyTitle")}
            description={t("site.consumption.emptyBody")}
            action={{ label: t("site.consumption.new"), onClick: () => subPage.open("new") }}
          />
        }
      />
      {reversal.dialog}
    </div>
  );
}

function NewConsumptionView({ onDone }: { onDone: () => void }) {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const createConsumption = useCreateMaterialConsumption();
  const confirmConsumption = useConfirmMaterialConsumption();
  const warehouses = useWarehouses().data ?? EMPTY;
  const contracts = useWorksContracts().data ?? EMPTY;

  const siteStores = useMemo(() => warehouses.filter((w) => w.type === "SITE" && w.active), [warehouses]);
  const [warehouseId, setWarehouseId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [boqLineId, setBoqLineId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (warehouseId === "" && siteStores.length > 0) setWarehouseId(siteStores[0]?.id ?? "");
  }, [siteStores, warehouseId]);

  const store = siteStores.find((w) => w.id === warehouseId) ?? null;
  // The BOQ belongs to the project's own contract, so the picker is only as
  // wide as the store's project — a line from another project is not a
  // mis-typed id, it is a mis-costed one.
  const contract = contracts.find((c) => store !== null && c.projectId === store.projectId) ?? null;
  const boqLines = useContractBoq(contract?.id ?? null).data?.lines ?? EMPTY;

  useEffect(() => {
    setBoqLineId("");
  }, [contract?.id]);

  const balances = useStockBalance({ warehouseId: warehouseId || undefined }).data ?? EMPTY;
  function availableOf(itemId: string): string {
    const row = balances.find((r) => r.itemId === itemId);
    const here = row?.warehouses.find((w) => w.warehouseId === warehouseId);
    return here ? trimDecimal(here.available) : "0";
  }

  const boqOptions = useMemo(
    () => boqLines.map((l) => ({ id: l.id, label: `${l.code} — ${l.descriptionAr}`, sublabel: l.unitLabelAr })),
    [boqLines],
  );

  const ready = warehouseId !== "" && lines.every((l) => l.itemId !== "" && Number(l.qty) > 0);
  const busy = createConsumption.isPending || confirmConsumption.isPending;

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function save() {
    if (!ready) return;
    setError(null);
    const id = crypto.randomUUID();
    try {
      await createConsumption.mutateAsync({
        id,
        date,
        warehouseId,
        boqLineId: boqLineId === "" ? null : boqLineId,
        notes: notes.trim() === "" ? null : notes.trim(),
        lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      });
      await confirmConsumption.mutateAsync(id);
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("site.consumption.saveFailed")));
    }
  }

  return (
    <FormPage
      eyebrow={t("site.consumption.title")}
      title={t("site.consumption.newTitle")}
      description={t("site.consumption.newDescription")}
      actions={
        <>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
            {t("site.consumption.saveAndConfirm")}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <FormColumns
        aside={
          <SectionCard title={t("site.consumption.effectTitle")} columns={1}>
            <p className="text-[12.5px] text-ink-muted">{t("site.consumption.effectBody")}</p>
          </SectionCard>
        }
      >
        <SectionCard title={t("site.consumption.headerTitle")}>
          <SelectField
            label={t("site.consumption.warehouse")}
            value={warehouseId}
            onChange={setWarehouseId}
            options={[
              { value: "", label: t("site.chooseSiteStore") },
              ...siteStores.map((w) => ({ value: w.id, label: nameOf(w, w.id) })),
            ]}
            hint={siteStores.length === 0 ? t("site.noSiteStores") : undefined}
          />
          <TextField label={t("common.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
          <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
          <div>
            <EntityPicker
              label={t("site.boqLine")}
              value={boqLineId === "" ? null : (boqOptions.find((o) => o.id === boqLineId) ?? null)}
              onChange={(option) => setBoqLineId(option?.id ?? "")}
              options={boqOptions}
              placeholder={t("site.chooseBoqLine")}
              emptyMessage={contract ? t("site.noBoqLines") : t("site.noContractForProject")}
              disabled={store === null}
            />
          </div>
        </SectionCard>

        <LinesTable
          headers={[
            { key: "item", label: t("common.item") },
            { key: "available", label: t("site.availableHere"), align: "end" },
            { key: "qty", label: t("common.qty"), align: "end" },
            { key: "remove", label: "" },
          ]}
        >
          {lines.map((line, i) => (
            <tr key={line.key} className="border-b border-border last:border-b-0">
              <td className="px-[12px] py-[8px]">
                <ItemPicker
                  className="min-w-[190px]"
                  value={line.itemId === "" ? null : { id: line.itemId, label: line.itemLabel }}
                  onChange={(item) => updateLine(i, { itemId: item?.id ?? "", itemLabel: item?.nameAr ?? "" })}
                  filter={STOCKED_ITEMS}
                  placeholder={t("site.chooseItem")}
                  emptyMessage={t("site.noItems")}
                />
              </td>
              <td className="px-[12px] py-[8px] text-end mz-num text-ink-muted">
                {line.itemId === "" ? "—" : availableOf(line.itemId)}
              </td>
              <td className="px-[12px] py-[8px]">
                <TextInput
                  type="number"
                  size="sm"
                  numeric
                  className="w-[110px] text-end"
                  aria-label={t("site.lineQty", { number: i + 1 })}
                  value={line.qty}
                  min={0}
                  onChange={(e) => updateLine(i, { qty: e.target.value })}
                />
              </td>
              <td className="px-[12px] py-[8px] text-center">
                <IconButton
                  aria-label={t("site.removeLine", { number: i + 1 })}
                  disabled={lines.length <= 1}
                  onClick={() => setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, index) => index !== i)))}
                >
                  ✕
                </IconButton>
              </td>
            </tr>
          ))}
        </LinesTable>
        <div>
          <Button size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}>
            {t("site.addLine")}
          </Button>
        </div>
        {store === null ? <Card className="p-[16px] text-[12.5px] text-ink-muted">{t("site.noSiteStores")}</Card> : null}
      </FormColumns>
    </FormPage>
  );
}
