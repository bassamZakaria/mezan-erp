import { useEffect, useMemo, useRef } from "react";
import type { NavGroup, NavItem } from "@mezan/ui";
import {
  buildModuleJumps,
  emitListNav,
  findDocumentForm,
  findSearchInput,
  isActivatableTarget,
  isHelpKey,
  isTypingTarget,
  latinLetter,
  type ModuleJump,
} from "./shortcuts";

/** How long a pending `g` waits for its second key before it is forgotten. */
const CHORD_TIMEOUT_MS = 1000;

export interface GlobalShortcutsOptions {
  /** The live nav tree — the `g`-chord targets are derived from it. */
  navGroups: readonly NavGroup[];
  topNavItem?: NavItem;
  /** ⌘N — opens the current screen's create flow (App decides the fallback). */
  onCreate: () => void;
  /** `?` — opens the shortcuts cheat sheet. */
  onShowHelp: () => void;
  /** Escape on a sub-page — the keyboard twin of «رجوع» beside the breadcrumb. */
  onBack: () => void;
  /** Suspends every shortcut (the cheat sheet is open, or no session yet). */
  disabled?: boolean;
}

export interface GlobalShortcutsResult {
  moduleJumps: ModuleJump[];
}

/**
 * The app's single global `keydown` listener (spec §7). Registered once, from
 * `App`.
 *
 * The one rule that keeps it out of the user's way: while the event target
 * accepts text, only `Escape` and explicit modifier combos act — bare `/`,
 * `g`, `j`, `k`, `?` are left to the field.
 */
export function useGlobalShortcuts({
  navGroups,
  topNavItem,
  onCreate,
  onShowHelp,
  onBack,
  disabled = false,
}: GlobalShortcutsOptions): GlobalShortcutsResult {
  const moduleJumps = useMemo(() => buildModuleJumps(navGroups, topNavItem), [navGroups, topNavItem]);

  const latest = useRef({ moduleJumps, onCreate, onShowHelp, onBack, disabled });
  latest.current = { moduleJumps, onCreate, onShowHelp, onBack, disabled };

  useEffect(() => {
    let chordArmed = false;
    let chordTimer: number | undefined;

    function disarmChord() {
      chordArmed = false;
      if (chordTimer !== undefined) {
        window.clearTimeout(chordTimer);
        chordTimer = undefined;
      }
    }

    function armChord() {
      chordArmed = true;
      if (chordTimer !== undefined) window.clearTimeout(chordTimer);
      chordTimer = window.setTimeout(disarmChord, CHORD_TIMEOUT_MS);
    }

    function onKeyDown(event: KeyboardEvent) {
      const { moduleJumps: jumps, onCreate: create, onShowHelp: showHelp, disabled: off } = latest.current;
      if (off) return;
      if (event.defaultPrevented) return;

      const mod = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);

      // ── Modifier combos: allowed even while typing ────────────────────────
      if (mod && !event.altKey) {
        const letter = latinLetter(event);
        if (letter === "n" && !event.shiftKey) {
          event.preventDefault();
          disarmChord();
          create();
          return;
        }
        if (letter === "s" || event.key === "Enter") {
          // Always prevented, so the browser's Save-page dialog can never
          // appear over the app; the submit only happens when a real form is
          // on screen.
          event.preventDefault();
          disarmChord();
          findDocumentForm()?.requestSubmit();
          return;
        }
        return;
      }

      if (event.key === "Escape") {
        disarmChord();
        // Panels and dialogs close themselves; `/` is undone here so the
        // focus it stole can be given back without reaching for the mouse.
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.dataset.mzSearchFocused === "true") {
          delete active.dataset.mzSearchFocused;
          active.blur();
          return;
        }
        // A sub-page is a place, not a layer, so Escape leaves it the way
        // «رجوع» does. Anything layered ON TOP owns Escape first — every
        // overlay in this product carries one of these three roles — and a
        // field being typed in keeps it for its own undo.
        if (typing) return;
        if (document.querySelector('[role="dialog"],[role="listbox"],[role="menu"]')) return;
        latest.current.onBack();
        return;
      }

      if (event.altKey || typing) {
        if (typing) disarmChord();
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        disarmChord();
        const input = findSearchInput();
        if (input) {
          input.dataset.mzSearchFocused = "true";
          input.focus();
          input.select();
        }
        return;
      }

      if (isHelpKey(event)) {
        event.preventDefault();
        disarmChord();
        showHelp();
        return;
      }

      const letter = latinLetter(event);

      if (chordArmed) {
        disarmChord();
        if (!letter) return;
        const jump = jumps.find((candidate) => candidate.letter === letter);
        if (jump) {
          event.preventDefault();
          jump.go();
        }
        return;
      }

      if (letter === "g") {
        event.preventDefault();
        armChord();
        return;
      }

      if (letter === "j" || letter === "k") {
        event.preventDefault();
        emitListNav(letter === "j" ? "next" : "prev");
        return;
      }

      if (event.key === "Enter" && !isActivatableTarget(event.target)) {
        emitListNav("open");
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      disarmChord();
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return { moduleJumps };
}
