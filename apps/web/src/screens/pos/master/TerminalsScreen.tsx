import { useMemo, useState } from "react";
import {
  RowActionOutcome,
  Button,
  Card,
  DocumentList,
  EmptyState,
  RowMenu,
  StatusPill,
  Switch,
  useFormat,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type RowMenuItem,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type {
  PosPaymentMethodDTO,
  PosPrinterKindDTO,
  PosTerminalDTO,
  PosTerminalKindDTO,
  TreasuryAccountDTO,
  UpdatePosTerminalDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useBranches, useTreasuryAccounts, useWarehouses } from "../../../data/hooks";
import { FormColumns, FormError, FormPage, SectionCard, SelectField, TextField, ToggleField } from "../../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useEntityName } from "../../../lib/entity-names";
import { useSubPage } from "../../../navigation";
import { EMPTY } from "../../../lib/empty";
import { useUrlParam, useUrlSearch } from "../../../lib/url-state";
import { useCreatePosTerminal, usePosPaymentMethods, usePosTerminals, useUpdatePosTerminal } from "./hooks";

const PAGE_SIZES = [10, 25, 50, 100] as const;

interface MethodDraft {
  readonly enabled: boolean;
  readonly treasuryAccountId: string;
}

interface Draft {
  code: string;
  name: string;
  nameEn: string;
  kind: PosTerminalKindDTO;
  active: boolean;
  branchId: string;
  warehouseId: string;
  drawerTreasuryAccountId: string;
  methods: Record<string, MethodDraft>;
  defaultMethodId: string;
  printerKind: PosPrinterKindDTO;
  printerAddress: string;
  paperWidthMm: 58 | 80;
  etaDeviceSerial: string;
  etaPosClientId: string;
  etaPosClientSecret: string;
  etaPosOsVersion: string;
  etaPosModelFramework: string;
  etaPosPresharedKey: string;
}

function blankDraft(branchId: string): Draft {
  return {
    code: "",
    name: "",
    nameEn: "",
    kind: "retail",
    active: true,
    branchId,
    warehouseId: "",
    drawerTreasuryAccountId: "",
    methods: { "PM-CASH": { enabled: true, treasuryAccountId: "" } },
    defaultMethodId: "PM-CASH",
    printerKind: "system",
    printerAddress: "",
    paperWidthMm: 80,
    etaDeviceSerial: "",
    etaPosClientId: "",
    etaPosClientSecret: "",
    etaPosOsVersion: "",
    etaPosModelFramework: "",
    etaPosPresharedKey: "",
  };
}

function draftFrom(terminal: PosTerminalDTO): Draft {
  return {
    code: terminal.code,
    name: terminal.name,
    nameEn: terminal.nameEn ?? "",
    kind: terminal.kind,
    active: terminal.active,
    branchId: terminal.branchId,
    warehouseId: terminal.warehouseId,
    drawerTreasuryAccountId: terminal.drawerTreasuryAccountId,
    methods: Object.fromEntries(terminal.methods.map((m) => [m.methodId, { enabled: true, treasuryAccountId: m.treasuryAccountId ?? "" }])),
    defaultMethodId: terminal.defaultMethodId,
    printerKind: terminal.printer.kind,
    printerAddress: terminal.printer.address ?? "",
    paperWidthMm: terminal.printer.paperWidthMm,
    etaDeviceSerial: terminal.etaDeviceSerial ?? "",
    etaPosClientId: terminal.etaPosClientId ?? "",
    etaPosClientSecret: "",
    etaPosOsVersion: terminal.etaPosOsVersion ?? "",
    etaPosModelFramework: terminal.etaPosModelFramework ?? "",
    etaPosPresharedKey: "",
  };
}

function bodyFrom(draft: Draft): UpdatePosTerminalDTO {
  const blank = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    code: draft.code.trim().toUpperCase(),
    name: draft.name.trim(),
    nameEn: blank(draft.nameEn),
    kind: draft.kind,
    active: draft.active,
    branchId: draft.branchId,
    warehouseId: draft.warehouseId,
    drawerTreasuryAccountId: draft.drawerTreasuryAccountId,
    methods: Object.entries(draft.methods)
      .filter(([, m]) => m.enabled)
      .map(([methodId, m]) => ({ methodId, treasuryAccountId: blank(m.treasuryAccountId) })),
    defaultMethodId: draft.defaultMethodId,
    printer: { kind: draft.printerKind, address: blank(draft.printerAddress), paperWidthMm: draft.paperWidthMm },
    etaDeviceSerial: blank(draft.etaDeviceSerial),
    etaPosClientId: blank(draft.etaPosClientId),
    etaPosOsVersion: blank(draft.etaPosOsVersion),
    etaPosModelFramework: blank(draft.etaPosModelFramework),
    ...(draft.etaPosClientSecret.trim() !== "" ? { etaPosClientSecret: draft.etaPosClientSecret.trim() } : {}),
    ...(draft.etaPosPresharedKey.trim() !== "" ? { etaPosPresharedKey: draft.etaPosPresharedKey.trim() } : {}),
  };
}

