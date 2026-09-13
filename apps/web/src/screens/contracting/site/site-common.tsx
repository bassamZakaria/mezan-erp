import type { ReactNode } from "react";
import { Card } from "@mezan/ui";

/** The table chrome the site documents' line grids share, so four screens draw one table. */
export function LinesTable({ headers, children }: { headers: readonly { key: string; label: string; align?: "start" | "end" }[]; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] border-collapse text-[13px]">
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h.key}
                  scope="col"
                  className={`border-b border-border bg-surface-2 px-[12px] py-[10px] text-[11px] font-bold uppercase text-ink-muted ${h.align === "end" ? "text-end" : "text-start"}`}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Card>
  );
}

/** Formats an exact decimal string for display without ever turning it into a float. */
export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}
