/** The balance-beam glyph used across the sidebar brand mark and login screen. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <line x1="24" y1="8" x2="24" y2="34" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="10" y1="15" x2="38" y2="15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="15" r="2.4" fill="currentColor" />
      <path d="M10 15 L4.5 26 A7 7 0 0 0 15.5 26 Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M38 15 L32.5 26 A7 7 0 0 0 43.5 26 Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M16 34 H32 L29 41 H19 Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}