function bodyFromTerminal(terminal: PosTerminalDTO, active: boolean): UpdatePosTerminalDTO {
  return { ...bodyFrom(draftFrom(terminal)), active };
}

export function TerminalsScreen() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const nameOf = useEntityName();
  const { session } = useApi();
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;

  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(auth, "pos.terminal.view");
  const mayManage = can(auth, "pos.terminal.manage");

  const terminalsQuery = usePosTerminals();
  const methodsQuery = usePosPaymentMethods();
  const branchesQuery = useBranches();
  const warehousesQuery = useWarehouses();
  const accountsQuery = useTreasuryAccounts();
  const createTerminal = useCreatePosTerminal();
  const updateTerminal = useUpdatePosTerminal();

  const terminals = terminalsQuery.data ?? (EMPTY as PosTerminalDTO[]);
  const methods = methodsQuery.data ?? (EMPTY as PosPaymentMethodDTO[]);
  const branches = branchesQuery.data ?? EMPTY;
  const warehouses = warehousesQuery.data ?? EMPTY;
  const accounts = accountsQuery.data ?? (EMPTY as TreasuryAccountDTO[]);

  const [statusFilter, setStatusFilter] = useUrlParam("status", "all");
  const [searchText, setSearchText, search] = useUrlSearch();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const branchName = (id: string) => nameOf(branches.find((b) => b.id === id), id);
  const warehouseName = (id: string) => nameOf(warehouses.find((w) => w.id === id), id);
  const accountName = (id: string | null) => (id ? nameOf(accounts.find((a) => a.id === id), id) : t("pos.common.none"));
  const methodName = (id: string) => {
    const method = methods.find((m) => m.id === id);
    return method ? nameOf({ name: method.nameAr, nameEn: method.nameEn }) : id;
  };

  const notReady = terminals.filter((x) => x.active && x.issues.length > 0);
  const filtered = useMemo(() => {
    let rows = terminals;
    if (statusFilter === "active") rows = rows.filter((x) => x.active);
    if (statusFilter === "inactive") rows = rows.filter((x) => !x.active);
    if (statusFilter === "not-ready") rows = rows.filter((x) => x.active && x.issues.length > 0);
    const q = search.trim().toLowerCase();
    if (q !== "") {
      rows = rows.filter((x) =>
        [x.code, x.name, x.nameEn ?? "", nameOf(branches.find((b) => b.id === x.branchId))].some((v) => v.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [terminals, statusFilter, search, branches, nameOf]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  async function toggleActive(terminal: PosTerminalDTO) {
    if (pendingId !== null) return;
    setPendingId(terminal.id);
    setActionError(null);
    try {
      await updateTerminal.mutateAsync({ id: terminal.id, body: bodyFromTerminal(terminal, !terminal.active) });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("pos.common.saveFailed"));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  if (!mayView) return <EmptyState title={t("pos.common.noAccessTitle")} description={t("pos.common.noAccessBody")} />;

  if (firstSegment !== undefined) {
    const editing = firstSegment === "new" ? null : (terminals.find((x) => x.code === firstSegment || x.id === firstSegment) ?? null);
    if (firstSegment !== "new" && !editing) {
      if (terminalsQuery.isLoading) return <p className="p-6 text-sm text-ink-muted">{t("common.loading")}</p>;
      return (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-ink">{t("pos.terminals.notFound")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => subPage.close()}>
            {t("common.back")}
          </Button>
        </Card>
      );
    }
    return (
      <TerminalForm
        key={editing?.id ?? "new"}
        editing={editing}
        mayManage={mayManage}
        methods={methods}
        accounts={accounts}
        onClose={() => subPage.close()}
        onSave={async (body) => {
          const saved = editing
            ? await updateTerminal.mutateAsync({ id: editing.id, body })
            : await createTerminal.mutateAsync(body);
          subPage.open(saved.code);
        }}
      />
    );
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("pos.terminals.chip.all"), count: terminals.length },
    { key: "active", label: t("pos.terminals.chip.active"), count: terminals.filter((x) => x.active).length },
    { key: "inactive", label: t("pos.terminals.chip.inactive"), count: terminals.filter((x) => !x.active).length },
  ];

  const columns: DocumentListColumn<PosTerminalDTO>[] = [
    {
      key: "device",
      header: t("pos.terminals.col.device"),
      render: (x) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink">
            <span className="mz-num">{x.code}</span>
          </div>
          <div className="truncate text-[11.5px] text-ink-muted">{nameOf(x)}</div>
        </div>
      ),
    },
    { key: "kind", header: t("pos.terminals.col.kind"), render: (x) => t(`pos.terminals.kind.${x.kind}` as AppTranslationKey) },
    { key: "branch", header: t("pos.terminals.col.branch"), render: (x) => branchName(x.branchId) },
    { key: "warehouse", header: t("pos.terminals.col.warehouse"), render: (x) => warehouseName(x.warehouseId) },
    { key: "drawer", header: t("pos.terminals.col.drawer"), render: (x) => accountName(x.drawerTreasuryAccountId) },
    { key: "defaultMethod", header: t("pos.terminals.col.defaultMethod"), render: (x) => methodName(x.defaultMethodId) },
    {
      key: "readiness",
      header: t("pos.terminals.col.readiness"),
      render: (x) =>
        x.issues.length === 0 ? (
          <StatusPill label={t("pos.terminals.ready")} tone="success" />
        ) : (
          <StatusPill
            label={t(`pos.terminals.issue.${x.issues[0]}` as AppTranslationKey)}
            tone={x.issues[0] === "inactive" ? "neutral" : x.issues[0] === "setup_broken" ? "danger" : "warning"}
          />
        ),
    },
    {
      key: "status",
      header: t("pos.terminals.col.status"),
      render: (x) => <StatusPill label={x.active ? t("pos.common.active") : t("pos.common.inactive")} tone={x.active ? "success" : "neutral"} />,
    },
  ];

  return (
    <>
      {actionError ? <FormError message={actionError} /> : null}
      <DocumentList<PosTerminalDTO>
        title={t("pos.terminals.title")}
        description={t("pos.terminals.description")}
        actions={
          mayManage ? (
            <Button variant="primary" onClick={() => subPage.open("new")}>
              {t("pos.terminals.add")}
            </Button>
          ) : undefined
        }
        stats={[
          { label: t("pos.terminals.stat.total"), value: <span className="mz-num">{format.number(terminals.length)}</span> },
          { label: t("pos.terminals.stat.active"), value: <span className="mz-num">{format.number(terminals.filter((x) => x.active).length)}</span> },
          { label: t("pos.terminals.stat.inactive"), value: <span className="mz-num">{format.number(terminals.filter((x) => !x.active).length)}</span> },
          { label: t("pos.terminals.stat.ready"), value: <span className="mz-num">{format.number(terminals.filter((x) => x.issues.length === 0).length)}</span> },
        ]}
        attentionBanners={[
          {
            key: "not-ready",
            label: t("pos.terminals.banner.notReady", { count: format.number(notReady.length) }),
            count: notReady.length,
            tone: "warning",
            onApply: () => setStatusFilter("not-ready"),
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(v) => {
          setSearchText(v);
          setPage(1);
        }}
        searchPlaceholder={t("pos.terminals.search")}
        columns={columns}
        rows={pageRows}
        rowKey={(x) => x.id}
        onRowClick={(x) => subPage.open(x.code)}
        rowAction={(x) => {
          const items: RowMenuItem[] = [{ key: "view", label: t("common.edit"), onSelect: () => subPage.open(x.code) }];
          if (mayManage) {
            items.push({
              key: "toggle",
              label: x.active ? t("pos.common.disable") : t("pos.common.enable"),
              tone: x.active ? "danger" : "default",
              disabled: pendingId === x.id,
              ...(x.active ? { confirm: { consequence: t("pos.terminals.disableConsequence"), confirmLabel: t("pos.common.disable") } } : {}),
              onSelect: () => toggleActive(x),
            });
          }
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: x.code })} />;
        }}
        loading={terminalsQuery.isLoading}
        loadFailed={terminalsQuery.isError}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZES}
        emptyState={
          <EmptyState
            title={t("pos.terminals.empty")}
            action={mayManage ? { label: t("pos.terminals.add"), onClick: () => subPage.open("new") } : undefined}
          />
        }
      />
      {terminalsQuery.isError ? (
        <Card className="mt-3 p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{terminalsQuery.error?.message ?? t("pos.common.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => terminalsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
    </>
  );
}

interface TerminalFormProps {
  readonly editing: PosTerminalDTO | null;
  readonly mayManage: boolean;
  readonly methods: readonly PosPaymentMethodDTO[];
  readonly accounts: readonly TreasuryAccountDTO[];
  readonly onClose: () => void;
  readonly onSave: (body: UpdatePosTerminalDTO) => Promise<void>;
}

function TerminalForm({ editing, mayManage, methods, accounts, onClose, onSave }: TerminalFormProps) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const nameOf = useEntityName();
  const branches = useBranches().data ?? EMPTY;
  const warehouses = useWarehouses().data ?? EMPTY;
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftFrom(editing) : blankDraft(branches[0]?.id ?? "")));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = !mayManage;

  const branchId = draft.branchId || branches[0]?.id || "";
  const branchWarehouses = warehouses.filter((w) => w.branchId === branchId && (w.active || w.id === draft.warehouseId));
  const cashDrawers = accounts.filter(
    (a) => a.type === "cash" && a.branchId === branchId && (a.status === "active" || a.id === draft.drawerTreasuryAccountId),
  );
  const visibleMethods = methods.filter((m) => m.active || draft.methods[m.id]?.enabled);
  const enabledMethods = visibleMethods.filter((m) => draft.methods[m.id]?.enabled);

  function setMethod(id: string, patch: Partial<MethodDraft>) {
    setDraft((d) => {
      const current = d.methods[id] ?? { enabled: false, treasuryAccountId: "" };
      const next = { ...d.methods, [id]: { ...current, ...patch } };
      const defaultStillEnabled = next[d.defaultMethodId]?.enabled === true;
      const firstEnabled = Object.entries(next).find(([, m]) => m.enabled)?.[0] ?? "";
      return { ...d, methods: next, defaultMethodId: defaultStillEnabled ? d.defaultMethodId : firstEnabled };
    });
  }

  async function submit() {
    setError(null);
    if (branchId === "") return setError(t("pos.terminals.error.branch"));
    if (draft.warehouseId === "") return setError(t("pos.terminals.error.warehouse"));
    if (draft.drawerTreasuryAccountId === "") return setError(t("pos.terminals.error.drawer"));
    if (enabledMethods.length === 0) return setError(t("pos.terminals.error.methods"));
    if (!draft.methods[draft.defaultMethodId]?.enabled) return setError(t("pos.terminals.error.defaultMethod"));
    setSaving(true);
    try {
      await onSave(bodyFrom({ ...draft, branchId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pos.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const device = editing?.etaDevice ?? null;
  const deviceLine = device
    ? t(device.source === "terminal" ? "pos.terminals.eta.own" : "pos.terminals.eta.fromBranch", { serial: device.serial })
    : t("pos.terminals.eta.none");
  const secretHint = (stored: boolean) => (stored ? t("pos.terminals.field.secretStored") : t("pos.terminals.field.secretMissing"));

  function accountOptions(method: PosPaymentMethodDTO) {
    const eligible = accounts.filter(
      (a) =>
        a.status === "active" &&
        a.id !== draft.drawerTreasuryAccountId &&
        (method.accountType === null || a.type === method.accountType) &&
        (a.type === "bank" || a.branchId === branchId),
    );
    const defaultAccount = accounts.find((a) => a.id === method.defaultTreasuryAccountId);
    return [
      {
        value: "",
        label: defaultAccount
          ? t("pos.terminals.field.methodDefaultAccount", { name: nameOf(defaultAccount) })
          : t("pos.terminals.field.methodNoDefault"),
      },
      ...eligible.map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` })),
    ];
  }

  return (
    <FormPage
      eyebrow={t("pos.terminals.title")}
      title={editing ? t("pos.terminals.editTitle", { code: editing.code }) : t("pos.terminals.new")}
      description={editing ? undefined : t("pos.terminals.newBody")}
      actions={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {mayManage ? (
            <Button variant="primary" onClick={() => void submit()} disabled={saving}>
              {t("common.save")}
            </Button>
          ) : null}
        </>
      }
    >
      <FormError message={error} />
      <FormColumns
        aside={
          <>
            <SectionCard title={t("pos.terminals.section.eta")} description={t("pos.terminals.section.etaHint")} columns={1}>
              {editing ? (
                <div className="flex flex-col gap-[6px]">
                  <StatusPill label={deviceLine} tone={device === null ? "danger" : device.complete ? "success" : "warning"} />
                  {device !== null && !device.complete ? <p className="text-[11.5px] text-ink-muted">{t("pos.terminals.eta.incomplete")}</p> : null}
                </div>
              ) : null}
              <TextField
                label={t("pos.terminals.field.etaSerial")}
                value={draft.etaDeviceSerial}
                disabled={readOnly}
                onChange={(v) => setDraft((d) => ({ ...d, etaDeviceSerial: v }))}
              />
              {draft.etaDeviceSerial.trim() !== "" ? (
                <>
                  <TextField
                    label={t("pos.terminals.field.etaClientId")}
                    value={draft.etaPosClientId}
                    disabled={readOnly}
                    onChange={(v) => setDraft((d) => ({ ...d, etaPosClientId: v }))}
                  />
                  <TextField
                    type="password"
                    autoComplete="new-password"
                    label={t("pos.terminals.field.etaClientSecret")}
                    value={draft.etaPosClientSecret}
                    disabled={readOnly}
                    placeholder={secretHint(editing?.hasEtaPosClientSecret === true && editing.etaDeviceSerial === draft.etaDeviceSerial.trim())}
                    onChange={(v) => setDraft((d) => ({ ...d, etaPosClientSecret: v }))}
                  />
                  <TextField
                    label={t("pos.terminals.field.etaOsVersion")}
                    value={draft.etaPosOsVersion}
                    disabled={readOnly}
                    onChange={(v) => setDraft((d) => ({ ...d, etaPosOsVersion: v }))}
                  />
                  <TextField
                    label={t("pos.terminals.field.etaModelFramework")}
                    value={draft.etaPosModelFramework}
                    disabled={readOnly}
                    onChange={(v) => setDraft((d) => ({ ...d, etaPosModelFramework: v }))}
                  />
                  <TextField
                    type="password"
                    autoComplete="new-password"
                    label={t("pos.terminals.field.etaPresharedKey")}
                    value={draft.etaPosPresharedKey}
                    disabled={readOnly}
                    placeholder={secretHint(editing?.hasEtaPosPresharedKey === true && editing.etaDeviceSerial === draft.etaDeviceSerial.trim())}
                    onChange={(v) => setDraft((d) => ({ ...d, etaPosPresharedKey: v }))}
                  />
                </>
              ) : null}
            </SectionCard>
            {editing ? (
              <SectionCard title={t("pos.terminals.section.counter")} description={t("pos.terminals.counter.hint")} columns={1}>
                <div>
                  <div className="text-[12px] text-ink-muted">{t("pos.terminals.counter.last")}</div>
                  <div className="mz-num text-[20px] font-bold text-ink">{format.number(editing.lastReceiptSeq)}</div>
                </div>
              </SectionCard>
            ) : null}
          </>
        }
      >
        <SectionCard title={t("pos.terminals.section.identity")}>
          <TextField
            label={t("pos.terminals.field.code")}
            value={draft.code}
            placeholder="POS-001"
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, code: v.toUpperCase() }))}
          />
          <SelectField
            label={t("pos.terminals.field.kind")}
            value={draft.kind}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, kind: v as PosTerminalKindDTO }))}
            options={[
              { value: "retail", label: t("pos.terminals.kind.retail") },
              { value: "restaurant", label: t("pos.terminals.kind.restaurant") },
            ]}
          />
          <TextField label={t("pos.terminals.field.name")} value={draft.name} disabled={readOnly} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label={t("pos.terminals.field.nameEn")} value={draft.nameEn} disabled={readOnly} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <ToggleField label={t("pos.terminals.field.active")} checked={draft.active} disabled={readOnly} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
        </SectionCard>

        <SectionCard title={t("pos.terminals.section.placement")}>
          <SelectField
            label={t("pos.terminals.field.branch")}
            value={branchId}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, branchId: v, warehouseId: "", drawerTreasuryAccountId: "" }))}
            options={branches.map((b) => ({ value: b.id, label: nameOf(b) }))}
          />
          <SelectField
            label={t("pos.terminals.field.warehouse")}
            value={draft.warehouseId}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, warehouseId: v }))}
            options={[{ value: "", label: t("pos.terminals.field.choose") }, ...branchWarehouses.map((w) => ({ value: w.id, label: `${w.code} — ${nameOf(w)}` }))]}
          />
          <SelectField
            label={t("pos.terminals.field.drawer")}
            value={draft.drawerTreasuryAccountId}
            disabled={readOnly}
            hint={cashDrawers.length === 0 ? t("pos.terminals.noCashDrawers") : t("pos.terminals.field.drawerHint")}
            onChange={(v) => setDraft((d) => ({ ...d, drawerTreasuryAccountId: v }))}
            options={[{ value: "", label: t("pos.terminals.field.choose") }, ...cashDrawers.map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` }))]}
          />
        </SectionCard>

        <SectionCard title={t("pos.terminals.section.methods")} description={t("pos.terminals.section.methodsHint")} columns={1}>
          <ul className="flex flex-col divide-y divide-border">
            {visibleMethods.map((method) => {
              const entry = draft.methods[method.id] ?? { enabled: false, treasuryAccountId: "" };
              return (
                <li key={method.id} className="flex flex-wrap items-center gap-[12px] py-[10px]">
                  <Switch
                    checked={entry.enabled}
                    disabled={readOnly}
                    label={nameOf({ name: method.nameAr, nameEn: method.nameEn })}
                    onChange={(v) => setMethod(method.id, { enabled: v })}
                  />
                  <div className="min-w-[140px] flex-1">
                    <div className="text-[13px] font-semibold text-ink">{nameOf({ name: method.nameAr, nameEn: method.nameEn })}</div>
                    <div className="text-[11.5px] text-ink-muted">
                      <span className="mz-num">{method.code}</span> · {t(`pos.common.kind.${method.kind}` as AppTranslationKey)}
                    </div>
                  </div>
                  <div className="min-w-[220px] flex-1">
                    {method.kind === "cash" ? (
                      <span className="text-[12px] text-ink-muted">{t("pos.terminals.field.cashAccount")}</span>
                    ) : method.kind === "on_account" ? (
                      <span className="text-[12px] text-ink-muted">{t("pos.terminals.field.onAccount")}</span>
                    ) : entry.enabled ? (
                      <SelectField
                        label={t("pos.terminals.field.methodAccount")}
                        value={entry.treasuryAccountId}
                        disabled={readOnly}
                        onChange={(v) => setMethod(method.id, { treasuryAccountId: v })}
                        options={accountOptions(method)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <SelectField
            label={t("pos.terminals.field.defaultMethod")}
            value={draft.defaultMethodId}
            disabled={readOnly || enabledMethods.length === 0}
            onChange={(v) => setDraft((d) => ({ ...d, defaultMethodId: v }))}
            options={enabledMethods.map((m) => ({ value: m.id, label: nameOf({ name: m.nameAr, nameEn: m.nameEn }) }))}
          />
        </SectionCard>

        <SectionCard title={t("pos.terminals.section.printer")}>
          <SelectField
            label={t("pos.terminals.field.printerKind")}
            value={draft.printerKind}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, printerKind: v as PosPrinterKindDTO }))}
            options={[
              { value: "system", label: t("pos.terminals.field.printerKind.system") },
              { value: "escpos-tcp", label: t("pos.terminals.field.printerKind.escpos-tcp") },
            ]}
          />
          <SelectField
            label={t("pos.terminals.field.paperWidth")}
            value={String(draft.paperWidthMm)}
            disabled={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, paperWidthMm: v === "58" ? 58 : 80 }))}
            options={[
              { value: "80", label: t("pos.terminals.field.paper80") },
              { value: "58", label: t("pos.terminals.field.paper58") },
            ]}
          />
          <TextField
            label={draft.printerKind === "escpos-tcp" ? t("pos.terminals.field.printerAddress") : t("pos.terminals.field.printerAddressSystem")}
            value={draft.printerAddress}
            disabled={readOnly}
            placeholder={draft.printerKind === "escpos-tcp" ? "192.168.1.100:9100" : undefined}
            hint={draft.printerKind === "system" ? t("pos.terminals.field.printerAddressHint") : undefined}
            onChange={(v) => setDraft((d) => ({ ...d, printerAddress: v }))}
          />
        </SectionCard>
      </FormColumns>
    </FormPage>
  );
}
