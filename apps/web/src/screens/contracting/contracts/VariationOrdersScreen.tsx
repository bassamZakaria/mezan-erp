import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyValue,
  Qty as QtyValue,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type {
  BoqUnitDTO,
  VariationOrderDTO,
  VariationOrderLineInputDTO,
  VariationOrderStatusDTO,
} from "@mezan/contracts";
import { SelectField, TextField } from "../../../settings/form-controls";
import { useScreenIntent, useSubPage } from "../../../navigation";
import { useApi } from "../../../data/ApiContext";
import {
  useApproveVariationOrder,
  useContractBoq,
  useCreateVariationOrder,
  useRejectVariationOrder,
  useVariationOrders,
  useWorksContracts,
} from "../../../data/contracting-contracts-hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { majorOf, sumMajor } from "../../../lib/money";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";

/**
 * أوامر التغيير — the only way the contracted quantity of an active contract
 * moves (D-08). Approval is FORWARD ONLY: the approval date entered here is
 * the legal one, and it decides which certificates the change can reach.
 */

const STATUS_KEY: Record<VariationOrderStatusDTO, AppTranslationKey> = {
  draft: "variationOrders.status.draft",
  approved: "variationOrders.status.approved",
  rejected: "variationOrders.status.rejected",
};
const STATUS_TONE: Record<VariationOrderStatusDTO, PillTone> = {
  draft: "neutral",
  approved: "success",
  rejected: "danger",
};

const UNITS: readonly BoqUnitDTO[] = [
  "m", "m2", "m3", "linear_m", "ton", "kg", "piece", "lump_sum", "day", "hour", "bag", "litre", "set",
];
const UNIT_KEY: Record<BoqUnitDTO, AppTranslationKey> = {
  m: "boq.unit.m",
  m2: "boq.unit.m2",
  m3: "boq.unit.m3",
  linear_m: "boq.unit.linear_m",
  ton: "boq.unit.ton",
  kg: "boq.unit.kg",
  piece: "boq.unit.piece",
  lump_sum: "boq.unit.lump_sum",
  day: "boq.unit.day",
  hour: "boq.unit.hour",
  bag: "boq.unit.bag",
  litre: "boq.unit.litre",
  set: "boq.unit.set",
};

const REQUESTED_BY_KEY: Record<string, AppTranslationKey> = {
  employer: "variationOrders.requestedBy.employer",
  consultant: "variationOrders.requestedBy.consultant",
  contractor: "variationOrders.requestedBy.contractor",
};

interface DraftVoLine {
  kind: "add" | "change";
  boqLineId: string;
  code: string;
  descriptionAr: string;
  unit: BoqUnitDTO;
  qty: string;
  unitRate: string;
  qtyDelta: string;
}

function emptyVoLine(kind: "add" | "change"): DraftVoLine {
  return { kind, boqLineId: "", code: "", descriptionAr: "", unit: "m3", qty: "", unitRate: "", qtyDelta: "" };
}

