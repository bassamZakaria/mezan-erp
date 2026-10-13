import { useId, useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import { TenantBooksStanding, TenantWireStatus, type TenantBooksDTO, type TenantDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { TextField } from "../settings/form-controls";
import { TenantBooksChip } from "./chips";
import { useConfirmTenantBooksMutation, useDisownTenantBooksMutation, useTenantBooksQuery, useUnbindTenantBooksMutation } from "./hooks";

enum BooksAct {
  Confirm = "confirm",
  Disown = "disown",
  Unbind = "unbind",
}

const EXPLANATION: Partial<Record<TenantBooksStanding, AppTranslationKey>> = {
  [TenantBooksStanding.Unbound]: "platform.books.explain.unbound",
  [TenantBooksStanding.Disowned]: "platform.books.explain.disowned",
  [TenantBooksStanding.Missing]: "platform.books.explain.missing",
  [TenantBooksStanding.Foreign]: "platform.books.explain.foreign",
  [TenantBooksStanding.Unreadable]: "platform.books.explain.unreadable",
};

const CONFIRMABLE: readonly TenantBooksStanding[] = [TenantBooksStanding.Unbound, TenantBooksStanding.Disowned];

function isLive(tenant: TenantDTO): boolean {
  return tenant.status === TenantWireStatus.Active || tenant.status === TenantWireStatus.Suspended;
}

function ConfirmBooksChoice({
  books,
  loading,
  failure,
  chosenId,
  onChoose,
}: {
  books: TenantBooksDTO | undefined;
  loading: boolean;
  failure: string | null;
  chosenId: string | null;
  onChoose: (userId: string) => void;
}) {
  const { t } = useAppTranslation();
  const groupName = useId();
  if (failure !== null) return <p role="alert" className="text-danger-ink">{failure}</p>;
  if (loading || !books) return <p>{t("platform.books.confirm.loading")}</p>;
  return (
    <div className="flex flex-col gap-[10px]">
      <p>
        {t("platform.books.confirm.companyName")}: <span className="break-words font-semibold text-ink">{books.companyName ?? t("platform.books.confirm.noCompanyName")}</span>
      </p>
      {books.admins.length === 0 ? (
        <p className="text-danger-ink">{t("platform.books.confirm.none")}</p>
      ) : (
        <fieldset className="flex min-w-0 flex-col gap-[6px]">
          <legend className="mb-[4px] font-semibold text-ink">{t("platform.books.confirm.pick")}</legend>
          {books.admins.map((admin) => (
            <label key={admin.id} className="flex min-h-[var(--h-btn)] cursor-pointer items-center gap-[8px] rounded-md border border-border bg-surface-2 px-[10px] py-[6px]">
              <input type="radio" name={groupName} checked={chosenId === admin.id} onChange={() => onChoose(admin.id)} />
              <span className="min-w-0">
                <span className="font-semibold text-ink">{admin.nameAr}</span> <span className="mz-lat break-all">{admin.email}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <p>{t("platform.books.confirm.consequence")}</p>
    </div>
  );
}

export function TenantBooksCard({
  tenant,
  standing,
  isOwner,
  onError,
}: {
  tenant: TenantDTO;
  standing: TenantBooksStanding | null;
  isOwner: boolean;
  onError: (err: unknown) => void;
}) {
  const { t } = useAppTranslation();
  const [asking, setAsking] = useState<BooksAct | null>(null);
  const [acting, setActing] = useState<BooksAct | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState("");
  const shown = useTenantBooksQuery(tenant.id, asking === BooksAct.Confirm);
  const confirmBooks = useConfirmTenantBooksMutation();
  const disownBooks = useDisownTenantBooksMutation();
  const unbindBooks = useUnbindTenantBooksMutation();
  if (standing === null || standing === TenantBooksStanding.Provisioning) return null;
  const actionable = isOwner && isLive(tenant);
  const explanation = EXPLANATION[standing];

  const close = () => {
    setAsking(null);
    setChosenId(null);
    setTypedCode("");
  };

  const settle = { onError, onSettled: () => setActing(null) };

  const act = (which: BooksAct) => {
    if (acting !== null) return;
    setActing(which);
    if (which === BooksAct.Confirm && chosenId !== null && shown.data) confirmBooks.mutate({ tenantId: tenant.id, userId: chosenId, companyName: shown.data.companyName }, settle);
    else if (which === BooksAct.Disown) disownBooks.mutate(tenant.id, settle);
    else if (which === BooksAct.Unbind) unbindBooks.mutate({ tenantId: tenant.id, code: typedCode.trim() }, settle);
    else setActing(null);
    close();
  };

  return (
    <div className="mt-[6px]">
      <p className="flex flex-wrap items-center gap-[8px] text-[12.5px] text-ink-muted">
        <TenantBooksChip standing={standing} />
        {actionable && CONFIRMABLE.includes(standing) ? (
          <Button variant="default" size="sm" disabled={acting !== null} onClick={() => setAsking(BooksAct.Confirm)}>
            {t("platform.books.confirm")}
          </Button>
        ) : null}
        {actionable && standing === TenantBooksStanding.Unbound ? (
          <Button variant="ghost" size="sm" disabled={acting !== null} onClick={() => setAsking(BooksAct.Disown)}>
            {t("platform.books.disown")}
          </Button>
        ) : null}
        {actionable && standing === TenantBooksStanding.Bound ? (
          <Button variant="ghost" size="sm" disabled={acting !== null} onClick={() => setAsking(BooksAct.Unbind)}>
            {t("platform.books.unbind")}
          </Button>
        ) : null}
      </p>
      {explanation ? <p className="mt-[4px] max-w-[72ch] text-[12px] text-ink-muted">{t(explanation)}</p> : null}

      <ConfirmDialog
        open={asking === BooksAct.Confirm}
        title={t("platform.books.confirm.title")}
        consequence={
          asking === BooksAct.Confirm ? (
            <ConfirmBooksChoice books={shown.data} loading={shown.isFetching} failure={shown.isError ? shown.error.message : null} chosenId={chosenId} onChoose={setChosenId} />
          ) : null
        }
        confirmLabel={t("platform.books.confirm.confirm")}
        confirmDisabled={chosenId === null || shown.isFetching || !shown.data}
        onConfirm={() => act(BooksAct.Confirm)}
        onCancel={close}
      />
      <ConfirmDialog
        open={asking === BooksAct.Disown}
        title={t("platform.books.disown.title")}
        consequence={t("platform.books.disown.consequence")}
        confirmLabel={t("platform.books.disown.confirm")}
        tone="danger"
        onConfirm={() => act(BooksAct.Disown)}
        onCancel={close}
      />
      <ConfirmDialog
        open={asking === BooksAct.Unbind}
        title={t("platform.books.unbind.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("platform.books.unbind.consequence")}</p>
            <TextField label={t("platform.books.unbind.typeCode")} value={typedCode} onChange={setTypedCode} autoComplete="off" />
          </div>
        }
        confirmLabel={t("platform.books.unbind.confirm")}
        tone="danger"
        confirmDisabled={typedCode.trim() !== tenant.code}
        onConfirm={() => act(BooksAct.Unbind)}
        onCancel={close}
      />
    </div>
  );
}
