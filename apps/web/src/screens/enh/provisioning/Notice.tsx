export enum NoticeTone {
  Success = "success",
  Danger = "danger",
}

export interface NoticeState {
  readonly tone: NoticeTone;
  readonly message: string;
}

const NOTICE_CLASS: Readonly<Record<NoticeTone, string>> = {
  [NoticeTone.Success]: "rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink",
  [NoticeTone.Danger]: "rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink",
};

enum NoticeRole {
  Status = "status",
  Alert = "alert",
}

const NOTICE_ROLE: Readonly<Record<NoticeTone, NoticeRole>> = {
  [NoticeTone.Success]: NoticeRole.Status,
  [NoticeTone.Danger]: NoticeRole.Alert,
};

export function Notice({ notice }: { readonly notice: NoticeState | null }) {
  if (!notice) return null;
  return (
    <p role={NOTICE_ROLE[notice.tone]} className={NOTICE_CLASS[notice.tone]}>
      {notice.message}
    </p>
  );
}