export function VariationOrdersScreen() {
  const { t } = useAppTranslation();
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const [prefillContractId, setPrefillContractId] = useState<string | null>(null);

  useScreenIntent((intent) => {
    if (intent.kind !== "create") return;
    setPrefillContractId(intent.prefill?.contractId ?? null);
    subPage.open("new");
  });

  const ordersQuery = useVariationOrders();
  const orders = ordersQuery.data ?? EMPTY;
  const contracts = useWorksContracts().data ?? EMPTY;

  const { session } = useApi();
  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayManage = can(authContext, "contracting.boq.manage");
  const mayApprove = can(authContext, "contracting.variation.approve");

  const [statusFilter, setStatusFilter] = useState<VariationOrderStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const filtered = useMemo(
    () =>
      orders.filter(
        (o) =>
          (statusFilter === "all" || o.status === statusFilter) &&
          (search.trim() === "" || o.docNo.includes(search.trim()) || o.titleAr.includes(search.trim()) || o.contractDocNo.includes(search.trim())),
      ),
    [orders, statusFilter, search],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const selected = firstSegment ? orders.find((o) => o.docNo === firstSegment || o.id === firstSegment) ?? null : null;

  if (firstSegment === "new") {
    return (
      <NewVariationOrderPage
        prefillContractId={prefillContractId}
        onDone={(docNo) => subPage.open(docNo)}
        onCancel={() => subPage.close()}
      />
    );
  }

  if (firstSegment && selected) {
    return <VariationOrderDetailPage order={selected} mayApprove={mayApprove} onBack={() => subPage.close()} />;
  }

  if (firstSegment && !ordersQuery.isLoading && !selected) {
    return (
      <EmptyState
        title={t("variationOrders.notFound")}
        description={t("variationOrders.notFoundHint")}
        action={{ label: t("common.back"), onClick: () => subPage.close() }}
      />
    );
  }

  const columns: DocumentListColumn<VariationOrderDTO>[] = [
    { key: "docNo", header: t("variationOrders.column.docNo"), render: (o) => <span className="mz-num font-semibold">{o.docNo}</span> },
    { key: "contract", header: t("variationOrders.column.contract"), render: (o) => <span className="mz-num">{o.contractDocNo}</span> },
    { key: "date", header: t("variationOrders.column.date"), render: (o) => <span className="mz-num">{o.date}</span> },
    { key: "title", header: t("variationOrders.column.title"), render: (o) => o.titleAr },
    {
      key: "netValue",
      header: t("variationOrders.column.netValue"),
      align: "end",
      render: (o) => <MoneyValue value={majorOf(o.netValue)} showUnit={false} />,
      total: (rows) => <MoneyValue value={sumMajor(rows.map((r) => r.netValue))} showUnit={false} />,
    },
    { key: "approvedAt", header: t("variationOrders.column.approvedAt"), render: (o) => <span className="mz-num">{o.approvedAt ?? "—"}</span> },
    { key: "status", header: t("variationOrders.column.status"), render: (o) => <StatusPill label={t(STATUS_KEY[o.status])} tone={STATUS_TONE[o.status]} /> },
  ];

  return (
    <DocumentList<VariationOrderDTO>
      title={t("variationOrders.title")}
      description={t("variationOrders.description")}
      actions={
        mayManage && contracts.some((c) => c.status === "active") ? (
          <Button variant="primary" onClick={() => subPage.open("new")}>
            {t("variationOrders.new")}
          </Button>
        ) : null
      }
      stats={[
        { label: t("variationOrders.stat.pending"), value: <span className="mz-num">{orders.filter((o) => o.status === "draft").length}</span> },
        { label: t("variationOrders.stat.approvedValue"), value: <MoneyValue value={sumMajor(orders.filter((o) => o.status === "approved").map((o) => o.netValue))} showUnit={false} /> },
      ]}
      statusChips={[
        { key: "all", label: t("common.all"), count: orders.length },
        { key: "draft", label: t("variationOrders.status.draft"), count: orders.filter((o) => o.status === "draft").length },
        { key: "approved", label: t("variationOrders.status.approved"), count: orders.filter((o) => o.status === "approved").length },
        { key: "rejected", label: t("variationOrders.status.rejected"), count: orders.filter((o) => o.status === "rejected").length },
      ]}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => setStatusFilter(key as VariationOrderStatusDTO | "all")}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("variationOrders.searchPlaceholder")}
      columns={columns}
      rows={pageRows}
      rowKey={(o) => o.id}
      loading={ordersQuery.isLoading}
      loadFailed={ordersQuery.isError}
      onRowClick={(o) => subPage.open(o.docNo)}
      page={currentPage}
      pageCount={pageCount}
      onPageChange={setPage}
      emptyState={<EmptyState title={t("variationOrders.empty")} description={t("variationOrders.emptyHint")} />}
    />
  );
}

/* ------------------------------------------------------------------ */

