let tail: Promise<unknown> = Promise.resolve();

/**
 * Serialises the moments an archive is being written with the moment a drill
 * picks one up. `createArchive` writes straight to the final `.mezanbak` name,
 * so a drill that picked the newest file mid-write would report a healthy
 * backup as damaged.
 */
export function withBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}
