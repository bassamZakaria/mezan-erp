import { cn } from "../lib/cn";

/**
 * The chevron on anything that opens and closes — nav groups, tree rows,
 * permission modules. Points down when open and toward the inline end when
 * collapsed, so it mirrors with `dir` instead of always pointing right.
 */
export function DisclosureChevron({ collapsed, className }: DisclosureChevronProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      fill="none"
      data-collapsed={collapsed ? "true" : "false"}
      className={cn("mz-disclosure-chevron flex-none", className)}
    >
      <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface DisclosureChevronProps {
  readonly collapsed: boolean;
  readonly className?: string;
}