function NewVariationOrderPage({
  prefillContractId,
  onDone,
  onCancel,
}: {
  prefillContractId: string | null;
  onDone: (docNo: string) => void;
  onCancel: () => void;
}) {
  const { t } = useAppTranslation();
  const contracts = (useWorksContracts().data ?? EMPTY).filter((c) => c.status === "active");
  const create = useCreateVariationOrder();

  const prefill = contracts.find((c) => c.id === prefillContractId) ?? null;
  const [contract, setContract] = useState<EntityPickerOption | null>(
    prefill ? { id: prefill.id, label: `${prefill.docNo} — ${prefill.titleAr}` } : null,
  );
  const [date, setDate] = useState(todayIso());
  const [titleAr, setTitleAr] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("employer");
  const [lines, setLines] = useState<DraftVoLine[]>([emptyVoLine("change")]);
  const [error, setError] = useState<string | null>(null);

  const boq = useContractBoq(contract?.id ?? null).data?.lines ?? EMPTY;

  /** The preview only: the value that counts is the one the server returns on save. */
  const previewNet = lines.reduce((sum, line) => {
    if (line.kind === "add") return sum + Number(line.qty || "0") * Number(line.unitRate || "0");
    const rate = Number(boq.find((l) => l.id === line.boqLineId)?.unitRate ?? "0");
    return sum + Number(line.qtyDelta || "0") * rate;
  }, 0);

  function edit(index: number, patch: Partial<DraftVoLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function save() {
    setError(null);
    if (!contract || titleAr.trim() === "" || reason.trim() === "") {
      setError(t("variationOrders.missingRequired"));
      return;
    }
    const body: VariationOrderLineInputDTO[] = lines.map((line) =>
      line.kind === "add"
        ? {
            kind: "add" as const,
            newLine: {
              code: line.code.trim(),
              descriptionAr: line.descriptionAr.trim(),
              unit: line.unit,
              qty: line.qty.trim() === "" ? "0" : line.qty.trim(),
              unitRate: line.unitRate.trim() === "" ? "0" : line.unitRate.trim(),
            },
          }
        : { kind: "change" as const, boqLineId: line.boqLineId, qtyDelta: line.qtyDelta.trim() },
    );
    try {
      const created = await create.mutateAsync({
        id: `VO-${Date.now()}`,
        contractId: contract.id,
        date,
        titleAr: titleAr.trim(),
        reason: reason.trim(),
        requestedBy,
        lines: body,
      });
      onDone(created.docNo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("variationOrders.saveFailed"));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[14px] flex items-center justify-between gap-[12px]">
        <h1 className="font-display text-xl font-bold text-ink">{t("variationOrders.new")}</h1>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>

      {error ? (
        <Card className="mb-[14px] p-[14px_16px]">
          <p className="text-[13px] font-semibold text-danger-ink">{error}</p>
        </Card>
      ) : null}

      <Card className="mb-[16px] p-[16px_18px]">
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
          <EntityPicker
            label={t("variationOrders.column.contract")}
            value={contract}
            onChange={setContract}
            options={contracts.map((c) => ({ id: c.id, label: `${c.docNo} — ${c.titleAr}` }))}
            placeholder={t("variationOrders.pickContract")}
            emptyMessage={t("variationOrders.noActiveContracts")}
          />
          <TextField label={t("variationOrders.column.date")} value={date} onChange={setDate} type="date" />
          <SelectField
            label={t("variationOrders.field.requestedBy")}
            value={requestedBy}
            onChange={setRequestedBy}
            options={[
              { value: "employer", label: t("variationOrders.requestedBy.employer") },
              { value: "consultant", label: t("variationOrders.requestedBy.consultant") },
              { value: "contractor", label: t("variationOrders.requestedBy.contractor") },
            ]}
          />
          <TextField label={t("variationOrders.column.title")} value={titleAr} onChange={setTitleAr} />
          <TextField label={t("variationOrders.field.reason")} value={reason} onChange={setReason} />
        </div>
      </Card>

      <Card className="mb-[16px] p-[16px_18px]">
        <div className="mb-[10px] flex flex-wrap items-center justify-between gap-[9px]">
          <h2 className="text-[13px] font-bold text-ink">{t("variationOrders.lines")}</h2>
          <div className="flex gap-[9px]">
            <Button size="sm" onClick={() => setLines((prev) => [...prev, emptyVoLine("change")])}>{t("variationOrders.addChange")}</Button>
            <Button size="sm" onClick={() => setLines((prev) => [...prev, emptyVoLine("add")])}>{t("variationOrders.addNewItem")}</Button>
          </div>
        </div>

        {lines.map((line, index) => (
          <div key={index} className="mb-[10px] grid gap-[10px] border-b border-border pb-[10px] last:border-b-0 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label={t("variationOrders.field.kind")}
              value={line.kind}
              onChange={(v) => edit(index, { kind: v as "add" | "change" })}
              options={[
                { value: "change", label: t("variationOrders.kind.change") },
                { value: "add", label: t("variationOrders.kind.add") },
              ]}
            />
            {line.kind === "change" ? (
              <>
                <EntityPicker
                  label={t("variationOrders.field.boqLine")}
                  value={line.boqLineId === "" ? null : { id: line.boqLineId, label: boq.find((l) => l.id === line.boqLineId)?.descriptionAr ?? line.boqLineId }}
                  onChange={(opt) => edit(index, { boqLineId: opt?.id ?? "" })}
                  options={boq.map((l) => ({ id: l.id, label: `${l.code} — ${l.descriptionAr}`, sublabel: l.unitLabelAr }))}
                  placeholder={t("variationOrders.pickBoqLine")}
                  emptyMessage={t("variationOrders.noBoqLines")}
                />
                <TextField label={t("variationOrders.field.qtyDelta")} value={line.qtyDelta} onChange={(v) => edit(index, { qtyDelta: v })} hint={t("variationOrders.hint.qtyDelta")} />
                <div className="flex items-end">
                  <Button size="sm" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>{t("common.delete")}</Button>
                </div>
              </>
            ) : (
              <>
                <TextField label={t("boq.column.code")} value={line.code} onChange={(v) => edit(index, { code: v })} />
                <TextField label={t("boq.column.description")} value={line.descriptionAr} onChange={(v) => edit(index, { descriptionAr: v })} />
                <SelectField
                  label={t("boq.column.unit")}
                  value={line.unit}
                  onChange={(v) => edit(index, { unit: v as BoqUnitDTO })}
                  options={UNITS.map((u) => ({ value: u, label: t(UNIT_KEY[u]) }))}
                />
                <TextField label={t("boq.column.qty")} value={line.qty} onChange={(v) => edit(index, { qty: v })} />
                <TextField label={t("boq.column.unitRate")} value={line.unitRate} onChange={(v) => edit(index, { unitRate: v })} />
                <div className="flex items-end">
                  <Button size="sm" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>{t("common.delete")}</Button>
                </div>
              </>
            )}
          </div>
        ))}

        <div className="flex items-center justify-between border-t border-border pt-[10px]">
          <span className="text-[12.5px] text-ink-muted">{t("variationOrders.netValuePreview")}</span>
          <MoneyValue value={previewNet} />
        </div>
      </Card>

      <div className="flex justify-end gap-[9px]">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={() => void save()} disabled={create.isPending}>
          {t("variationOrders.saveDraft")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function VariationOrderDetailPage({
  order,
  mayApprove,
  onBack,
}: {
  order: VariationOrderDTO;
  mayApprove: boolean;
  onBack: () => void;
}) {
  const { t } = useAppTranslation();
  const approve = useApproveVariationOrder();
  const reject = useRejectVariationOrder();
  const [approvedAt, setApprovedAt] = useState(order.date);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(action: "approve" | "reject") {
    setError(null);
    try {
      if (action === "approve") await approve.mutateAsync({ id: order.id, body: { approvedAt } });
      else await reject.mutateAsync({ id: order.id, body: { reason: rejectReason } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("variationOrders.approveFailed"));
    }
  }

  return (
    <DocumentDetail
      title={`${order.docNo} — ${order.titleAr}`}
      statusLabel={t(STATUS_KEY[order.status])}
      statusTone={STATUS_TONE[order.status]}
      subtitle={`${t("variationOrders.column.contract")}: ${order.contractDocNo} · ${order.reason}`}
      actions={<Button onClick={onBack}>{t("common.back")}</Button>}
      summary={[
        { label: t("variationOrders.column.netValue"), value: <MoneyValue value={majorOf(order.netValue)} showUnit={false} /> },
        { label: t("variationOrders.column.date"), value: <span className="mz-num">{order.date}</span> },
        { label: t("variationOrders.column.approvedAt"), value: <span className="mz-num">{order.approvedAt ?? "—"}</span> },
        {
          label: t("variationOrders.field.requestedBy"),
          value: REQUESTED_BY_KEY[order.requestedBy] ? t(REQUESTED_BY_KEY[order.requestedBy]!) : order.requestedBy,
        },
      ]}
      tabs={[
        {
          key: "lines",
          label: t("variationOrders.lines"),
          content: (
            <div className="w-full">
              {error ? <p className="mb-[10px] text-[12.5px] font-semibold text-danger-ink">{error}</p> : null}
              {order.status === "draft" && mayApprove ? (
                <Card className="mb-[14px] p-[14px_16px]">
                  <h3 className="mb-[4px] text-[12.5px] font-bold text-ink">{t("variationOrders.decision")}</h3>
                  <p className="mb-[10px] text-[11.5px] text-ink-muted">{t("variationOrders.decisionHint")}</p>
                  <div className="grid gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
                    <TextField label={t("variationOrders.approvalDate")} value={approvedAt} onChange={setApprovedAt} type="date" />
                    <TextField label={t("variationOrders.rejectReason")} value={rejectReason} onChange={setRejectReason} />
                    <div className="flex items-end gap-[9px]">
                      <Button variant="primary" onClick={() => void run("approve")} disabled={approve.isPending}>
                        {t("variationOrders.approve")}
                      </Button>
                      <Button onClick={() => void run("reject")} disabled={reject.isPending || rejectReason.trim() === ""}>
                        {t("variationOrders.reject")}
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : null}
              {order.status === "rejected" ? (
                <Card className="mb-[14px] p-[14px_16px]">
                  <p className="text-[12.5px] text-ink">{t("variationOrders.rejectedWith", { reason: order.rejectedReason ?? "" })}</p>
                </Card>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-ink-muted">
                      <th className="p-[7px] text-start">{t("variationOrders.field.kind")}</th>
                      <th className="p-[7px] text-start">{t("boq.column.code")}</th>
                      <th className="p-[7px] text-start">{t("boq.column.description")}</th>
                      <th className="p-[7px] text-end">{t("variationOrders.field.qtyDelta")}</th>
                      <th className="p-[7px] text-end">{t("boq.column.unitRate")}</th>
                      <th className="p-[7px] text-end">{t("boq.column.lineValue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((line) => (
                      <tr key={line.id} className="border-t border-border">
                        <td className="p-[7px]">{t(line.kind === "add" ? "variationOrders.kind.add" : "variationOrders.kind.change")}</td>
                        <td className="mz-num p-[7px]">{line.newLine?.code ?? line.boqLineId ?? "—"}</td>
                        <td className="p-[7px]">{line.newLine?.descriptionAr ?? "—"}</td>
                        <td className="p-[7px] text-end">
                          <QtyValue value={line.kind === "add" ? (line.newLine?.qty ?? "0") : (line.qtyDelta ?? "0")} />
                        </td>
                        <td className="p-[7px] text-end">
                          {line.newLine ? <MoneyValue value={majorOf(line.newLine.unitRate)} showUnit={false} /> : line.unitRateOverride ? <MoneyValue value={majorOf(line.unitRateOverride)} showUnit={false} /> : "—"}
                        </td>
                        <td className="p-[7px] text-end font-semibold"><MoneyValue value={majorOf(line.lineValue)} showUnit={false} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}
