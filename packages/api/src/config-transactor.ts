/**
 * The atomic boundary a route-level configuration write shares with the audit
 * row that records it.
 *
 * Document routes inherit one from the service they call (see
 * `PurchaseTransactor` in @mezan/domain). Admin/config routes write straight
 * through a store and had none, so the audit append happened after the
 * configuration had already committed: a sink that threw — or a process that
 * died between the two statements — left a counter reset, a discount ceiling
 * or a till's device serial changed with nothing in the trail saying who did
 * it. That is the one state an append-only trail cannot be repaired into,
 * because the row can never be back-filled.
 *
 * Declared here as a port rather than imported from @mezan/persistence: no
 * production module in this package depends on a driver (same reasoning as
 * `DataMigrationTransactor` in ./data-migration-routes.ts).
 */
export interface ConfigTransactor {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Runs `fn` inside the caller's transaction when one was supplied. Optional so
 * a composition that wires no transactor (route-level unit tests, older
 * embedders) keeps working exactly as before, unatomically.
 */
export function atomically<T>(transactor: ConfigTransactor | undefined, fn: () => Promise<T>): Promise<T> {
  return transactor === undefined ? fn() : transactor.run(fn);
}
