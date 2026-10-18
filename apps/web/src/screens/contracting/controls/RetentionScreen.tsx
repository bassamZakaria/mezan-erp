import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyValue,
  MoneyInput,
  RowMenu,
  StatusPill,
  useFormat,
  type DocumentListColumn,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { RetentionCalendarRowDTO, RetentionReleaseDTO, RetentionReleaseKindDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useWorksContracts } from "../../../data/contracting-contracts-hooks";
import {
  useCancelRetentionRelease,
  useCreateRetentionRelease,
  useRecordHandover,
  useReleaseRetention,
  useRetentionCalendar,
  useRetentionHeadroom,
  useRetentionReleases,
} from "../../../data/contracting-controls-hooks";
import {
  Field,
  FormColumns,
  FormError,
  FormPage,
  SectionCard,
  SelectField,
  TextAreaField,
  TextField,
} from "../../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useSubPage } from "../../../navigation";
import { majorOf } from "../../../lib/money";
import { EMPTY } from "../../../lib/empty";

/**
 * المحتجزات — the retention calendar and the release document (design §06).
 *
 * Retention is a receivable whose clock is the RELEASE EVENT, not the
 * certificate that withheld it: aged as ordinary AR every balance reads
 * 120-days-overdue the day it is created. The calendar therefore counts DOWN
 * to the event and only starts ageing once it has passed.
 */

const VIEW_PERMISSION = "contracting.certificate.view";
const RELEASE_PERMISSION = "contracting.retention.release";
const PAGE_SIZES = [10, 25, 50, 100] as const;

const KIND_KEY: Record<RetentionReleaseKindDTO, AppTranslationKey> = {
  provisional: "retention.kind.provisional",
  final: "retention.kind.final",
  other: "retention.kind.other",
};

const STATUS_TONE: Record<string, PillTone> = {
  draft: "neutral",
  released: "success",
  cancelled: "danger",
};

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface Draft {
  id: string;
  contractId: string | null;
  kind: RetentionReleaseKindDTO;
  date: string;
  amount: number | null;
  notes: string;
}

function blankDraft(): Draft {
  return { id: `RET-${Date.now()}`, contractId: null, kind: "provisional", date: todayIso(), amount: null, notes: "" };
}

