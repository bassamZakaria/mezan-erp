import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { Button } from "./atoms";
import { useFocusTrap } from "../hooks/useFocusTrap";

/* ------------------------------------------------------------------ */
/* Toast                                                                */
/* ------------------------------------------------------------------ */

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastUndoAction {
  label?: string;
  onUndo: () => void;
}

export interface ToastInput {
  id?: string;
  tone: ToastTone;
  message: string;
  detail?: string;
  undo?: ToastUndoAction;
  duration?: number;
}

interface ToastRecord {
  id: string;
  tone: ToastTone;
  message: string;
  detail?: string;
  undo?: ToastUndoAction;
  duration: number | null;
}

export interface ToastContextValue {
  show: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_TOAST_DURATION = 6000;
const MIN_UNDO_DURATION = 8000;

/** error/warning never auto-dismiss; an undo action always gets at least 8s to be seen. */
function resolveToastDuration(toast: ToastInput): number | null {
  if (toast.tone === "error" || toast.tone === "warning") return null;
  const base = toast.duration ?? DEFAULT_TOAST_DURATION;
  return toast.undo ? Math.max(base, MIN_UNDO_DURATION) : base;
}

let toastSeq = 0;
function nextToastId(): string {
  toastSeq += 1;
  return `toast-${toastSeq}`;
}

const toastToneClass: Record<ToastTone, string> = {
  success: "border-success bg-success-soft text-success-ink",
  error: "border-danger bg-danger-soft text-danger-ink",
  warning: "border-warning bg-warning-soft text-warning-ink",
  info: "border-info bg-info-soft text-info-ink",
};

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === "success") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6.2 10.3 8.8 13l5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "error") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 6.5v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  if (tone === "warning") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
        <path d="M10 3.2 17.5 16.5H2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M10 8.4v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="6.8" r="0.9" fill="currentColor" />
      <path d="M10 9.6v4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const { t } = useUiTranslation();
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : undefined}
      className={cn(
        "pointer-events-auto flex items-start gap-[10px] rounded-lg border p-[12px_14px] shadow-2",
        toastToneClass[toast.tone],
      )}
    >
      <span aria-hidden="true" className="mt-[2px] flex-none">
        <ToastIcon tone={toast.tone} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{toast.message}</p>
        {toast.detail ? <p className="mt-[2px] text-[12px] opacity-90">{toast.detail}</p> : null}
        {toast.undo ? (
          <button
            type="button"
            onClick={() => {
              toast.undo?.onUndo();
              onDismiss(toast.id);
            }}
            className="mt-[6px] text-[12px] font-semibold underline underline-offset-2"
          >
            {toast.undo.label ?? t("ui.feedback.undo")}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={t("ui.feedback.dismiss")}
        onClick={() => onDismiss(toast.id)}
        className="flex h-11 w-11 flex-none items-center justify-center rounded-md transition-opacity hover:opacity-70"
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
          <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export interface ToastProviderProps {
  children: ReactNode;
}

/** Owns the toast stack + timers; mount once near the app root, above the shell. */
export function ToastProvider({ children }: ToastProviderProps) {
  const { t } = useUiTranslation();
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    },
    [clearTimer],
  );

  const scheduleAutoDismiss = useCallback(
    (id: string, duration: number | null) => {
      clearTimer(id);
      if (duration === null) return;
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    },
    [clearTimer, dismiss],
  );

  const show = useCallback(
    (toast: ToastInput) => {
      const id = toast.id ?? nextToastId();
      const duration = resolveToastDuration(toast);
      const record: ToastRecord = {
        id,
        tone: toast.tone,
        message: toast.message,
        detail: toast.detail,
        undo: toast.undo,
        duration,
      };
      setToasts((prev) => {
        const exists = prev.some((item) => item.id === id);
        return exists ? prev.map((item) => (item.id === id ? record : item)) : [...prev, record];
      });
      scheduleAutoDismiss(id, duration);
      return id;
    },
    [scheduleAutoDismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-live="polite"
        aria-label={t("ui.feedback.region")}
        className="fixed bottom-[16px] end-[16px] z-[100] flex w-[360px] max-w-[92vw] flex-col gap-[10px]"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/**
 * The provider-tolerant form, for primitives inside this package. A shared
 * component cannot assume the host mounted a `ToastProvider` — RowMenu renders
 * in unit tests and in the desktop print preview, neither of which has one —
 * and throwing there would break a list rather than lose a message.
 */
export function useOptionalToast(): ToastContextValue | null {
  return useContext(ToastContext);
}

/* ------------------------------------------------------------------ */
/* ConfirmDialog                                                        */
/* ------------------------------------------------------------------ */

export type ConfirmDialogTone = "danger" | "default";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** What the action will actually do — never a bare "are you sure?". */
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  /** Disables the confirm button — e.g. a required reason field embedded in `consequence` that is still empty. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  cancelLabel,
  tone = "default",
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useUiTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // A destructive action must never land on the confirm button by default.
      const target = tone === "danger" ? cancelRef.current : confirmRef.current;
      target?.focus();
      return;
    }
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [open, tone]);

  useFocusTrap({ active: open, containerRef: dialogRef, onEscape: onCancel, preventEscapeDefault: true });

  if (!open) return null;

  return (
    <>
      <div aria-hidden="true" onClick={onCancel} className="fixed inset-0 z-[90] bg-scrim backdrop-blur-[2px]" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 z-[91] flex items-center justify-center px-4"
      >
        <div className="w-[420px] max-w-full rounded-lg border border-border bg-surface p-[22px] shadow-2">
          <h2 id={titleId} className="text-[15.5px] font-bold text-ink">
            {title}
          </h2>
          {/* A `div`, not a `p`: `consequence` is free-form and some callers embed
              a form field (e.g. a reversal's date picker, D270) inside it — a
              `<p>` cannot legally contain block content. */}
          <div className="mt-[8px] text-[13px] text-ink-muted">{consequence}</div>
          <div className="mt-[20px] flex items-center justify-end gap-[10px]">
            <Button ref={cancelRef} variant="default" onClick={onCancel}>
              {cancelLabel ?? t("ui.confirm.cancel")}
            </Button>
            <Button ref={confirmRef} variant={tone === "danger" ? "danger-outline" : "primary"} disabled={confirmDisabled} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

export interface SkeletonProps {
  lines?: number;
  className?: string;
}

/** Animates via Tailwind's `animate-pulse`; tokens.css already zeroes animation-duration under prefers-reduced-motion. */
export function Skeleton({ lines = 3, className }: SkeletonProps) {
  const { t } = useUiTranslation();
  return (
    <div className={cn("flex flex-col gap-[8px]", className)}>
      <span role="status" aria-live="polite" className="sr-only">
        {t("ui.loading")}
      </span>
      <div aria-hidden="true" className="flex flex-col gap-[8px]">
        {Array.from({ length: Math.max(lines, 1) }).map((_, index) => (
          <div
            key={index}
            className={cn("h-[13px] animate-pulse rounded-sm bg-surface-3", index === lines - 1 ? "w-[60%]" : "w-full")}
          />
        ))}
      </div>
    </div>
  );
}

export interface SkeletonTableProps {
  rows?: number;
  columns?: number;
}

export function SkeletonTable({ rows = 5, columns = 4 }: SkeletonTableProps) {
  const { t } = useUiTranslation();
  const rowCount = Math.max(rows, 1);
  const columnCount = Math.max(columns, 1);
  return (
    <div className="w-full">
      <span role="status" aria-live="polite" className="sr-only">
        {t("ui.loading")}
      </span>
      <div aria-hidden="true" className="flex flex-col gap-[10px]">
        <div className="flex gap-[14px]">
          {Array.from({ length: columnCount }).map((_, col) => (
            <div key={col} className="h-[11px] flex-1 animate-pulse rounded-sm bg-surface-3" />
          ))}
        </div>
        {Array.from({ length: rowCount }).map((_, row) => (
          <div key={row} className="flex gap-[14px]">
            {Array.from({ length: columnCount }).map((_, col) => (
              <div key={col} className="h-[13px] flex-1 animate-pulse rounded-sm bg-surface-2" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
