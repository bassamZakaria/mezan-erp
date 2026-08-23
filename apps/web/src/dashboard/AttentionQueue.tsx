import type { ReactNode } from "react";
import { Button } from "@mezan/ui";

/**
 * يحتاج متابعة — the "needs attention" column (spec §6). Work, not numbers:
 * every row states a real, live backlog figure and carries the one action that
 * opens the screen where it gets cleared.
 */

export type AttentionKind = "overdue" | "dueSoon" | "tax" | "stock" | "payables";
export type AttentionTone = "danger" | "warning" | "info" | "clear";

const toneClass: Record<AttentionTone, string> = {
  danger: "bg-danger-soft text-danger-ink",
  warning: "bg-warning-soft text-warning-ink",
  info: "bg-info-soft text-info-ink",
  clear: "bg-success-soft text-success-ink",
};

function Glyph({ kind }: { kind: AttentionKind }) {
  switch (kind) {
    case "overdue":
      return (
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden>
          <path d="M10 3 2.5 17h15L10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M10 8.5v3.2M10 14.3v.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "dueSoon":
      return (
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden>
          <circle cx="10" cy="10" r="6.8" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 6.4V10l2.4 1.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "tax":
      return (
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden>
          <rect x="3" y="4.5" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8.6h14M6.5 12.4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "stock":
      return (
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden>
          <path d="M3.5 6.6 10 3l6.5 3.6v6.8L10 17l-6.5-3.6V6.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M3.5 6.6 10 10.3l6.5-3.7M10 10.3V17" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "payables":
      return (
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden>
          <ellipse cx="10" cy="5.6" rx="6.2" ry="2.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.8 5.6v8.8c0 1.4 2.8 2.6 6.2 2.6s6.2-1.2 6.2-2.6V5.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.8 10c0 1.4 2.8 2.6 6.2 2.6S16.2 11.4 16.2 10" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
  }
}

export interface AttentionItem {
  readonly key: string;
  readonly kind: AttentionKind;
  readonly tone: AttentionTone;
  readonly title: string;
  readonly detail: ReactNode;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly primary?: boolean;
}

export function AttentionQueue({ items }: { items: readonly AttentionItem[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item, index) => (
        <li
          key={item.key}
          className={`flex items-center gap-[11px] py-[11px] ${index > 0 ? "border-t border-border" : ""}`}
        >
          <span className={`grid h-[30px] w-[30px] flex-none place-items-center rounded-md ${toneClass[item.tone]}`}>
            <Glyph kind={item.kind} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{item.title}</div>
            <div className="mt-[1px] truncate text-2xs text-ink-faint">{item.detail}</div>
          </div>
          <Button size="sm" variant={item.primary ? "primary" : "default"} onClick={item.onAction}>
            {item.actionLabel}
          </Button>
        </li>
      ))}
    </ul>
  );
}
