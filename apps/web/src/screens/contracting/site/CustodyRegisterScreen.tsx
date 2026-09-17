import { useEffect, useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  EmptyState,
  RowMenu,
  Select,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type RowMenuItem,
} from "@mezan/ui";
import type { CustodyItemDTO } from "@mezan/contracts";
import { useCustodyItems, useIssueCustody, useReturnCustody } from "../../../data/contracting-site-hooks";
import { useProjects, useUsers, useWarehouses } from "../../../data/hooks";
import { FormError, SelectField, TextField } from "../../../settings/form-controls";
import { useAppTranslation } from "../../../i18n";
import { useEntityName } from "../../../lib/entity-names";
import { errorMessage } from "../../../lib/error-message";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { useUrlParam } from "../../../lib/url-state";
import { trimDecimal } from "./site-common";

/**
 * عهدة الشدة والسقالات (D-11) — a register of returnable material, with NO
 * valuation, no stock movement and no posting. Formwork issued to a site is
 * company property that comes back; expensing it to the project would charge
 * the job for an asset the company still owns.
 */
export function CustodyRegisterScreen() {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const [projectFilter, setProjectFilter] = useUrlParam("project", "all");
  const [panel, setPanel] = useState<{ mode: "issue" } | { mode: "return"; item: CustodyItemDTO } | null>(null);

  const projects = useProjects().data ?? EMPTY;
  const warehouses = useWarehouses().data ?? EMPTY;
  const users = useUsers().data ?? EMPTY;
  const query = useCustodyItems(projectFilter !== "all" ? { projectId: projectFilter } : {});
  const rows = query.data ?? EMPTY;

  const siteStores = useMemo(() => warehouses.filter((w) => w.type === "SITE" && w.active), [warehouses]);

  function userLabel(id: string): string {
    const user = users.find((u) => u.id === id);
    return user ? user.nameAr : id;
  }

  const columns: DocumentListColumn<CustodyItemDTO>[] = [
    { key: "description", header: t("site.custody.description"), render: (d) => <span className="font-semibold text-ink">{d.descriptionAr}</span> },
    {
      key: "project",
      header: t("site.project"),
      render: (d) => projects.find((p) => p.id === d.projectId)?.nameAr ?? d.projectId,
    },
    { key: "warehouse", header: t("site.custody.warehouse"), render: (d) => nameOf(warehouses.find((w) => w.id === d.warehouseId), d.warehouseId) },
    { key: "custodian", header: t("site.custody.custodian"), render: (d) => userLabel(d.custodianUserId) },
    { key: "out", header: t("site.custody.qtyOut"), align: "end", render: (d) => <span className="mz-num">{trimDecimal(d.qtyOut)}</span> },
    { key: "returned", header: t("site.custody.qtyReturned"), align: "end", render: (d) => <span className="mz-num">{trimDecimal(d.qtyReturned)}</span> },
    {
      key: "outstanding",
      header: t("site.custody.qtyOutstanding"),
      align: "end",
      render: (d) => {
        const outstanding = Number(d.qtyOut) - Number(d.qtyReturned);
        return (
          <StatusPill
            label={trimDecimal(String(outstanding))}
            tone={outstanding > 0 ? "warning" : "success"}
          />
        );
      },
    },
    { key: "expected", header: t("site.custody.expectedReturn"), render: (d) => <span className="mz-num text-ink-muted">{d.expectedReturnDate ?? "—"}</span> },
  ];

  return (
    <div className="w-full">
      <DocumentList<CustodyItemDTO>
        title={t("site.custody.title")}
        description={t("site.custody.description2")}
        actions={
          <Button variant="primary" disabled={siteStores.length === 0} onClick={() => setPanel({ mode: "issue" })}>
            {t("site.custody.new")}
          </Button>
        }
        listKey="site-custody"
        stats={[
          { label: t("site.custody.statRows"), value: <span className="mz-num">{rows.length}</span> },
          {
            label: t("site.custody.statOutstanding"),
            value: <span className="mz-num">{rows.filter((d) => Number(d.qtyOut) > Number(d.qtyReturned)).length}</span>,
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
            {
              key: "return",
              label: t("site.custody.returnAction"),
              disabled: Number(d.qtyReturned) >= Number(d.qtyOut),
              onSelect: () => setPanel({ mode: "return", item: d }),
            },
          ];
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: d.descriptionAr })} />;
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
            title={t("site.custody.emptyTitle")}
            description={siteStores.length === 0 ? t("site.noSiteStores") : t("site.custody.emptyBody")}
            {...(siteStores.length > 0
              ? { action: { label: t("site.custody.new"), onClick: () => setPanel({ mode: "issue" }) } }
              : {})}
          />
        }
      />

      <IssuePanel open={panel?.mode === "issue"} siteStores={siteStores} onClose={() => setPanel(null)} />
      <ReturnPanel item={panel?.mode === "return" ? panel.item : null} onClose={() => setPanel(null)} />
    </div>
  );
}

