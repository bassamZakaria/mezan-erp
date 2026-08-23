import { useEffect, useRef } from "react";
import { IconButton, Kbd, modKeyLabel } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import type { ModuleJump } from "./shortcuts";

export interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  moduleJumps: readonly ModuleJump[];
}

/**
 * The cheat sheet behind `?` — the one place the whole keymap, including the
 * `g`-chord letters derived from the live nav tree, is written down (spec §7:
 * "discoverable, not folklore").
 */
export function ShortcutsOverlay({ open, onClose, moduleJumps }: ShortcutsOverlayProps) {
  const { t } = useAppTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const mod = modKeyLabel();

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const rows: { keys: string; label: string }[] = [
    { keys: `${mod}+K`, label: t("shortcuts.command") },
    { keys: `${mod}+N`, label: t("shortcuts.create") },
    { keys: `${mod}+S`, label: t("shortcuts.save") },
    { keys: "/", label: t("shortcuts.search") },
    { keys: "J+K", label: t("shortcuts.rows") },
    { keys: "Esc", label: t("shortcuts.escape") },
    { keys: "?", label: t("shortcuts.help") },
  ];

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcuts.title")}
        className="fixed inset-0 z-[71] flex items-start justify-center overflow-y-auto p-[24px]"
      >
        <div className="mt-[6vh] w-full max-w-[620px] animate-[mz-fade-in_160ms_ease_both] rounded-lg border border-border bg-surface shadow-2">
          <div className="flex items-start justify-between gap-[10px] border-b border-border px-[21px] py-[17px]">
            <div>
              <h2 className="text-[15.5px] font-bold text-ink">{t("shortcuts.title")}</h2>
              <p className="mt-1 text-[12px] text-ink-muted">{t("shortcuts.subtitle")}</p>
            </div>
            <IconButton ref={closeRef} aria-label={t("shortcuts.close")} onClick={onClose}>
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[16px] w-[16px]">
                <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </IconButton>
          </div>

          <div className="grid gap-[20px] px-[21px] py-[19px] sm:grid-cols-2">
            <div>
              <div className="mz-eyebrow pb-[8px] text-ink-faint">{t("shortcuts.group.global")}</div>
              <ul className="flex flex-col gap-[8px]">
                {rows.map((row) => (
                  <li key={row.keys} className="flex items-center justify-between gap-[10px] text-[13px] text-ink">
                    <span>{row.label}</span>
                    <Kbd keys={row.keys} />
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="mz-eyebrow pb-[8px] text-ink-faint">{t("shortcuts.group.modules")}</div>
              <p className="pb-[8px] text-[12px] text-ink-muted">{t("shortcuts.modulesHint")}</p>
              <ul className="flex max-h-[42vh] flex-col gap-[6px] overflow-y-auto">
                {moduleJumps.map((jump) => (
                  <li key={jump.letter} className="flex items-center justify-between gap-[10px] text-[13px] text-ink">
                    <span className="truncate">{jump.label}</span>
                    <Kbd keys={["g", jump.letter]} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
