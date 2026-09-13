import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  EntityPicker,
  modKeyLabel,
  RowMenu,
  Select,
  StatusPill,
  useFormat,
  type DocumentListColumn,
  type RowMenuItem,
} from "@mezan/ui";
import type { EquipmentLogDTO } from "@mezan/contracts";
import {
  useConfirmEquipmentLog,
  useCreateEquipmentLog,
  useEquipmentHours,
  useEquipmentLogs,
} from "../../../data/contracting-site-hooks";
import { useContractBoq, useWorksContracts } from "../../../data/contracting-contracts-hooks";
import { useAssets, useProjects } from "../../../data/hooks";
import { FormColumns, FormError, FormPage, SectionCard, SelectField, TextField } from "../../../settings/form-controls";
import { useSubPage } from "../../../navigation";
import { useAppTranslation } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { useUrlParam } from "../../../lib/url-state";
import { trimDecimal } from "./site-common";

/**
 * تشغيل المعدات — plant hours charged to a project at the asset's internal
 * hire rate: Dr أعمال تحت التنفيذ (فئة معدات) / Cr استرداد تكلفة تشغيل المعدات.
 * The credit is a recovery account, not revenue: the company is charging
 * itself, and the depreciation it offsets is already in the books.
 */
export function EquipmentLogsScreen() {
  const { t } = useAppTranslation();
  const { money } = useFormat();
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const [projectFilter, setProjectFilter] = useUrlParam("project", "all");

  const projects = useProjects().data ?? EMPTY;
  const assets = useAssets().data ?? EMPTY;
  const query = useEquipmentLogs(projectFilter !== "all" ? { projectId: projectFilter } : {});
  const rows = query.data ?? EMPTY;
  const hours = useEquipmentHours(projectFilter !== "all" ? projectFilter : null).data ?? EMPTY;
  const confirmLog = useConfirmEquipmentLog();
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function assetLabel(id: string): string {
    const asset = assets.find((a) => a.id === id);
    return asset ? `${asset.nameAr} (${asset.code})` : id;
  }

  async function confirmRow(id: string): Promise<void> {
    if (rowPendingId) return;
    setRowError(null);
    setRowPendingId(id);
    try {
      await confirmLog.mutateAsync(id);
    } catch (err) {
      setRowError(errorMessage(err, t("common.failed")));
    } finally {
      setRowPendingId(null);
    }
  }

  if (firstSegment === "new") return <NewEquipmentLogView onDone={subPage.close} />;

  const columns: DocumentListColumn<EquipmentLogDTO>[] = [
    {
      key: "docNo",
      header: t("site.equipment.docNo"),
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</span>,
    },
    { key: "date", header: t("common.date"), sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    { key: "asset", header: t("site.equipment.asset"), render: (d) => assetLabel(d.assetId) },
    {
      key: "project",
      header: t("site.project"),
      render: (d) => projects.find((p) => p.id === d.projectId)?.nameAr ?? d.projectId,
    },
    { key: "boq", header: t("site.boqLine"), render: (d) => d.boqLineId ?? "—" },
    { key: "hours", header: t("site.equipment.hours"), align: "end", render: (d) => <span className="mz-num">{trimDecimal(d.hours)}</span> },
    { key: "rate", header: t("site.equipment.rate"), align: "end", render: (d) => <span className="mz-num">{money(Number(d.hourlyRate))}</span> },
    { key: "amount", header: t("site.equipment.amount"), align: "end", render: (d) => <span className="mz-num font-semibold">{money(Number(d.amount))}</span> },
    {
      key: "status",
      header: t("common.status"),
      render: (d) => (
        <StatusPill
          label={d.status === "confirmed" ? t("docStatus.confirmed") : t("docStatus.draft")}
          tone={d.status === "confirmed" ? "success" : "neutral"}
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
      <DocumentList<EquipmentLogDTO>
        title={t("site.equipment.title")}
        description={t("site.equipment.description")}
        actions={
          <Button variant="primary" shortcut={`${modKeyLabel()}+N`} onClick={() => subPage.open("new")}>
            {t("site.equipment.new")}
          </Button>
        }
        listKey="equipment-logs"
        stats={[
          { label: t("site.equipment.statLogs"), value: <span className="mz-num">{rows.length}</span> },
          {
            label: t("site.equipment.statHours"),
            value: (
              <span className="mz-num">
                {trimDecimal(String(rows.filter((d) => d.status === "confirmed").reduce((total, d) => total + Number(d.hours), 0)))}
              </span>
            ),
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
          const items: RowMenuItem[] = [
            ...(d.status === "draft"
              ? [{ key: "confirm", label: t("site.equipment.confirm"), disabled: rowPendingId === d.id, onSelect: () => void confirmRow(d.id) }]
              : []),
          ];
          return items.length > 0 ? <RowMenu items={items} label={t("common.rowActionsFor", { name: d.docNo ?? d.id })} /> : null;
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
            title={t("site.equipment.emptyTitle")}
            description={t("site.equipment.emptyBody")}
            action={{ label: t("site.equipment.new"), onClick: () => subPage.open("new") }}
          />
        }
      />

      {projectFilter !== "all" ? (
        <Card className="mt-[18px] p-[18px_20px]">
          <h3 className="font-display text-[14px] font-bold text-ink">{t("site.equipment.byBoqTitle")}</h3>
          <p className="mt-[4px] text-[12px] text-ink-muted">{t("site.equipment.byBoqDescription")}</p>
          {hours.length === 0 ? (
            <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("site.equipment.byBoqEmpty")}</p>
          ) : (
            <div className="mt-[12px] overflow-x-auto">
              <table className="w-full min-w-[360px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border px-[10px] py-[8px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("site.boqLine")}</th>
                    <th scope="col" className="border-b border-border px-[10px] py-[8px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("site.equipment.hours")}</th>
                    <th scope="col" className="border-b border-border px-[10px] py-[8px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("site.equipment.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((row) => (
                    <tr key={row.boqLineId ?? "unassigned"} className="border-b border-border last:border-b-0">
                      <td className="px-[10px] py-[9px] text-ink">{row.boqLineId ?? t("site.equipment.noBoqLine")}</td>
                      <td className="px-[10px] py-[9px] text-end mz-num">{trimDecimal(row.hours)}</td>
                      <td className="px-[10px] py-[9px] text-end mz-num">{money(Number(row.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function NewEquipmentLogView({ onDone }: { onDone: () => void }) {
  const { t } = useAppTranslation();
  const createLog = useCreateEquipmentLog();
  const confirmLog = useConfirmEquipmentLog();
  const projects = useProjects().data ?? EMPTY;
  const assets = useAssets().data ?? EMPTY;
  const contracts = useWorksContracts().data ?? EMPTY;

  const [projectId, setProjectId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [hours, setHours] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [boqLineId, setBoqLineId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId === "" && projects.length > 0) setProjectId(projects[0]?.id ?? "");
  }, [projects, projectId]);

  const asset = assets.find((a) => a.id === assetId) ?? null;
  // Seeded from the asset, still editable: a night shift or a hired-in
  // replacement is charged at a different rate, and the posting must show the
  // rate actually applied.
  useEffect(() => {
    setHourlyRate(asset?.internalHourlyRate ?? "");
  }, [asset?.id, asset?.internalHourlyRate]);

  const contract = contracts.find((c) => c.projectId === projectId) ?? null;
  const boqLines = useContractBoq(contract?.id ?? null).data?.lines ?? EMPTY;
  const boqOptions = useMemo(
    () => boqLines.map((l) => ({ id: l.id, label: `${l.code} — ${l.descriptionAr}`, sublabel: l.unitLabelAr })),
    [boqLines],
  );
  const assetOptions = useMemo(
    () => assets.filter((a) => a.status !== "disposed").map((a) => ({ id: a.id, label: a.nameAr, sublabel: a.code })),
    [assets],
  );

  const ready = projectId !== "" && assetId !== "" && Number(hours) > 0 && Number(hourlyRate) > 0;
  const busy = createLog.isPending || confirmLog.isPending;
  const amount = ready ? String(Number(hours) * Number(hourlyRate)) : null;

  async function save() {
    if (!ready) return;
    setError(null);
    const id = crypto.randomUUID();
    try {
      await createLog.mutateAsync({
        id,
        projectId,
        assetId,
        date,
        hours,
        hourlyRate,
        boqLineId: boqLineId === "" ? null : boqLineId,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      await confirmLog.mutateAsync(id);
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("site.equipment.saveFailed")));
    }
  }

  return (
    <FormPage
      eyebrow={t("site.equipment.title")}
      title={t("site.equipment.newTitle")}
      description={t("site.equipment.newDescription")}
      actions={
        <>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
            {t("site.equipment.saveAndConfirm")}
          </Button>
        </>
      }
    >
      <FormError message={error} />
      <FormColumns
        aside={
          <SectionCard title={t("site.equipment.effectTitle")} columns={1}>
            <p className="text-[12.5px] text-ink-muted">{t("site.equipment.effectBody")}</p>
            {amount ? (
              <p className="mz-num text-[13px] font-semibold text-ink">{t("site.equipment.previewAmount", { amount })}</p>
            ) : null}
          </SectionCard>
        }
      >
        <SectionCard title={t("site.equipment.headerTitle")}>
          <SelectField
            label={t("site.project")}
            value={projectId}
            onChange={setProjectId}
            options={projects.map((p) => ({ value: p.id, label: p.nameAr }))}
          />
          <div>
            <EntityPicker
              label={t("site.equipment.asset")}
              value={assetId === "" ? null : (assetOptions.find((o) => o.id === assetId) ?? null)}
              onChange={(option) => setAssetId(option?.id ?? "")}
              options={assetOptions}
              placeholder={t("site.equipment.chooseAsset")}
              emptyMessage={t("site.equipment.noAssets")}
            />
          </div>
          <TextField label={t("common.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
          <TextField label={t("site.equipment.hours")} value={hours} onChange={setHours} type="number" />
          <TextField
            label={t("site.equipment.rate")}
            value={hourlyRate}
            onChange={setHourlyRate}
            type="number"
            hint={asset && !asset.internalHourlyRate ? t("site.equipment.noAssetRate") : undefined}
          />
          <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
          <div>
            <EntityPicker
              label={t("site.boqLine")}
              value={boqLineId === "" ? null : (boqOptions.find((o) => o.id === boqLineId) ?? null)}
              onChange={(option) => setBoqLineId(option?.id ?? "")}
              options={boqOptions}
              placeholder={t("site.chooseBoqLine")}
              emptyMessage={contract ? t("site.noBoqLines") : t("site.noContractForProject")}
            />
          </div>
        </SectionCard>
      </FormColumns>
    </FormPage>
  );
}
