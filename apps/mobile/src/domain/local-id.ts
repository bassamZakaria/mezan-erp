let counter = 0;

/**
 * A client-side line id — for grouping a draft's own rows in memory, never
 * for anything the server treats as an entity id. Bumping a module-level
 * counter (rather than `Math.random()` alone) keeps two ids created in the
 * same millisecond from colliding.
 */
export function makeLocalId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
