import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DocumentList, SidePanel, StatusPill, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { CreatePlatformUserRequestDTO, PlatformRoleDTO, PlatformUserDTO, PlatformUserStatusDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";

const OPERATORS_QUERY_KEY = ["platform", "operators"] as const;

const ROLE_KEY: Record<PlatformRoleDTO, AppTranslationKey> = {
  owner: "platform.operators.role.owner",
  support: "platform.operators.role.support",
};
const STATUS_KEY: Record<PlatformUserStatusDTO, AppTranslationKey> = {
  active: "common.active",
  inactive: "common.inactive",
};
const STATUS_TONE: Record<PlatformUserStatusDTO, PillTone> = { active: "success", inactive: "neutral" };

function useOperatorsQuery() {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<PlatformUserDTO[], PlatformApiError>({
    queryKey: OPERATORS_QUERY_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/users");
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.operators.loadFailed"));
      return res.json<PlatformUserDTO[]>();
    },
  });
}

function useCreateOperator() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<PlatformUserDTO, PlatformApiError, CreatePlatformUserRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/users", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.operators.form.saveFailed"));
      }
      return res.json<PlatformUserDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: OPERATORS_QUERY_KEY });
    },
  });
}

function useDeactivateOperator() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<PlatformUserDTO, PlatformApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/users/${encodeURIComponent(id)}/deactivate`, { method: "POST" });
      if (!res.ok) {
        throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.operators.deactivateFailed"));
      }
      return res.json<PlatformUserDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: OPERATORS_QUERY_KEY });
    },
  });
}

interface Draft {
  email: string;
  password: string;
  role: PlatformRoleDTO;
}

function blankDraft(): Draft {
  return { email: "", password: "", role: "support" };
}

export function OperatorsPage() {
  const { t } = useAppTranslation();
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";
  const query = useOperatorsQuery();
  const createOperator = useCreateOperator();
  const deactivateOperator = useDeactivateOperator();

  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const operators = query.data ?? [];

  function openCreate() {
    setDraft(blankDraft());
    setFormError(null);
    setPanelOpen(true);
  }

  /** Clears the password draft on both a successful create and a dismissed panel — it must never linger in memory once the form is done with it. */
  function closePanel() {
    setPanelOpen(false);
    setDraft(blankDraft());
  }

  async function handleSave() {
    setFormError(null);
    if (draft.email.trim() === "" || draft.password.length < 12) {
      setFormError(t("platform.operators.form.saveFailed"));
      return;
    }
    try {
      await createOperator.mutateAsync({ email: draft.email.trim().toLowerCase(), password: draft.password, role: draft.role });
      closePanel();
    } catch (err) {
      setFormError(err instanceof PlatformApiError ? err.message : t("platform.operators.form.saveFailed"));
    }
  }

  async function handleDeactivate(user: PlatformUserDTO) {
    if (deactivatingId) return;
    setDeactivatingId(user.id);
    setRowError(null);
    try {
      await deactivateOperator.mutateAsync(user.id);
    } catch (err) {
      setRowError(err instanceof PlatformApiError ? err.message : t("platform.operators.deactivateFailed"));
    } finally {
      setDeactivatingId(null);
    }
  }

  const columns: DocumentListColumn<PlatformUserDTO>[] = [
    { key: "email", header: t("platform.operators.col.email"), render: (row) => <span className="mz-lat text-ink">{row.email}</span> },
    {
      key: "role",
      header: t("platform.operators.col.role"),
      render: (row) => <StatusPill label={t(ROLE_KEY[row.role])} tone={row.role === "owner" ? "info" : "neutral"} />,
    },
    {
      key: "status",
      header: t("platform.operators.col.status"),
      render: (row) => <StatusPill label={t(STATUS_KEY[row.status])} tone={STATUS_TONE[row.status]} />,
    },
    { key: "createdAt", header: t("platform.operators.col.createdAt"), render: (row) => row.createdAt.slice(0, 10).split("-").reverse().join("/") },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) =>
        isOwner && row.status === "active" ? (
          <Button
            size="sm"
            variant="danger-outline"
            disabled={deactivatingId === row.id}
            onClick={(e) => {
              e.stopPropagation();
              void handleDeactivate(row);
            }}
          >
            {deactivatingId === row.id ? t("platform.operators.deactivating") : t("platform.operators.deactivate")}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <DocumentList<PlatformUserDTO>
        title={t("platform.operators.title")}
        description={t("platform.operators.description")}
        actions={isOwner ? <Button variant="primary" onClick={openCreate}>{t("platform.operators.new")}</Button> : undefined}
        columns={columns}
        rows={operators}
        rowKey={(row) => row.id}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{operators.length}</span></>}
        loading={query.isLoading}
        loadFailed={query.isError}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("platform.operators.empty")}</div>}
        filterBarExtra={
          rowError ? (
            <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[7px] text-[12px] text-danger-ink">{rowError}</div>
          ) : undefined
        }
      />

      <SidePanel open={panelOpen} onClose={closePanel} title={t("platform.operators.form.title")}>
        <div className="flex flex-col gap-[16px]">
          {formError ? (
            <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField
            label={t("platform.operators.form.email")}
            type="email"
            value={draft.email}
            onChange={(v) => setDraft((d) => ({ ...d, email: v }))}
          />
          <TextField
            label={t("platform.operators.form.password")}
            type="password"
            autoComplete="new-password"
            value={draft.password}
            onChange={(v) => setDraft((d) => ({ ...d, password: v }))}
          />
          <SelectField
            label={t("platform.operators.form.role")}
            value={draft.role}
            onChange={(v) => setDraft((d) => ({ ...d, role: v as PlatformRoleDTO }))}
            options={[
              { value: "support", label: t("platform.operators.role.support") },
              { value: "owner", label: t("platform.operators.role.owner") },
            ]}
          />

          <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
            <Button variant="ghost" onClick={closePanel}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={createOperator.isPending} onClick={() => void handleSave()}>
              {createOperator.isPending ? t("platform.operators.form.saving") : t("platform.operators.form.save")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
