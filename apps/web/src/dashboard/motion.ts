import { useEffect, useState, type CSSProperties } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Live `prefers-reduced-motion`. The dashboard reads it in JS (not only in CSS)
 * because the balance beam must render ALREADY SETTLED on the very first paint
 * for those users — a CSS-only guard would still start it level and jump.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Page-load stagger (spec §8): header, KPI strip, then panels fade-rise ~6px
 * about 40ms apart — once, on mount, never looping. Under reduced motion no
 * animation is emitted at all.
 */
export function riseStyle(step: number, reduced: boolean): CSSProperties {
  if (reduced) return {};
  return { animation: `mz-fade-in 380ms cubic-bezier(.2,.75,.3,1) ${step * 40}ms both` };
}
