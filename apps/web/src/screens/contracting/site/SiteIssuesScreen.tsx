import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  EntityPicker,
  IconButton,
  modKeyLabel,
  RowMenu,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { SiteIssueDTO, SiteIssueStatusDTO } from "@mezan/contracts";
import {
  useConfirmSiteIssue,
  useConfirmSiteReceipt,
  useCreateSiteIssue,
  useCreateSiteReceipt,
  useSiteIssue,
  useSiteIssues,
  useSiteReceipts,
  useSiteUnreceived,
} from "../../../data/contracting-site-hooks";
import { useItems, useProjects, useStockBalance, useWarehouses } from "../../../data/hooks";
import { FormColumns, FormError, FormPage, SectionCard, SelectField, TextField } from "../../../settings/form-controls";
import { useSubPage } from "../../../navigation";
import { useAppTranslation } from "../../../i18n";
import { useEntityName } from "../../../lib/entity-names";
import { errorMessage } from "../../../lib/error-message";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { useUrlParam } from "../../../lib/url-state";
import { LinesTable, trimDecimal } from "./site-common";

/**
 * أذونات الصرف والاستلام بالموقع (D-11) — the two-step material issue.
 *
 * The detail page's «استلام بالموقع» is the only way to the receipt, and it
 * opens on the REMAINING quantities the server derived, not on the issued
 * ones: a receipt form that re-offers the full issued quantity is how a
 * shortfall gets signed away.
 */

const STATUS_TONES: Record<SiteIssueStatusDTO, PillTone> = {
  draft: "neutral",
  issued: "warning",
  partially_received: "warning",
  received: "success",
};

interface LineDraft {
  key: string;
  itemId: string;
  qty: string;
}

let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: "", qty: "" };
}

