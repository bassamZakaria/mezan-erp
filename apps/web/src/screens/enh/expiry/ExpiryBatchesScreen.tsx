import { useMemo, useState } from "react";
import { Button, Card, EmptyState, Money as MoneyValue, StatusPill, formatQty, type EntityPickerOption } from "@mezan/ui";
import { ArabicCase, CountedNoun, ExpiryStatus, can, createAuthContext, createInventoryBatchesReport, DEFAULT_NEAR_EXPIRY_DAYS, type InventoryBatchesRow } from "@mezan/domain";
import type { BatchTrailEntryDTO, ExpiryWriteOffResultDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useCountPhrase } from "../../../lib/count-phrase";
import { useConfirmStockAdjustment, useItemsByIds, useWarehouses } from "../../../data/hooks";
import {
  useBatchRecall,
  useCreateExpiryWriteOff,
  useExpiryAlerts,
  useExpirySettings,
  useExpiryWriteOffProposal,
  useSaveExpirySettings,
} from "../../../data/expiry-hooks";
import { NumberField, SelectField, TextField } from "../../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useEntityName } from "../../../lib/entity-names";
import { useNavigation } from "../../../navigation";
import { errorMessage } from "../../../lib/error-message";
import { majorOf } from "../../../lib/money";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { ScreenTabs } from "../../ScreenTabs";
import { ReportScreen } from "../../reports/ReportScreen";
import { FefoPreviewPanel } from "./FefoPreviewPanel";
import { ItemPicker, itemOption } from "../../ItemPicker";
import { ExpiryTab } from "./expiry-routes";


enum WriteOffOutcome {
  Posted = "posted",
  Held = "held",
}

const STATUS_TONE: Record<string, "danger" | "warning" | "success" | "neutral"> = {
  [ExpiryStatus.Expired]: "danger",
  [ExpiryStatus.NearExpiry]: "warning",
  [ExpiryStatus.Ok]: "success",
  [ExpiryStatus.NoExpiry]: "neutral",
};

const STATUS_KEY: Record<string, AppTranslationKey> = {
  [ExpiryStatus.Expired]: "expiry.status.expired",
  [ExpiryStatus.NearExpiry]: "expiry.status.nearExpiry",
  [ExpiryStatus.Ok]: "expiry.status.ok",
  [ExpiryStatus.NoExpiry]: "expiry.status.noExpiry",
};

const STATUS_LABEL_COLUMN = "statusLabel";

const TH = "border-b border-border bg-surface-2 px-[12px] py-[9px] text-start text-[11px] font-bold uppercase text-ink-muted";
const TH_END = "border-b border-border bg-surface-2 px-[12px] py-[9px] text-end text-[11px] font-bold uppercase text-ink-muted";
const TD = "px-[12px] py-[9px]";
const TD_END = "px-[12px] py-[9px] text-end mz-num";

function usePermission(code: string): boolean {
  const { session } = useApi();
  return can(
    createAuthContext({ userId: session?.userId ?? "anonymous", permissions: session?.permissions ?? [], branchScope: "*", warehouseScope: "*" }),
    code,
  );
}

function useLabels(itemIds: readonly string[] = EMPTY) {
  const nameOf = useEntityName();
  const { byId } = useItemsByIds(itemIds);
  const warehouses = useWarehouses().data ?? EMPTY;
  return {
    warehouses,
    itemLabel: (id: string) => nameOf(byId.get(id), id),
    warehouseLabel: (id: string) => nameOf(warehouses.find((w) => w.id === id), id),
  };
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
      {message}
    </div>
  );
}

function BatchesTab() {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const settings = useExpirySettings();
  const days = settings.data?.nearExpiryDays ?? DEFAULT_NEAR_EXPIRY_DAYS;
  const definition = useMemo(() => {
    const report = createInventoryBatchesReport(todayIso(), days);
    return {
      ...report,
      descriptionAr: t("expiry.batches.description", { days: countPhrase(days, CountedNoun.Day, ArabicCase.Oblique) }),
      columns: report.columns.map((column) => (column.key === STATUS_LABEL_COLUMN ? { ...column, value: (row: InventoryBatchesRow) => t(STATUS_KEY[row.status] ?? "expiry.status.noExpiry") } : column)),
    };
  }, [days, t, countPhrase]);
  if (settings.isLoading) return null;
  return <ReportScreen key={days} definition={definition} apiPath="/inventory/batches" nested />;
}