export function RetentionScreen() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const { session } = useApi();
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;

  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(authContext, VIEW_PERMISSION);
  const mayRelease = can(authContext, RELEASE_PERMISSION);

  const [asOfDate, setAsOfDate] = useState<string>(todayIso());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Which release an action is running on — never a list-wide pending flag. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [handoverContractId, setHandoverContractId] = useState<string | null>(null);
  const [handoverProvisional, setHandoverProvisional] = useState("");
  const [handoverFinal, setHandoverFinal] = useState("");
  const [handoverPercent, setHandoverPercent] = useState("");

  const calendarQuery = useRetentionCalendar(asOfDate);
  const releasesQuery = useRetentionReleases(null);
  const contractsQuery = useWorksContracts();
  const headroomQuery = useRetentionHeadroom(draft.contractId, draft.kind);

  const createRelease = useCreateRetentionRelease();
  const releaseRetention = useReleaseRetention();
  const [approvedBy, setApprovedBy] = useState("");
  const cancelRelease = useCancelRetentionRelease();
  const recordHandover = useRecordHandover();

  const releases = releasesQuery.data ?? (EMPTY as RetentionReleaseDTO[]);
  const receivable = calendarQuery.data?.receivable ?? EMPTY;
  const payable = calendarQuery.data?.payable ?? EMPTY;

  const contractOptions: EntityPickerOption[] = useMemo(
    () => (contractsQuery.data ?? []).map((c) => ({ id: c.id, label: `${c.docNo} — ${c.titleAr}` })),
    [contractsQuery.data],
  );

  const selected =
    firstSegment && firstSegment !== "new"
      ? (releases.find((r) => r.docNo === firstSegment || r.id === firstSegment) ?? null)
      : null;

  async function runAction(release: RetentionReleaseDTO, run: () => Promise<unknown>): Promise<void> {
    if (pendingId !== null) return;
    setPendingId(release.id);
    setActionError(null);
    try {
      await run();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("retention.api.releaseActionFailed"));
    } finally {
      setPendingId(null);
    }
  }

  async function submitDraft(): Promise<void> {
    setFormError(null);
    if (draft.contractId === null) return setFormError(t("retention.contractRequired"));
    if (draft.amount === null || draft.amount <= 0) return setFormError(t("retention.amountRequired"));
    if (draft.date === "") return setFormError(t("retention.dateRequired"));
    try {
      const created = await createRelease.mutateAsync({
        id: draft.id,
        contractId: draft.contractId,
        kind: draft.kind,
        date: draft.date,
        amount: draft.amount.toFixed(2),
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      setDraft(blankDraft());
      subPage.open(created.docNo);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("retention.api.saveFailed"));
    }
  }

  async function submitHandover(): Promise<void> {
    if (handoverContractId === null) return;
    setActionError(null);
    try {
      await recordHandover.mutateAsync({
        contractId: handoverContractId,
        body: {
          provisionalHandoverDate: handoverProvisional === "" ? null : handoverProvisional,
          finalHandoverDate: handoverFinal === "" ? null : handoverFinal,
          ...(handoverPercent.trim() === "" ? {} : { provisionalReleasePercent: handoverPercent.trim() }),
        },
      });
      setHandoverContractId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("retention.api.handoverFailed"));
    }
  }

  function openHandover(row: RetentionCalendarRowDTO): void {
    setHandoverContractId(row.contractId);
    setHandoverProvisional(row.provisionalHandoverDate ?? "");
    setHandoverFinal(row.finalHandoverDate ?? "");
    setHandoverPercent(row.provisionalReleasePercent);
  }

  if (!mayView) {
    return <EmptyState title={t("retention.noAccessTitle")} description={t("retention.noAccessBody")} />;
  }

  if (firstSegment === "new") {
    const headroom = headroomQuery.data ?? null;
    return (
      <FormPage
        eyebrow={t("retention.title")}
        title={t("retention.newRelease")}
        description={t("retention.newReleaseBody")}
        actions={
          <>
            <Button onClick={() => subPage.close()}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void submitDraft()} disabled={createRelease.isPending}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <FormError message={formError} />
        <SectionCard title={t("retention.section.document")}>
          <FormColumns>
            <EntityPicker
              label={t("retention.contract")}
              value={contractOptions.find((o) => o.id === draft.contractId) ?? null}
              onChange={(option) => setDraft((d) => ({ ...d, contractId: option?.id ?? null }))}
              options={contractOptions}
              placeholder={t("retention.chooseContract")}
            />
            <SelectField
              label={t("retention.kind")}
              value={draft.kind}
              onChange={(value) => setDraft((d) => ({ ...d, kind: value as RetentionReleaseKindDTO }))}
              options={(["provisional", "final", "other"] as RetentionReleaseKindDTO[]).map((k) => ({
                value: k,
                label: t(KIND_KEY[k]),
              }))}
            />
            <TextField
              label={t("retention.date")}
              type="date"
              value={draft.date}
              onChange={(value) => setDraft((d) => ({ ...d, date: value }))}
            />
            <Field label={t("retention.amount")}>
              <MoneyInput
                aria-label={t("retention.amount")}
                value={draft.amount}
                onChange={(value) => setDraft((d) => ({ ...d, amount: value }))}
              />
            </Field>
          </FormColumns>
          <TextAreaField
            label={t("common.notes")}
            value={draft.notes}
            onChange={(value) => setDraft((d) => ({ ...d, notes: value }))}
          />
        </SectionCard>
        <SectionCard title={t("retention.section.position")} description={t("retention.positionHint")}>
          {headroom === null ? (
            <p className="text-[12.5px] text-ink-muted">{t("retention.pickContractFirst")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-4">
              <Figure label={t("retention.held")} value={<MoneyValue value={majorOf(headroom.held)} />} />
              <Figure label={t("retention.released")} value={<MoneyValue value={majorOf(headroom.released)} />} />
              <Figure label={t("retention.balance")} value={<MoneyValue value={majorOf(headroom.balance)} />} />
              <Figure label={t("retention.cap")} value={<MoneyValue value={majorOf(headroom.cap)} />} />
            </div>
          )}
        </SectionCard>
      </FormPage>
    );
  }

  if (firstSegment && selected) {
    return (
      <div className="w-full">
        {actionError ? (
          <Card className="mb-[18px] p-[18px_20px]">
            <p className="text-[13px] font-semibold text-danger-ink">{actionError}</p>
          </Card>
        ) : null}
        <DocumentDetail
          title={selected.docNo}
          statusLabel={selected.statusLabelAr}
          statusTone={STATUS_TONE[selected.status] ?? "neutral"}
          subtitle={
            <span className="mz-num">
              {selected.contractDocNo} · {selected.date}
            </span>
          }
          actions={
            <div className="flex flex-wrap items-center gap-[9px]">
              <Button variant="ghost" onClick={() => subPage.close()}>
                {t("common.back")}
              </Button>
              {mayRelease && selected.status === "draft" ? (
                <>
                  {selected.earlyRelease ? (
                    <TextField
                      label={t("retention.approvedBy")}
                      value={approvedBy}
                      onChange={setApprovedBy}
                      hint={t("retention.approvedByHint")}
                    />
                  ) : null}
                  <Button
                    variant="primary"
                    disabled={pendingId === selected.id || (selected.earlyRelease && approvedBy.trim() === "")}
                    onClick={() =>
                      void runAction(selected, () =>
                        releaseRetention.mutateAsync({
                          id: selected.id,
                          approvedBy: selected.earlyRelease ? approvedBy.trim() : null,
                        }),
                      )
                    }
                  >
                    {t("retention.action.release")}
                  </Button>
                  <Button
                    variant="danger-outline"
                    disabled={pendingId === selected.id}
                    onClick={() => void runAction(selected, () => cancelRelease.mutateAsync({ id: selected.id }))}
                  >
                    {t("retention.action.cancel")}
                  </Button>
                </>
              ) : null}
            </div>
          }
          summary={[
            { label: t("retention.kind"), value: selected.kindLabelAr },
            { label: t("retention.amount"), value: <MoneyValue value={majorOf(selected.amount)} /> },
            {
              label: t("retention.eventDate"),
              value: selected.releaseEventDate ?? t("retention.noEventDate"),
              valueTone: selected.earlyRelease ? "danger" : "default",
            },
            { label: t("retention.held"), value: <MoneyValue value={majorOf(selected.held)} /> },
            { label: t("retention.balance"), value: <MoneyValue value={majorOf(selected.balance)} /> },
          ]}
          tabs={[
            {
              key: "document",
              label: t("retention.tab.document"),
              content: (
                <Card className="divide-y divide-border">
                  <Figure label={t("retention.contract")} value={`${selected.contractDocNo} — ${selected.contractTitleAr}`} />
                  <Figure label={t("retention.date")} value={<span className="mz-num">{selected.date}</span>} />
                  <Figure
                    label={t("retention.eventDate")}
                    value={<span className="mz-num">{selected.releaseEventDate ?? t("retention.noEventDate")}</span>}
                  />
                  <Figure label={t("retention.cap")} value={<MoneyValue value={majorOf(selected.cap)} />} />
                  {selected.notes ? <Figure label={t("common.notes")} value={selected.notes} /> : null}
                  {selected.createdBy ? <Figure label={t("retention.createdBy")} value={selected.createdBy} /> : null}
                  {selected.releasedBy ? <Figure label={t("retention.releasedBy")} value={selected.releasedBy} /> : null}
                  {selected.approvedBy ? <Figure label={t("retention.approvedBy")} value={selected.approvedBy} /> : null}
                  {selected.earlyRelease ? (
                    <div className="p-[13px_15px] text-[12.5px] text-danger-ink">{t("retention.earlyWarning")}</div>
                  ) : null}
                </Card>
              ),
            },
            {
              key: "receivable",
              label: t("retention.tab.receivable"),
              content:
                selected.invoiceId === null ? (
                  <EmptyState title={t("retention.noInvoiceTitle")} description={t("retention.noInvoiceBody")} />
                ) : (
                  <Card className="divide-y divide-border">
                    <Figure label={t("retention.invoice")} value={<span className="mz-num">{selected.invoiceDocNo}</span>} />
                    <Figure
                      label={t("retention.invoiceTotal")}
                      value={<MoneyValue value={majorOf(selected.invoiceTotal ?? "0")} />}
                    />
                    <Figure
                      label={t("retention.invoiceRemaining")}
                      value={<MoneyValue value={majorOf(selected.invoiceRemaining ?? "0")} />}
                    />
                    <div className="p-[13px_15px] text-[11.5px] text-ink-muted">{t("retention.invoiceBasis")}</div>
                  </Card>
                ),
            },
          ]}
        />
      </div>
    );
  }

  const releaseColumns: DocumentListColumn<RetentionReleaseDTO>[] = [
    { key: "docNo", header: t("retention.col.docNo"), render: (r) => <span className="mz-num">{r.docNo}</span> },
    { key: "contract", header: t("retention.col.contract"), render: (r) => <span className="mz-num">{r.contractDocNo}</span> },
    { key: "kind", header: t("retention.col.kind"), render: (r) => r.kindLabelAr },
    { key: "date", header: t("retention.col.date"), render: (r) => <span className="mz-num">{r.date}</span> },
    {
      key: "eventDate",
      header: t("retention.col.eventDate"),
      render: (r) => <span className="mz-num">{r.releaseEventDate ?? t("retention.noEventDate")}</span>,
    },
    { key: "amount", header: t("retention.col.amount"), align: "end", render: (r) => <MoneyValue value={majorOf(r.amount)} /> },
    {
      key: "status",
      header: t("common.status"),
      render: (r) => (
        <div className="flex flex-wrap items-center gap-[6px]">
          <StatusPill label={r.statusLabelAr} tone={STATUS_TONE[r.status] ?? "neutral"} />
          {r.earlyRelease ? <StatusPill label={t("retention.earlyPill")} tone="danger" /> : null}
        </div>
      ),
    },
  ];

  const pageCount = Math.max(1, Math.ceil(releases.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = releases.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const totalBalance = receivable.reduce((sum, r) => sum + majorOf(r.balance), 0);
  const dueBalance = receivable.filter((r) => r.event.due).reduce((sum, r) => sum + majorOf(r.balance), 0);
  const payableBalance = payable.reduce((sum, r) => sum + majorOf(r.balance), 0);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t("retention.title")}</h1>
          <p className="mt-[4px] max-w-[74ch] text-sm text-ink-muted">{t("retention.description")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-[9px]">
          <TextField label={t("retention.asOfDate")} type="date" value={asOfDate} onChange={setAsOfDate} />
          {mayRelease ? (
            <Button variant="primary" onClick={() => subPage.open("new")}>
              {t("retention.newRelease")}
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{actionError}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
        <Figure label={t("retention.stat.balance")} value={<MoneyValue value={totalBalance} />} boxed />
        <Figure
          label={t("retention.stat.due")}
          value={<MoneyValue value={dueBalance} className={dueBalance > 0 ? "text-danger-ink" : undefined} />}
          boxed
        />
        <Figure label={t("retention.stat.payable")} value={<MoneyValue value={payableBalance} />} boxed />
      </div>

      <Card className="p-[18px_20px]">
        <h2 className="font-display text-md font-bold text-ink">{t("retention.receivableTitle")}</h2>
        <p className="mb-[12px] mt-[2px] text-2xs text-ink-faint">{t("retention.receivableHint")}</p>
        {receivable.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">{t("retention.noReceivable")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-ink-muted">
                  <th className="p-[7px_8px] text-start">{t("retention.col.contract")}</th>
                  <th className="p-[7px_8px] text-start">{t("retention.col.project")}</th>
                  <th className="p-[7px_8px] text-end">{t("retention.held")}</th>
                  <th className="p-[7px_8px] text-end">{t("retention.released")}</th>
                  <th className="p-[7px_8px] text-end">{t("retention.balance")}</th>
                  <th className="p-[7px_8px] text-start">{t("retention.col.nextEvent")}</th>
                  <th className="p-[7px_8px] text-end">{t("retention.col.daysToEvent")}</th>
                  <th className="p-[7px_8px] text-start">{t("common.status")}</th>
                  <th className="p-[7px_8px] text-end" />
                </tr>
              </thead>
              <tbody>
                {receivable.map((row) => (
                  <tr key={row.contractId} className="border-b border-border">
                    <td className="p-[7px_8px]">
                      <span className="mz-num text-ink">{row.contractDocNo}</span>
                      <div className="truncate text-[11.5px] text-ink-muted">{row.contractTitleAr}</div>
                      {row.finalSecurity ? (
                        <div className="text-[11.5px] text-ink-muted">{t("retention.finalSecurityContract")}</div>
                      ) : null}
                    </td>
                    <td className="p-[7px_8px]">{row.projectNameAr ?? row.projectId}</td>
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(row.held)} showUnit={false} />
                    </td>
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(row.released)} showUnit={false} />
                    </td>
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(row.balance)} showUnit={false} />
                    </td>
                    <td className="p-[7px_8px]">
                      {row.event.date === null ? (
                        <span className="text-ink-muted">{t("retention.noEventDate")}</span>
                      ) : (
                        <>
                          <span className="mz-num">{row.event.date}</span>
                          <div className="text-[11.5px] text-ink-muted">
                            {row.finalSecurity
                              ? t("retention.finalSecurityEvent", {
                                  docNo: row.finalSecurity.guaranteeDocNo ?? "—",
                                })
                              : row.event.kind === null
                                ? ""
                                : t(KIND_KEY[row.event.kind])}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="mz-num p-[7px_8px] text-end">
                      {row.event.daysToEvent === null ? "—" : format.number(row.event.daysToEvent)}
                    </td>
                    <td className="p-[7px_8px]">
                      {row.event.due ? (
                        <StatusPill
                          label={t("retention.duePill", { days: format.number(row.event.ageDays ?? 0) })}
                          tone="danger"
                        />
                      ) : (
                        <StatusPill label={t("retention.waitingPill")} tone="neutral" />
                      )}
                    </td>
                    <td className="p-[7px_8px] text-end">
                      {mayRelease ? (
                        <RowMenu
                          items={
                            [
                              {
                                key: "release",
                                label: t("retention.action.newForContract"),
                                onSelect: () => {
                                  setDraft({ ...blankDraft(), contractId: row.contractId });
                                  subPage.open("new");
                                },
                              },
                              {
                                key: "handover",
                                label: t("retention.action.recordHandover"),
                                onSelect: () => openHandover(row),
                              },
                            ] as RowMenuItem[]
                          }
                          label={t("common.rowActionsFor", { name: row.contractDocNo })}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {handoverContractId !== null ? (
        <Card className="p-[18px_20px]">
          <h2 className="font-display text-md font-bold text-ink">{t("retention.handoverTitle")}</h2>
          <p className="mb-[12px] mt-[2px] text-2xs text-ink-faint">{t("retention.handoverHint")}</p>
          <FormColumns>
            <TextField
              label={t("retention.provisionalHandover")}
              type="date"
              value={handoverProvisional}
              onChange={setHandoverProvisional}
            />
            <TextField
              label={t("retention.finalHandover")}
              type="date"
              value={handoverFinal}
              onChange={setHandoverFinal}
            />
            <TextField
              label={t("retention.provisionalReleasePercent")}
              value={handoverPercent}
              onChange={setHandoverPercent}
              hint={t("retention.provisionalReleasePercentHint")}
            />
          </FormColumns>
          <div className="mt-[12px] flex flex-wrap gap-[9px]">
            <Button onClick={() => setHandoverContractId(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={recordHandover.isPending} onClick={() => void submitHandover()}>
              {t("common.save")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-[18px_20px]">
        <h2 className="font-display text-md font-bold text-ink">{t("retention.payableTitle")}</h2>
        <p className="mb-[12px] mt-[2px] text-2xs text-ink-faint">{t("retention.payableHint")}</p>
        {payable.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">{t("retention.noPayable")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-ink-muted">
                  <th className="p-[7px_8px] text-start">{t("retention.col.project")}</th>
                  <th className="p-[7px_8px] text-start">{t("retention.col.contract")}</th>
                  <th className="p-[7px_8px] text-end">{t("retention.held")}</th>
                  <th className="p-[7px_8px] text-end">{t("retention.released")}</th>
                  <th className="p-[7px_8px] text-end">{t("retention.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {payable.map((row) => (
                  <tr key={row.projectId} className="border-b border-border">
                    <td className="p-[7px_8px]">{row.projectNameAr ?? row.projectId}</td>
                    <td className="mz-num p-[7px_8px]">{row.contractDocNo ?? "—"}</td>
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(row.held)} showUnit={false} />
                    </td>
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(row.released)} showUnit={false} />
                    </td>
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(row.balance)} showUnit={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DocumentList<RetentionReleaseDTO>
        nested
        title={t("retention.releasesTitle")}
        description={t("retention.releasesDescription")}
        listKey="contracting-retention-releases"
        columns={releaseColumns}
        rows={pageRows}
        loading={releasesQuery.isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => subPage.open(r.docNo)}
        rowAction={(r) => {
          if (!mayRelease || r.status !== "draft") return null;
          return (
            <RowMenu
              items={[
                {
                  key: "release",
                  label: t("retention.action.release"),
                  disabled: pendingId === r.id,
                  onSelect: () => void runAction(r, () => releaseRetention.mutateAsync({ id: r.id })),
                },
                {
                  key: "cancel",
                  label: t("retention.action.cancel"),
                  disabled: pendingId === r.id,
                  onSelect: () => void runAction(r, () => cancelRelease.mutateAsync({ id: r.id })),
                },
              ]}
              label={t("common.rowActionsFor", { name: r.docNo })}
            />
          );
        }}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyState={<EmptyState title={t("retention.noReleasesTitle")} description={t("retention.noReleasesBody")} />}
      />
    </div>
  );
}

function Figure({
  label,
  value,
  boxed,
}: {
  label: string;
  value: React.ReactNode;
  boxed?: boolean;
}) {
  if (boxed) {
    return (
      <Card className="p-[14px_16px]">
        <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
        <div className="mt-[5px] text-[15px] font-bold text-ink">{value}</div>
      </Card>
    );
  }
  return (
    <div className="border-b border-border p-[13px_15px] last:border-b-0">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[5px] text-[13.5px] font-bold text-ink">{value}</div>
    </div>
  );
}