function IssuePanel({
  open,
  siteStores,
  onClose,
}: {
  open: boolean;
  siteStores: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const issueCustody = useIssueCustody();
  const [warehouseId, setWarehouseId] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [qtyOut, setQtyOut] = useState("");
  const [issuedDate, setIssuedDate] = useState(todayIso());
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && warehouseId === "" && siteStores.length > 0) setWarehouseId(siteStores[0]?.id ?? "");
  }, [open, siteStores, warehouseId]);

  const ready = warehouseId !== "" && descriptionAr.trim() !== "" && Number(qtyOut) > 0;

  async function save() {
    if (!ready) return;
    setError(null);
    try {
      await issueCustody.mutateAsync({
        id: crypto.randomUUID(),
        warehouseId,
        descriptionAr: descriptionAr.trim(),
        qtyOut,
        issuedDate,
        expectedReturnDate: expectedReturnDate === "" ? null : expectedReturnDate,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      setDescriptionAr("");
      setQtyOut("");
      setNotes("");
      onClose();
    } catch (err) {
      setError(errorMessage(err, t("site.custody.saveFailed")));
    }
  }

  return (
    <SidePanel open={open} onClose={onClose} title={t("site.custody.new")} description={t("site.custody.panelDescription")}>
      <div className="flex flex-col gap-[14px]">
        <FormError message={error} />
        <SelectField
          label={t("site.custody.warehouse")}
          value={warehouseId}
          onChange={setWarehouseId}
          options={siteStores.map((w) => ({ value: w.id, label: w.name }))}
        />
        <TextField label={t("site.custody.description")} value={descriptionAr} onChange={setDescriptionAr} />
        <TextField label={t("site.custody.qtyOut")} value={qtyOut} onChange={setQtyOut} type="number" />
        <TextField label={t("site.custody.issuedDate")} value={issuedDate} onChange={setIssuedDate} placeholder="YYYY-MM-DD" />
        <TextField
          label={t("site.custody.expectedReturn")}
          value={expectedReturnDate}
          onChange={setExpectedReturnDate}
          placeholder="YYYY-MM-DD"
        />
        <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ready || issueCustody.isPending} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

function ReturnPanel({ item, onClose }: { item: CustodyItemDTO | null; onClose: () => void }) {
  const { t } = useAppTranslation();
  const returnCustody = useReturnCustody();
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  const outstanding = item ? Number(item.qtyOut) - Number(item.qtyReturned) : 0;
  const ready = item !== null && Number(qty) > 0;

  async function save() {
    if (!item || !ready) return;
    setError(null);
    try {
      await returnCustody.mutateAsync({ id: item.id, body: { qty, date } });
      setQty("");
      onClose();
    } catch (err) {
      setError(errorMessage(err, t("site.custody.returnFailed")));
    }
  }

  return (
    <SidePanel
      open={item !== null}
      onClose={onClose}
      title={t("site.custody.returnAction")}
      description={item?.descriptionAr ?? ""}
    >
      <div className="flex flex-col gap-[14px]">
        <FormError message={error} />
        <p className="text-[12.5px] text-ink-muted">
          {t("site.custody.outstandingNote", { qty: trimDecimal(String(outstanding)) })}
        </p>
        <TextField label={t("site.custody.returnQty")} value={qty} onChange={setQty} type="number" />
        <TextField label={t("site.custody.returnDate")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!ready || returnCustody.isPending} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}
