import { useMemo } from "react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/cn";

/**
 * Code 128 (subset B) barcode, rendered as inline SVG.
 *
 * A printed label is only worth printing if the scanner at the till can read
 * it, so the barcode has to be a real symbol, not a picture of one. The
 * symbology is small enough to encode here — start B, one pattern per
 * character, modulo-103 check symbol, stop pattern — which keeps @mezan/ui
 * dependency-free and keeps the barcode inside the same DOM the print
 * pipeline already renders (no canvas, no image, no external library).
 *
 * The SVG has no intrinsic size: it stretches to its container with
 * `preserveAspectRatio="none"`, so the caller's label geometry (millimetres,
 * from the label layout) decides how wide and tall the symbol prints.
 */

/** Element widths (bar, space, bar, ...) for symbol values 0-106. Index 106 is the 7-element stop. */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const START_B = 104;
const STOP = 106;
/** Leading/trailing quiet zone, in modules — 10 is the symbology's minimum. */
const QUIET_ZONE = 10;

interface Bar {
  readonly x: number;
  readonly width: number;
}

interface Symbol128 {
  readonly bars: readonly Bar[];
  readonly totalModules: number;
}

/** Null when the value carries a character subset B cannot encode (or is empty). */
export function encodeCode128B(value: string): Symbol128 | null {
  if (value.length === 0) return null;
  const values: number[] = [START_B];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code > 126) return null;
    values.push(code - 32);
  }
  let checksum = START_B;
  for (let i = 1; i < values.length; i += 1) checksum += (values[i] as number) * i;
  values.push(checksum % 103, STOP);

  const bars: Bar[] = [];
  let x = QUIET_ZONE;
  for (const symbol of values) {
    const pattern = PATTERNS[symbol] as string;
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }
  return { bars, totalModules: x + QUIET_ZONE };
}

export interface Barcode128Props {
  value: string;
  /** Bar height inside the SVG's own coordinate space; the element still scales to its box. */
  heightModules?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Barcode128({ value, heightModules = 40, className, style }: Barcode128Props) {
  const { t } = useTranslation();
  const symbol = useMemo(() => encodeCode128B(value), [value]);
  if (!symbol) return null;

  return (
    <svg
      role="img"
      aria-label={t("print.barcode.label", { value })}
      viewBox={`0 0 ${symbol.totalModules} ${heightModules}`}
      preserveAspectRatio="none"
      className={cn("block h-full w-full", className)}
      style={style}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={symbol.totalModules} height={heightModules} fill="#ffffff" />
      {symbol.bars.map((bar, i) => (
        <rect key={i} x={bar.x} y={0} width={bar.width} height={heightModules} fill="#000000" />
      ))}
    </svg>
  );
}