export function SiteIssuesScreen() {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const subPage = useSubPage();
  const [firstSegment, secondSegment] = subPage.segments;
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    SiteIssueStatusDTO | "all",
    (next: string) => void,
  ];
  const [projectFilter, setProjectFilter] = useUrlParam("project", "all");

  const projectsQuery = useProjects();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const projects = projectsQuery.data ?? EMPTY;
  const warehouses = warehousesQuery.data ?? EMPTY;
  const items = itemsQuery.data ?? EMPTY;

  const issuesQuery = useSiteIssues({
    status: statusFilter,
    ...(projectFilter !== "all" ? { projectId: projectFilter } : {}),
  });
  const issues = issuesQuery.data ?? EMPTY;
  const unreceived = useSiteUnreceived({ olderThanDays: 7 }).data ?? EMPTY;
  const confirmIssue = useConfirmSiteIssue();
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function warehouseLabel(id: string): string {
    return nameOf(warehouses.find((w) => w.id === id), id);
  }
  function itemLabel(id: string): string {
    const item = items.find((i) => i.id === id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }
  function projectLabel(id: string): string {
    const project = projects.find((p) => p.id === id);
    return project ? project.nameAr : id;
  }

  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  const detail = useSiteIssue(selectedId);

  async function confirmRow(id: string): Promise<void> {
    if (rowPendingId) return;
    setRowError(null);
    setRowPendingId(id);
    try {
      await confirmIssue.mutateAsync(id);
    } catch (err) {
      setRowError(errorMessage(err, t("common.failed")));
    } finally {
      setRowPendingId(null);
    }
  }

  if (firstSegment === "new") {
    return <NewIssueView onDone={subPage.close} />;
  }

  if (selectedId !== null && secondSegment === "receive") {
    return <NewReceiptView issueId={selectedId} onDone={() => subPage.open(selectedId)} />;
  }

  if (selectedId !== null) {
    if (detail.isPending) {
      return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
    }
    if (!detail.data) {
      return (
        <div className="w-full p-[24px]">
          <EmptyState
            title={t("site.issue.notFoundTitle")}
            description={t("site.issue.notFoundBody", { id: selectedId })}
            action={{ label: t("common.back"), onClick: subPage.close }}
          />
        </div>
      );
    }
    return (
      <IssueDetailView
        issue={detail.data}
        outstanding={detail.data.outstanding}
        warehouseLabel={warehouseLabel}
        itemLabel={itemLabel}
        projectLabel={projectLabel}
        onReceive={() => subPage.open(detail.data.id, "receive")}
        onBack={subPage.close}
      />
    );
  }

  const columns: DocumentListColumn<SiteIssueDTO>[] = [
    {
      key: "docNo",
      header: t("site.issue.docNo"),
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</span>,
    },
    { key: "date", header: t("common.date"), sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    { key: "project", header: t("site.project"), render: (d) => projectLabel(d.projectId) },
    {
      key: "route",
      header: t("site.issue.route"),
      render: (d) => (
        <span className="text-ink">
          {warehouseLabel(d.fromWarehouseId)} ← {warehouseLabel(d.toWarehouseId)}
        </span>
      ),
    },
    { key: "lines", header: t("site.lines"), align: "end", render: (d) => <span className="mz-num">{d.lines.length}</span> },
    {
      key: "status",
      header: t("common.status"),
      render: (d) => <StatusPill label={t(`site.issueStatus.${d.status}` as never)} tone={STATUS_TONES[d.status]} />,
    },
  ];

  return (
    <div className="w-full">
      {rowError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}

      <DocumentList<SiteIssueDTO>
        title={t("site.issue.title")}
        description={t("site.issue.description")}
        actions={
          <Button variant="primary" shortcut={`${modKeyLabel()}+N`} onClick={() => subPage.open("new")}>
            {t("site.issue.new")}
          </Button>
        }
        listKey="site-issues"
        stats={[
          { label: t("site.issue.statTotal"), value: <span className="mz-num">{issues.length}</span> },
          {
            label: t("site.issue.statOutstanding"),
            value: <span className="mz-num">{issues.filter((d) => d.status === "issued" || d.status === "partially_received").length}</span>,
          },
          { label: t("site.issue.statUnreceivedRows"), value: <span className="mz-num">{unreceived.length}</span> },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: issues.length },
          { key: "draft", label: t("site.issueStatus.draft"), count: issues.filter((d) => d.status === "draft").length },
          { key: "issued", label: t("site.issueStatus.issued"), count: issues.filter((d) => d.status === "issued").length },
          {
            key: "partially_received",
            label: t("site.issueStatus.partially_received"),
            count: issues.filter((d) => d.status === "partially_received").length,
          },
          { key: "received", label: t("site.issueStatus.received"), count: issues.filter((d) => d.status === "received").length },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k)}
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
        rows={issues}
        loading={issuesQuery.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => subPage.open(d.id)}
        rowAction={(d) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => subPage.open(d.id) },
            ...(d.status === "draft"
              ? [{ key: "confirm", label: t("site.issue.confirm"), disabled: rowPendingId === d.id, onSelect: () => void confirmRow(d.id) }]
              : []),
            ...(d.status === "issued" || d.status === "partially_received"
              ? [{ key: "receive", label: t("site.issue.receiveAction"), onSelect: () => subPage.open(d.id, "receive") }]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: d.docNo ?? d.id })} />;
        }}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{issues.length}</span>
          </>
        }
        emptyState={
          <EmptyState
            title={t("site.issue.emptyTitle")}
            description={t("site.issue.emptyBody")}
            action={{ label: t("site.issue.new"), onClick: () => subPage.open("new") }}
          />
        }
      />

      <Card className="mt-[18px] p-[18px_20px]">
        <h3 className="font-display text-[14px] font-bold text-ink">{t("site.unreceived.title")}</h3>
        <p className="mt-[4px] text-[12px] text-ink-muted">{t("site.unreceived.description")}</p>
        {unreceived.length === 0 ? (
          <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("site.unreceived.empty")}</p>
        ) : (
          <div className="mt-[12px] overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-border px-[10px] py-[8px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("site.issue.docNo")}</th>
                  <th scope="col" className="border-b border-border px-[10px] py-[8px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
                  <th scope="col" className="border-b border-border px-[10px] py-[8px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("site.issued")}</th>
                  <th scope="col" className="border-b border-border px-[10px] py-[8px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("site.received")}</th>
                  <th scope="col" className="border-b border-border px-[10px] py-[8px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("site.outstanding")}</th>
                  <th scope="col" className="border-b border-border px-[10px] py-[8px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("site.ageDays")}</th>
                </tr>
              </thead>
              <tbody>
                {unreceived.map((row) => (
                  <tr key={`${row.issueId}-${row.itemId}`} className="border-b border-border last:border-b-0">
                    <td className="px-[10px] py-[9px] mz-num text-ink">{row.docNo ?? row.issueId}</td>
                    <td className="px-[10px] py-[9px] text-ink">{itemLabel(row.itemId)}</td>
                    <td className="px-[10px] py-[9px] text-end mz-num">{trimDecimal(row.qtyIssued)}</td>
                    <td className="px-[10px] py-[9px] text-end mz-num">{trimDecimal(row.qtyReceived)}</td>
                    <td className="px-[10px] py-[9px] text-end mz-num font-semibold text-danger-ink">{trimDecimal(row.qtyOutstanding)}</td>
                    <td className="px-[10px] py-[9px] text-end mz-num">{row.ageDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function IssueDetailView({
  issue,
  outstanding,
  warehouseLabel,
  itemLabel,
  projectLabel,
  onReceive,
  onBack,
}: {
  issue: SiteIssueDTO;
  outstanding: readonly { itemId: string; qty: string }[];
  warehouseLabel: (id: string) => string;
  itemLabel: (id: string) => string;
  projectLabel: (id: string) => string;
  onReceive: () => void;
  onBack: () => void;
}) {
  const { t } = useAppTranslation();
  const confirmIssue = useConfirmSiteIssue();
  const receipts = useSiteReceipts({ issueId: issue.id }).data ?? EMPTY;
  const [error, setError] = useState<string | null>(null);

  const outstandingOf = new Map(outstanding.map((o) => [o.itemId, o.qty]));
  const anyOutstanding = outstanding.some((o) => Number(o.qty) > 0);

  async function confirm() {
    setError(null);
    try {
      await confirmIssue.mutateAsync(issue.id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    }
  }

  return (
    <div className="w-full">
      <FormError message={error} />
      <DocumentDetail
        title={issue.docNo ?? t("site.issue.singular")}
        statusLabel={t(`site.issueStatus.${issue.status}` as never)}
        statusTone={STATUS_TONES[issue.status]}
        summary={[
          { label: t("site.project"), value: projectLabel(issue.projectId) },
          { label: t("site.issue.fromWarehouse"), value: warehouseLabel(issue.fromWarehouseId) },
          { label: t("site.issue.toWarehouse"), value: warehouseLabel(issue.toWarehouseId) },
          { label: t("common.date"), value: <span className="mz-num">{issue.date}</span> },
          {
            label: t("site.issue.transitWarehouse"),
            value: issue.transitWarehouseId ? warehouseLabel(issue.transitWarehouseId) : "—",
          },
        ]}
        tabs={[
          {
            key: "lines",
            label: t("site.lines"),
            content: (
              <LinesTable
                headers={[
                  { key: "item", label: t("common.item") },
                  { key: "issued", label: t("site.issued"), align: "end" },
                  { key: "received", label: t("site.received"), align: "end" },
                  { key: "outstanding", label: t("site.outstanding"), align: "end" },
                ]}
              >
                {issue.lines.map((line) => {
                  const remaining = outstandingOf.get(line.itemId) ?? "0";
                  const received = String(Number(line.qty) - Number(remaining));
                  return (
                    <tr key={line.itemId} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px] text-ink">{itemLabel(line.itemId)}</td>
                      <td className="px-[12px] py-[10px] text-end mz-num">{trimDecimal(line.qty)}</td>
                      <td className="px-[12px] py-[10px] text-end mz-num">{trimDecimal(received)}</td>
                      <td className="px-[12px] py-[10px] text-end mz-num font-semibold">{trimDecimal(remaining)}</td>
                    </tr>
                  );
                })}
              </LinesTable>
            ),
          },
          {
            key: "receipts",
            label: t("site.issue.receipts"),
            content:
              receipts.length === 0 ? (
                <Card className="p-[18px_20px] text-[12.5px] text-ink-muted">{t("site.issue.noReceipts")}</Card>
              ) : (
                <LinesTable
                  headers={[
                    { key: "docNo", label: t("site.receipt.docNo") },
                    { key: "date", label: t("common.date") },
                    { key: "by", label: t("site.receipt.receivedBy") },
                    { key: "qty", label: t("site.received"), align: "end" },
                  ]}
                >
                  {receipts.map((receipt) => (
                    <tr key={receipt.id} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px] mz-num text-ink">{receipt.docNo ?? t("docStatus.draft")}</td>
                      <td className="px-[12px] py-[10px] mz-num text-ink-muted">{receipt.date}</td>
                      <td className="px-[12px] py-[10px] text-ink-muted">{receipt.receivedByUserId}</td>
                      <td className="px-[12px] py-[10px] text-end mz-num">
                        {trimDecimal(String(receipt.lines.reduce((total, l) => total + Number(l.qtyReceived), 0)))}
                      </td>
                    </tr>
                  ))}
                </LinesTable>
              ),
          },
        ]}
      />
      <div className="mt-[16px] flex flex-wrap items-center gap-[9px]">
        <Button onClick={onBack}>{t("common.back")}</Button>
        {issue.status === "draft" ? (
          <Button variant="primary" disabled={confirmIssue.isPending} onClick={() => void confirm()}>
            {t("site.issue.confirm")}
          </Button>
        ) : null}
        {anyOutstanding && issue.status !== "draft" ? (
          <Button variant="primary" onClick={onReceive}>
            {t("site.issue.receiveAction")}
          </Button>
        ) : null}
      </div>
      <div className="mt-[16px] rounded-md border border-border bg-surface-2 px-[14px] py-[11px] text-[12px] text-ink-muted">
        {t("site.issue.valuationNote")}
      </div>
    </div>
  );
}

function NewIssueView({ onDone }: { onDone: () => void }) {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const createIssue = useCreateSiteIssue();
  const confirmIssue = useConfirmSiteIssue();
  const warehouses = useWarehouses().data ?? EMPTY;
  const items = useItems().data ?? EMPTY;

  const sourceOptions = useMemo(
    () => warehouses.filter((w) => w.type !== "SITE" && w.type !== "TRANSIT" && w.active),
    [warehouses],
  );
  const siteOptions = useMemo(() => warehouses.filter((w) => w.type === "SITE" && w.active), [warehouses]);

  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState(sourceOptions[0]?.id ?? "");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine()]);
  const [error, setError] = useState<string | null>(null);

  const balances = useStockBalance({ warehouseId: fromWarehouseId || undefined }).data ?? EMPTY;
  function availableOf(itemId: string): string | null {
    const row = balances.find((r) => r.itemId === itemId);
    if (!row) return null;
    const here = row.warehouses.find((w) => w.warehouseId === fromWarehouseId);
    return here ? trimDecimal(here.available) : trimDecimal(row.onHand);
  }

  const itemOptions = useMemo(
    () => items.filter((i) => i.type !== "service").map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.code })),
    [items],
  );

  const selectedSite = siteOptions.find((w) => w.id === toWarehouseId) ?? null;
  const ready =
    fromWarehouseId !== "" &&
    toWarehouseId !== "" &&
    lines.length > 0 &&
    lines.every((l) => l.itemId !== "" && Number(l.qty) > 0);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function save() {
    if (!ready) return;
    setError(null);
    const id = crypto.randomUUID();
    try {
      await createIssue.mutateAsync({
        id,
        date,
        fromWarehouseId,
        toWarehouseId,
        notes: notes.trim() === "" ? null : notes.trim(),
        lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      });
      await confirmIssue.mutateAsync(id);
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("site.issue.saveFailed")));
    }
  }

  const busy = createIssue.isPending || confirmIssue.isPending;

  return (
    <FormPage
      eyebrow={t("site.issue.title")}
      title={t("site.issue.newTitle")}
      description={t("site.issue.newDescription")}
      actions={
        <>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
            {t("site.issue.saveAndConfirm")}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <FormColumns
        aside={
          <SectionCard title={t("site.issue.effectTitle")} columns={1}>
            <p className="text-[12.5px] text-ink-muted">{t("site.issue.effectBody")}</p>
            {selectedSite ? (
              <p className="text-[12.5px] text-ink">{t("site.issue.derivedProject", { name: selectedSite.name })}</p>
            ) : null}
          </SectionCard>
        }
      >
        <SectionCard title={t("site.issue.headerTitle")}>
          <TextField label={t("common.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
          <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
          <SelectField
            label={t("site.issue.fromWarehouse")}
            value={fromWarehouseId}
            onChange={setFromWarehouseId}
            options={sourceOptions.map((w) => ({ value: w.id, label: nameOf(w, w.id) }))}
          />
          <SelectField
            label={t("site.issue.toWarehouse")}
            value={toWarehouseId}
            onChange={setToWarehouseId}
            options={[
              { value: "", label: t("site.chooseSiteStore") },
              ...siteOptions.map((w) => ({ value: w.id, label: nameOf(w, w.id) })),
            ]}
            hint={siteOptions.length === 0 ? t("site.noSiteStores") : undefined}
          />
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
                <EntityPicker
                  className="min-w-[190px]"
                  value={line.itemId === "" ? null : (itemOptions.find((o) => o.id === line.itemId) ?? null)}
                  onChange={(option) => updateLine(i, { itemId: option?.id ?? "" })}
                  options={itemOptions}
                  placeholder={t("site.chooseItem")}
                  emptyMessage={t("site.noItems")}
                />
              </td>
              <td className="px-[12px] py-[8px] text-end mz-num text-ink-muted">
                {line.itemId === "" ? "—" : (availableOf(line.itemId) ?? "0")}
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
      </FormColumns>
    </FormPage>
  );
}

function NewReceiptView({ issueId, onDone }: { issueId: string; onDone: () => void }) {
  const { t } = useAppTranslation();
  const detail = useSiteIssue(issueId);
  const items = useItems().data ?? EMPTY;
  const createReceipt = useCreateSiteReceipt();
  const confirmReceipt = useConfirmSiteReceipt();
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [received, setReceived] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const outstanding = (detail.data?.outstanding ?? EMPTY).filter((o) => Number(o.qty) > 0);
  const initialised = Object.keys(received).length > 0;
  const values = initialised ? received : Object.fromEntries(outstanding.map((o) => [o.itemId, trimDecimal(o.qty)]));

  function itemLabel(id: string): string {
    const item = items.find((i) => i.id === id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }

  const ready = outstanding.length > 0 && outstanding.some((o) => Number(values[o.itemId] ?? "0") > 0);
  const busy = createReceipt.isPending || confirmReceipt.isPending;

  async function save() {
    if (!ready) return;
    setError(null);
    const id = crypto.randomUUID();
    try {
      await createReceipt.mutateAsync({
        id,
        issueId,
        date,
        notes: notes.trim() === "" ? null : notes.trim(),
        lines: outstanding
          .filter((o) => Number(values[o.itemId] ?? "0") > 0)
          .map((o) => ({ itemId: o.itemId, qtyReceived: values[o.itemId] as string })),
      });
      await confirmReceipt.mutateAsync(id);
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("site.receipt.saveFailed")));
    }
  }

  return (
    <FormPage
      eyebrow={t("site.receipt.title")}
      title={t("site.receipt.newTitle", { docNo: detail.data?.docNo ?? issueId })}
      description={t("site.receipt.newDescription")}
      actions={
        <>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
            {t("site.receipt.saveAndConfirm")}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <FormColumns
        aside={
          <SectionCard title={t("site.receipt.controlTitle")} columns={1}>
            <p className="text-[12.5px] text-ink-muted">{t("site.receipt.controlBody")}</p>
          </SectionCard>
        }
      >
        <SectionCard title={t("site.receipt.headerTitle")}>
          <TextField label={t("common.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
          <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
        </SectionCard>
        {outstanding.length === 0 ? (
          <Card className="p-[18px_20px] text-[12.5px] text-ink-muted">{t("site.receipt.nothingOutstanding")}</Card>
        ) : (
          <LinesTable
            headers={[
              { key: "item", label: t("common.item") },
              { key: "outstanding", label: t("site.outstanding"), align: "end" },
              { key: "qty", label: t("site.receipt.qtyReceived"), align: "end" },
            ]}
          >
            {outstanding.map((row, i) => (
              <tr key={row.itemId} className="border-b border-border last:border-b-0">
                <td className="px-[12px] py-[10px] text-ink">{itemLabel(row.itemId)}</td>
                <td className="px-[12px] py-[10px] text-end mz-num text-ink-muted">{trimDecimal(row.qty)}</td>
                <td className="px-[12px] py-[8px]">
                  <TextInput
                    type="number"
                    size="sm"
                    numeric
                    className="w-[110px] text-end"
                    aria-label={t("site.lineQty", { number: i + 1 })}
                    value={values[row.itemId] ?? ""}
                    min={0}
                    max={Number(row.qty)}
                    onChange={(e) => setReceived({ ...values, [row.itemId]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </LinesTable>
        )}
      </FormColumns>
    </FormPage>
  );
}
