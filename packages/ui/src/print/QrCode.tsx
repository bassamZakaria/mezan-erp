import { useMemo } from "react";
import { cn } from "../lib/cn";
import { encodeQr } from "./qr";

/**
 * A QR symbol as inline SVG — the same approach `Barcode128` takes, and for
 * the same reason: it has to survive the print pipeline (browser
 * `window.print()` and Electron `printToPDF` render the same DOM), and
 * @mezan/ui carries no dependencies.
 *
 * Renders nothing when the value cannot be encoded. A blank space on a receipt
 * is a visible fault; a symbol that scans to the wrong thing is not.
 */

export interface QrCodeProps {
  value: string;
  /** Quiet zone in modules. Four is the standard's minimum and scanners rely on it. */
  quietZone?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function QrCode({ value, quietZone = 4, label, className, style }: QrCodeProps) {
  const symbol = useMemo(() => encodeQr(value), [value]);
  if (!symbol) return null;

  const span = symbol.size + quietZone * 2;
  const dark: string[] = [];
  for (let row = 0; row < symbol.size; row += 1) {
    for (let col = 0; col < symbol.size; col += 1) {
      if (symbol.modules[row]?.[col] === 1) dark.push(`M${col + quietZone} ${row + quietZone}h1v1h-1z`);
    }
  }

  return (
    <svg
      role="img"
      aria-label={label ?? value}
      viewBox={`0 0 ${span} ${span}`}
      className={cn("block", className ?? "h-full w-full")}
      style={style}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={span} height={span} fill="#ffffff" />
      <path d={dark.join("")} fill="#000000" />
    </svg>
  );
}
