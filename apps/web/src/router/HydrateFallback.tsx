/**
 * What fills the window while the router resolves the FIRST route's module.
 *
 * Only ever on screen during the initial load — every later navigation keeps
 * the current screen up until the next chunk arrives. Without it React Router
 * warns and renders nothing, so a cold load on a slow disk showed a blank
 * white window with no indication the app was starting.
 *
 * Deliberately not the app skeleton: at this point the shell itself has not
 * been decided, so drawing a nav rail that may be replaced a frame later reads
 * as a flicker. The brand mark alone is honest about what is known.
 */
export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-bg" role="status" aria-busy="true">
      <span className="text-[15px] font-bold tracking-wide text-brand">ميزان</span>
    </div>
  );
}