function WriteOffTab() {
  const { t } = useAppTranslation();
  const { openScreenAt } = useNavigation();
  const mayWriteOff = usePermission("inventory.adjustment.create");
  const mayConfirm = usePermission("inventory.adjustment.confirm");
  const [warehouseId, setWarehouseId] = useState("");
  const [memo, setMemo] = useState("");
  const [result, setResult] = useState<ExpiryWriteOffResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<WriteOffOutcome | null>(null);
  const proposal = useExpiryWriteOffProposal(warehouseId);
  const create = useCreateExpiryWriteOff();
  const confirm = useConfirmStockAdjustment();

  const lines = proposal.data?.lines ?? EMPTY;
  const { itemLabel, warehouses } = useLabels(lines.map((line) => line.itemId));
  const warehouseOptions = [{ value: "", label: t("expiry.writeOff.chooseWarehouse") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))];

  async function createDraft() {
    if (create.isPending || warehouseId === "" || lines.length === 0) return;
    setError(null);
    try {
      const created = await create.mutateAsync({ warehouseId, memo: memo.trim() || undefined });
      setResult(created);
      setConfirmed(null);
    } catch (err) {
      setError(errorMessage(err, t("expiry.writeOff.createFailed")));
    }
  }

  async function confirmDraft() {
    if (!result || confirm.isPending) return;
    setError(null);
    try {
      const outcome = await confirm.mutateAsync(result.adjustmentId);
      setResult({ ...result, docNo: outcome.document.docNo ?? result.docNo, status: outcome.document.status });
      setConfirmed(outcome.held ? WriteOffOutcome.Held : WriteOffOutcome.Posted);
      void proposal.refetch();
    } catch (err) {
      setError(errorMessage(err, t("expiry.writeOff.confirmFailed")));
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="max-w-[72ch] text-[12.5px] text-ink-muted">{t("expiry.writeOff.intro")}</p>
      {error ? <ErrorNote message={error} /> : null}
      <Card className="grid grid-cols-1 gap-[14px] p-[16px] sm:grid-cols-2">
        <SelectField
          label={t("common.warehouse")}
          value={warehouseId}
          onChange={(v) => {
            setWarehouseId(v);
            setResult(null);
          }}
          options={warehouseOptions}
        />
        <TextField label={t("common.notes")} value={memo} onChange={setMemo} placeholder={t("expiry.writeOff.memoPlaceholder")} />
      </Card>

      {result ? (
        <Card className="flex flex-col gap-[10px] border-brand p-[16px]">
          <p className="text-[13px] font-semibold text-ink">
            {confirmed === WriteOffOutcome.Posted
              ? t("expiry.writeOff.confirmed", { docNo: result.docNo ?? "" })
              : confirmed === WriteOffOutcome.Held
                ? t("expiry.writeOff.held")
                : t("expiry.writeOff.draftCreated")}
          </p>
          <p className="text-[12.5px] text-ink-muted">
            {t("expiry.writeOff.totalAtWac")} <MoneyValue value={majorOf(result.totalValue)} />
          </p>
          <div className="flex flex-wrap gap-[9px]">
            {confirmed === null && mayConfirm ? (
              <Button variant="primary" disabled={confirm.isPending} onClick={() => void confirmDraft()}>
                {t("expiry.writeOff.confirm")}
              </Button>
            ) : null}
            <Button onClick={() => openScreenAt("stock-adjustments", [result.docNo ?? result.adjustmentId])}>{t("expiry.writeOff.openAdjustment")}</Button>
          </div>
        </Card>
      ) : null}

      {warehouseId === "" ? null : proposal.isError ? (
        <ErrorNote message={proposal.error.message} />
      ) : proposal.isLoading ? null : lines.length === 0 ? (
        <EmptyState title={t("expiry.writeOff.nothingExpiredTitle")} description={t("expiry.writeOff.nothingExpiredBody")} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className={TH}>{t("common.item")}</th>
                  <th scope="col" className={TH}>{t("expiry.lot.batchNo")}</th>
                  <th scope="col" className={TH}>{t("expiry.lot.expiryDate")}</th>
                  <th scope="col" className={TH_END}>{t("common.qty")}</th>
                  <th scope="col" className={TH_END}>{t("expiry.writeOff.layerCost")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.flatMap((line) =>
                  line.batches.map((batch, i) => (
                    <tr key={`${line.itemId}:${i}`} className="border-b border-border last:border-b-0">
                      <td className={TD}>{i === 0 ? itemLabel(line.itemId) : ""}</td>
                      <td className={TD}>{batch.batchNo ?? t("expiry.lot.noBatch")}</td>
                      <td className={`${TD} mz-num`}>{batch.expiryDate}</td>
                      <td className={TD_END}>{formatQty(majorOf(batch.qty))}</td>
                      <td className={TD_END}>
                        <MoneyValue value={majorOf(batch.value)} showUnit={false} />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-[12px] border-t border-border p-[12px]">
            <div className="text-[12.5px] text-ink">
              {t("expiry.writeOff.totalAtWac")} <strong><MoneyValue value={majorOf(proposal.data?.totalValue)} /></strong>
              <span className="block text-[11.5px] text-ink-muted">{t("expiry.writeOff.wacNote")}</span>
            </div>
            {mayWriteOff ? (
              <Button variant="primary" disabled={create.isPending || result !== null} onClick={() => void createDraft()}>
                {t("expiry.writeOff.createDraft")}
              </Button>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  );
}

function AlertsTab() {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const alerts = useExpiryAlerts();
  const { itemLabel, warehouseLabel } = useLabels(alerts.data?.due.map((row) => row.itemId) ?? EMPTY);
  if (alerts.isError) return <ErrorNote message={alerts.error.message} />;
  if (alerts.isLoading || !alerts.data) return null;
  const { due, nearExpiryDays } = alerts.data;
  return (
    <div className="flex flex-col gap-[14px]">
      <p className="text-[12.5px] text-ink-muted">{t("expiry.alerts.window", { days: countPhrase(nearExpiryDays, CountedNoun.Day, ArabicCase.Oblique) })}</p>
      {due.length === 0 ? (
        <EmptyState title={t("expiry.alerts.noneTitle")} description={t("expiry.alerts.noneBody")} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className={TH}>{t("common.item")}</th>
                  <th scope="col" className={TH}>{t("common.warehouse")}</th>
                  <th scope="col" className={TH}>{t("expiry.lot.batchNo")}</th>
                  <th scope="col" className={TH}>{t("expiry.lot.expiryDate")}</th>
                  <th scope="col" className={TH_END}>{t("expiry.alerts.daysLeft")}</th>
                  <th scope="col" className={TH_END}>{t("common.qty")}</th>
                  <th scope="col" className={TH}>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {due.map((row, i) => (
                  <tr key={`${row.itemId}:${row.warehouseId}:${row.batchNo ?? ""}:${row.expiryDate ?? ""}:${i}`} className="border-b border-border last:border-b-0">
                    <td className={TD}>{itemLabel(row.itemId)}</td>
                    <td className={TD}>{warehouseLabel(row.warehouseId)}</td>
                    <td className={TD}>{row.batchNo ?? t("expiry.lot.noBatch")}</td>
                    <td className={`${TD} mz-num`}>{row.expiryDate ?? "—"}</td>
                    <td className={TD_END}>{row.daysToExpiry ?? "—"}</td>
                    <td className={TD_END}>{formatQty(majorOf(row.qty))}</td>
                    <td className={TD}>
                      <StatusPill label={t(STATUS_KEY[row.status] ?? "expiry.status.ok")} tone={STATUS_TONE[row.status] ?? "neutral"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function FefoTab() {
  const { t } = useAppTranslation();
  const { warehouses } = useLabels();
  const [warehouseId, setWarehouseId] = useState("");
  const [item, setItem] = useState<EntityPickerOption | null>(null);
  const [qty, setQty] = useState(0);
  return (
    <div className="flex flex-col gap-[14px]">
      <p className="max-w-[72ch] text-[12.5px] text-ink-muted">{t("expiry.fefo.intro")}</p>
      <Card className="grid grid-cols-1 gap-[14px] p-[16px] sm:grid-cols-3">
        <SelectField
          label={t("common.warehouse")}
          value={warehouseId}
          onChange={setWarehouseId}
          options={[{ value: "", label: t("expiry.writeOff.chooseWarehouse") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
        />
        <ItemPicker
          label={t("common.item")}
          placeholder={t("expiry.fefo.chooseItem")}
          value={item}
          onChange={(picked) => setItem(picked ? itemOption(picked) : null)}
          filter={{ lotTracked: true }}
        />
        <NumberField label={t("common.qty")} value={qty} min={0} onChange={setQty} />
      </Card>
      {warehouseId !== "" && item ? <FefoPreviewPanel warehouseId={warehouseId} itemId={item.id} qty={qty} /> : null}
    </div>
  );
}

function TrailTable({ rows }: { rows: readonly BatchTrailEntryDTO[] }) {
  const { t } = useAppTranslation();
  const { itemLabel, warehouseLabel } = useLabels(rows.map((row) => row.itemId));
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={TH}>{t("common.date")}</th>
              <th scope="col" className={TH}>{t("expiry.recall.document")}</th>
              <th scope="col" className={TH}>{t("common.item")}</th>
              <th scope="col" className={TH}>{t("common.warehouse")}</th>
              <th scope="col" className={TH}>{t("expiry.lot.expiryDate")}</th>
              <th scope="col" className={TH_END}>{t("common.qty")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.movementId}:${row.batchNo ?? ""}:${row.expiryDate ?? ""}`} className="border-b border-border last:border-b-0">
                <td className={`${TD} mz-num`}>{row.occurredAt.slice(0, 10)}</td>
                <td className={TD}>
                  {t(`expiry.docType.${row.sourceDocType}` as AppTranslationKey)} {row.sourceDocNumber ?? ""}
                </td>
                <td className={TD}>{itemLabel(row.itemId)}</td>
                <td className={TD}>{warehouseLabel(row.warehouseId)}</td>
                <td className={`${TD} mz-num`}>{row.expiryDate ?? "—"}</td>
                <td className={TD_END}>{formatQty(majorOf(row.qty))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RecallTab() {
  const { t } = useAppTranslation();
  const [draft, setDraft] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const recall = useBatchRecall(batchNo);
  return (
    <div className="flex flex-col gap-[14px]">
      <p className="max-w-[72ch] text-[12.5px] text-ink-muted">{t("expiry.recall.intro")}</p>
      <Card className="flex flex-wrap items-end gap-[12px] p-[16px]">
        <div className="min-w-[220px] flex-1">
          <TextField label={t("expiry.lot.batchNo")} value={draft} onChange={setDraft} />
        </div>
        <Button variant="primary" disabled={draft.trim() === ""} onClick={() => setBatchNo(draft.trim())}>
          {t("expiry.recall.search")}
        </Button>
      </Card>
      {batchNo === "" ? null : recall.isError ? (
        <ErrorNote message={recall.error.message} />
      ) : recall.isLoading ? null : (recall.data ?? EMPTY).length === 0 ? (
        <EmptyState title={t("expiry.recall.noneTitle")} description={t("expiry.recall.noneBody", { batchNo })} />
      ) : (
        <TrailTable rows={recall.data ?? EMPTY} />
      )}
    </div>
  );
}

function SettingsTab() {
  const { t } = useAppTranslation();
  const settings = useExpirySettings();
  const save = useSaveExpirySettings();
  const mayManage = usePermission("inventory.expiry.manage");
  const [days, setDays] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const value = days ?? settings.data?.nearExpiryDays ?? DEFAULT_NEAR_EXPIRY_DAYS;

  async function submit() {
    if (save.isPending) return;
    setError(null);
    setSaved(false);
    try {
      await save.mutateAsync({ nearExpiryDays: value });
      setDays(null);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, t("expiry.settings.saveFailed")));
    }
  }

  if (settings.isError) return <ErrorNote message={settings.error.message} />;
  return (
    <Card className="flex max-w-[520px] flex-col gap-[14px] p-[16px]">
      {error ? <ErrorNote message={error} /> : null}
      <NumberField
        label={t("expiry.settings.nearExpiryDays")}
        hint={t("expiry.settings.nearExpiryDaysHint")}
        value={value}
        min={1}
        max={730}
        onChange={(v) => setDays(Math.trunc(v))}
        disabled={!mayManage}
      />
      {saved ? <p className="text-[12.5px] text-success-ink">{t("expiry.settings.saved")}</p> : null}
      {mayManage ? (
        <div>
          <Button variant="primary" disabled={save.isPending || value < 1 || value > 730} onClick={() => void submit()}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function ExpiryBatchesScreen() {
  const { t } = useAppTranslation();
  const tabs = [
    { key: ExpiryTab.Batches, label: t("expiry.tab.batches"), render: () => <BatchesTab /> },
    { key: ExpiryTab.WriteOff, label: t("expiry.tab.writeOff"), render: () => <WriteOffTab /> },
    { key: ExpiryTab.Alerts, label: t("expiry.tab.alerts"), render: () => <AlertsTab /> },
    { key: ExpiryTab.Fefo, label: t("expiry.tab.fefo"), render: () => <FefoTab /> },
    { key: ExpiryTab.Recall, label: t("expiry.tab.recall"), render: () => <RecallTab /> },
    { key: ExpiryTab.Settings, label: t("expiry.tab.settings"), render: () => <SettingsTab /> },
  ];
  return (
    <div className="w-full">
      <div className="mb-[16px]">
        <h1 className="font-display text-2xl font-bold text-ink">{t("expiry.title")}</h1>
        <p className="mt-[5px] max-w-[72ch] text-[12.5px] text-ink-muted">{t("expiry.subtitle")}</p>
      </div>
      <ScreenTabs ariaLabel={t("expiry.title")} tabs={tabs} primaryCount={4} moreLabel={t("expiry.tab.more")} />
    </div>
  );
}
