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

const RANDOM_HALF = 8;

function randomHalf(): string {
  return Math.random().toString(36).slice(2, 2 + RANDOM_HALF).padEnd(RANDOM_HALF, "0");
}

/**
 * The id of a document this device means to create — an invoice, a collection.
 * The server keeps it as the document's own id and as the key that makes a
 * resent create answer with the document already made, so it must not collide
 * with one minted on another phone in the same millisecond: the clock and the
 * counter alone would.
 */
export function makeDocumentId(): string {
  counter += 1;
  return `m-${Date.now().toString(36)}-${counter.toString(36)}-${randomHalf()}${randomHalf()}`;
}
