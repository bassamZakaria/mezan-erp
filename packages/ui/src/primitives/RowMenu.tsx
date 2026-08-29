import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { ConfirmDialog, useOptionalToast } from "./feedback";

export interface RowMenuItemConfirm {
  title?: ReactNode;
  /** What the action will actually do — never a bare "are you sure?". */
  consequence: ReactNode;
  confirmLabel?: string;
}

export interface RowMenuItem {
  key: string;
  label: string;
  /**
   * May return a promise. When it does, the menu reports its outcome: the
   * success toast waits for the server rather than firing on the click.
   */
  onSelect: () => void | Promise<unknown>;
  /** `danger` for destructive entries — cancel, void, delete. */
  tone?: "default" | "danger";
  disabled?: boolean;
  /**
   * Ask before running. Implied by `tone: "danger"` — a destructive entry
   * always confirms, and supplying this only replaces the generic wording with
   * something specific to the document.
   */
  confirm?: RowMenuItemConfirm;
  /** Overrides the generic "«action» done" toast. */
  successMessage?: string;
}

export interface RowMenuProps {
  items: readonly RowMenuItem[];
  /** Accessible name, e.g. "إجراءات INV-000001". */
  label: string;
  /**
   * Which edge the panel hangs from. `end` (the default) is right for a row's
   * own overflow, which sits at the row's inline end with the whole row to
   * open back across. A trigger at the inline START — a tab strip's «…» — must
   * use `start`, or the panel opens off the edge of the page and its labels
   * are cut in half.
   */
  align?: "start" | "end";
  className?: string;
}

/**
 * The overflow menu on a list row (docs/archive/reference-parity/REQUIREMENTS.md
 * R1.3). Its contents are the CALLER's job to derive from the row's lifecycle
 * state: a draft transfer offers تأكيد, a converted quote does not offer
 * تعديل, a paid invoice does not offer إلغاء. Passing an empty list renders
 * nothing rather than a menu that opens onto nothing.
 */
export function RowMenu({ items, label, align = "end", className }: RowMenuProps) {
  const { t } = useUiTranslation();
  const toast = useOptionalToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<RowMenuItem | null>(null);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [dropUp, setDropUp] = useState(false);

  /**
   * Flip upward when opening downward would put the menu past the bottom of
   * whatever actually clips it (D56).
   *
   * Measured against the nearest SCROLLING ancestor rather than the viewport:
   * `DocumentList` caps its table at `max-h` with `overflow: auto`, so on the
   * last rows of a long list a downward menu was inside the window and still
   * unreachable — clipped by the table, not by the screen.
   */
  useLayoutEffect(() => {
    if (!open) {
      setDropUp(false);
      return;
    }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    let clipper: HTMLElement | null = trigger.parentElement;
    while (clipper) {
      const { overflowY } = getComputedStyle(clipper);
      if (overflowY === "auto" || overflowY === "scroll") break;
      clipper = clipper.parentElement;
    }
    const bottom = clipper ? clipper.getBoundingClientRect().bottom : window.innerHeight;
    const triggerBox = trigger.getBoundingClientRect();
    const needed = menu.offsetHeight + 4;
    // Only flip if there is room above; a menu taller than both sides stays
    // downward, where at least the first items are reachable.
    setDropUp(triggerBox.bottom + needed > bottom && triggerBox.top - needed > (clipper?.getBoundingClientRect().top ?? 0));
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function run(item: RowMenuItem) {
    try {
      await item.onSelect();
      toast?.show({ tone: "success", message: item.successMessage ?? t("ui.rowAction.done", { action: item.label }) });
    } catch (error) {
      // A failed destructive action must say so: the row simply not changing
      // reads identically to the action having been refused on purpose.
      toast?.show({
        tone: "error",
        message: t("ui.rowAction.failed", { action: item.label }),
        detail: error instanceof Error ? error.message : undefined,
      });
    }
  }

  function select(item: RowMenuItem) {
    setOpen(false);
    if (item.confirm || item.tone === "danger") {
      setPending(item);
      return;
    }
    void run(item);
  }

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className={cn("relative", className)} onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[28px] w-[28px] items-center justify-center rounded-md border border-transparent text-ink-muted transition-colors hover:border-border hover:bg-surface-2 hover:text-ink"
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-[15px] w-[15px]">
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-30 min-w-[190px] overflow-hidden rounded-lg border border-border bg-surface py-[4px] shadow-2",
            align === "start" ? "start-0" : "end-0",
            dropUp ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]",
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => select(item)}
              className={cn(
                "flex w-full items-center px-[12px] py-[8px] text-start text-[12.5px] transition-colors",
                item.disabled
                  ? "cursor-not-allowed text-ink-faint"
                  : item.tone === "danger"
                    ? "text-danger-ink hover:bg-danger-soft"
                    : "text-ink hover:bg-surface-2",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.confirm?.title ?? t("ui.rowAction.confirmTitle", { action: pending?.label ?? "" })}
        consequence={
          pending?.confirm?.consequence ?? t("ui.rowAction.consequence", { action: pending?.label ?? "", row: label })
        }
        confirmLabel={pending?.confirm?.confirmLabel ?? pending?.label ?? ""}
        tone={pending?.tone === "danger" ? "danger" : "default"}
        onConfirm={() => {
          const item = pending;
          setPending(null);
          if (item) void run(item);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
