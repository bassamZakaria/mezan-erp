import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Card, StatusPill, type PillTone } from "./atoms";

/**
 * DocumentDetail — header/status/actions + summary strip + the
 * "تأثيرات هذا المستند" (effects of this document) panel + tabs, with an
 * optional side column for a SidePanel trigger. Matches the `pattern-detail`
 * section of design/mezan-ui-mockups.html.
 */

export interface DocumentDetailSummaryItem {
  label: string;
  value: ReactNode;
  valueTone?: "default" | "success" | "danger";
}

export interface DocumentDetailTab {
  key: string;
  label: string;
  content: ReactNode;
}

export interface DocumentDetailProps {
  title: ReactNode;
  statusLabel?: string;
  statusTone?: PillTone;
  subtitle?: ReactNode;
  actions?: ReactNode;
  summary?: DocumentDetailSummaryItem[];
  /** Content for the "تأثيرات هذا المستند" callout — pass a list of effect descriptions. */
  effectsTitle?: string;
  effects?: ReactNode[];
  tabs?: DocumentDetailTab[];
  activeTabKey?: string;
  onTabChange?: (key: string) => void;
  /** Right-hand column next to the tabs — typically a SidePanel trigger card. */
  aside?: ReactNode;
  className?: string;
}

export function DocumentDetail({
  title,
  statusLabel,
  statusTone = "neutral",
  subtitle,
  actions,
  summary,
  effectsTitle = "تأثيرات هذا المستند",
  effects,
  tabs,
  activeTabKey,
  onTabChange,
  aside,
  className,
}: DocumentDetailProps) {
  const [internalTab, setInternalTab] = useState(tabs?.[0]?.key);
  const currentTab = activeTabKey ?? internalTab;

  function handleTabChange(key: string) {
    if (onTabChange) onTabChange(key);
    else setInternalTab(key);
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-[18px] flex flex-wrap items-start justify-between gap-[18px]">
        <div>
          <div className="flex flex-wrap items-center gap-[11px]">
            <h1 className="font-display text-[21px] font-bold text-ink">{title}</h1>
            {statusLabel ? <StatusPill label={statusLabel} tone={statusTone} /> : null}
          </div>
          {subtitle ? <div className="mt-[7px] text-[12.5px] text-ink-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-[9px]">{actions}</div> : null}
      </div>

      {summary && summary.length > 0 ? (
        <Card className="mb-[18px] grid grid-cols-2 overflow-hidden sm:grid-cols-3 lg:grid-cols-6">
          {summary.map((item, i) => (
            <div key={i} className="border-e border-border p-[15px_17px] last:border-e-0">
              <div className="text-[11px] font-semibold text-ink-faint">{item.label}</div>
              <div
                className={cn(
                  "mt-[6px] text-[15px] font-bold",
                  item.valueTone === "success" && "text-success-ink",
                  item.valueTone === "danger" && "text-danger-ink",
                )}
              >
                {item.value}
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      {effects && effects.length > 0 ? (
        <div
          className="mb-[20px] flex items-start gap-[13px] rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
          style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
        >
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-brand text-accent">
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[19px] w-[19px]">
              <path
                d="M10 2 3 5.5v5c0 4 3 6.6 7 7.5 4-.9 7-3.5 7-7.5v-5L10 2Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="m7.3 10 2 2 3.4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">{effectsTitle}</h3>
            <ul className="flex flex-col gap-[7px]">
              {effects.map((effect, i) => (
                <li key={i} className="flex items-start gap-[8px] text-[12.5px] text-ink">
                  <span aria-hidden className="mt-[8px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                  {effect}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className={cn("grid gap-5", aside ? "lg:grid-cols-[2fr_1fr]" : "grid-cols-1")}>
        <div>
          {tabs && tabs.length > 0 ? (
            <>
              <div role="tablist" className="mb-[18px] flex gap-1 border-b border-border">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={currentTab === tab.key}
                    onClick={() => handleTabChange(tab.key)}
                    className={cn(
                      "-mb-px border-b-2 px-4 py-[11px] text-[13px] font-semibold transition-colors",
                      currentTab === tab.key
                        ? "border-brand text-brand"
                        : "border-transparent text-ink-muted hover:text-ink",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {tabs.map((tab) => (
                <div key={tab.key} role="tabpanel" hidden={currentTab !== tab.key}>
                  {currentTab === tab.key ? tab.content : null}
                </div>
              ))}
            </>
          ) : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </div>
    </div>
  );
}
