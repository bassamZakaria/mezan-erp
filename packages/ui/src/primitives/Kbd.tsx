import { cn } from "../lib/cn";

export type KbdTone = "surface" | "chrome";

export interface KbdProps {
  /** `"Ctrl+K"`, `["Ctrl", "K"]` or `"g s"` — `+` splits into separate caps, spaces are kept as a chord. */
  keys: string | readonly string[];
  /** `chrome` for the dark topbar/sidebar surfaces, `surface` for content. */
  tone?: KbdTone;
  className?: string;
}

/** `⌘` on Apple platforms, `Ctrl` elsewhere — the same physical modifier this app listens for. */
export function modKeyLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  const platform = navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/.test(platform) ? "⌘" : "Ctrl";
}

/**
 * Kbd — the hint chip that makes a keyboard shortcut discoverable (spec §7).
 * Always latin-isolated (`mz-lat`) so a shortcut reads left-to-right inside
 * Arabic copy.
 */
export function Kbd({ keys, tone = "surface", className }: KbdProps) {
  const caps = typeof keys === "string" ? keys.split("+") : [...keys];
  return (
    <span className={cn("mz-lat inline-flex flex-none items-center gap-[3px]", className)}>
      {caps.map((cap, index) => (
        <kbd
          key={`${cap}-${index}`}
          className={cn(
            "rounded-sm border px-[6px] py-[1px] font-mono text-2xs leading-[1.5]",
            tone === "chrome"
              ? "border-chrome-border bg-chrome-active text-chrome-ink-muted"
              : "border-border-strong bg-surface-3 text-ink-muted",
          )}
        >
          {cap.trim()}
        </kbd>
      ))}
    </span>
  );
}
