import { cn } from "../lib/cn";

export interface FulcrumRuleProps {
  className?: string;
}

/**
 * FulcrumRule — the *mizan* signature at its quietest dose (spec §4.1): a
 * hairline divider under a page title carrying a single small brass triangle,
 * the fulcrum the page balances on. Mirrors with the document direction.
 */
export function FulcrumRule({ className }: FulcrumRuleProps) {
  return (
    <div aria-hidden="true" className={cn("relative mb-[20px] mt-[4px] h-px bg-border-strong", className)}>
      <span className="absolute -top-[3px] start-0 h-[7px] w-[34px] rounded-pill bg-gradient-to-r from-accent to-transparent rtl:bg-gradient-to-l" />
      <svg viewBox="0 0 10 9" fill="currentColor" className="absolute -top-[4px] start-[44px] h-[9px] w-[10px] text-accent">
        <path d="M5 0 10 9H0Z" />
      </svg>
    </div>
  );
}
