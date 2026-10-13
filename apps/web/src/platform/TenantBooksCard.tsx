import { useId, useState } from "react";
import { Button, ConfirmDialog } from "@mezan/ui";
import { TenantBooksStanding, TenantWireStatus, type TenantDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { TextField } from "../settings/form-controls";
import { TENANT_BOOKS_NEEDING_NO_WORD, TenantBooksChip } from "./chips";
import { useConfirmTenantBooksMutation, useDisownTenantBooksMutation, useTenantBooksQuery, useUnbindTenantBooksMutation } from "./hooks";

enum BooksAct {
  Confirm = "confirm",
  Disown = "disown",
  Unbind = "unbind",
}

const EXPLANATION: Partial<Record<TenantBooksStanding, AppTranslationKey>> = {
  [TenantBooksStanding.WillBind]: "platform.books.explain.willBind",
  [TenantBooksStanding.Unconfirmed]: "platform.books.explain.unconfirmed",
  [TenantBooksStanding.Disowned]: "platform.books.explain.disowned",
  [TenantBooksStanding.Missing]: "platform.books.explain.missing",
  [TenantBooksStanding.Foreign]: "platform.books.explain.foreign",
  [TenantBooksStanding.Unreadable]: "platform.books.explain.unreadable",
};

const CONFIRMABLE: readonly TenantBooksStanding[] = [TenantBooksStanding.Unconfirmed, TenantBooksStanding.Disowned];

function isLive(tenant: TenantDTO): boolean {
  return tenant.status === TenantWireStatus.Active || tenant.status === TenantWireStatus.Suspended;
}

function ConfirmBooksChoice({ tenantId, chosenId, onChoose }: { tenantId: string; chosenId: string | null; onChoose: (userId: string) => void }) {
  const { t } = useAppTranslation();
  const groupName = useId();
  const books = useTenantBooksQuery(tenantId, true);
  if (books.isPending) return <p>{t("platform.books.confirm.loading")}</p>;
  if (books.isError) return <p role="alert" className="text-danger-ink">{books.error.message}</p>;
  return (
    <div className="flex flex-col gap-[10px]">
      <p>
        {t("platform.books.confirm.companyName")}: <span className="break-words font-semibold text-ink">{books.data.companyName ?? t("platform.books.confirm.noCompanyName")}</span>
      </p>
      {books.data.admins.length === 0 ? (
        <p className="text-danger-ink">{t("platform.books.confirm.none")}</p>
      ) : (
        <fieldset className="flex flex-col gap-[6px]">
          <legend className="mb-[4px] font-semibold text-ink">{t("platform.books.confirm.pick")}</legend>
          {books.data.admins.map((admin) => (
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
  const confirmBooks = useConfirmTenantBooksMutation();
  const disownBooks = useDisownTenantBooksMutation();
  const unbindBooks = useUnbindTenantBooksMutation();
  if (standing === null) return null;
  const actionable = isOwner && isLive(tenant);
  const explanation = EXPLANATION[standing];
  const canUnbind = actionable && standing === TenantBooksStanding.Bound;
  if (TENANT_BOOKS_NEEDING_NO_WORD.includes(standing) && !canUnbind) return null;

  const close = () => {
    setAsking(null);
    setChosenId(null);
    setTypedCode("");
  };

  const settle = { onError, onSettled: () => setActing(null) };

  const act = (which: BooksAct) => {
    if (acting !== null) return;
    setActing(which);
    if (which === BooksAct.Confirm && chosenId !== null) confirmBooks.mutate({ tenantId: tenant.id, userId: chosenId }, settle);
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
        {actionable && standing === TenantBooksStanding.Unconfirmed ? (
          <Button variant="ghost" size="sm" disabled={acting !== null} onClick={() => setAsking(BooksAct.Disown)}>
            {t("platform.books.disown")}
          </Button>
        ) : null}
        {canUnbind ? (
          <Button variant="ghost" size="sm" disabled={acting !== null} onClick={() => setAsking(BooksAct.Unbind)}>
            {t("platform.books.unbind")}
          </Button>
        ) : null}
      </p>
      {explanation ? <p className="mt-[4px] max-w-[72ch] text-[12px] text-ink-muted">{t(explanation)}</p> : null}

      <ConfirmDialog
        open={asking === BooksAct.Confirm}
        title={t("platform.books.confirm.title")}
        consequence={asking === BooksAct.Confirm ? <ConfirmBooksChoice tenantId={tenant.id} chosenId={chosenId} onChoose={setChosenId} /> : null}
        confirmLabel={t("platform.books.confirm.confirm")}
        confirmDisabled={chosenId === null}
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
