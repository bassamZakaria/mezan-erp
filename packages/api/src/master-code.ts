/**
 * The next free `<prefix>NNNNNN` code among `existing`, for a master record
 * created without one. Allocated here rather than by the client: a screen only
 * ever holds a filtered page of the list, and counting that page reissued codes
 * that were already taken.
 */
export function nextMasterCode(existing: readonly string[], prefix: string): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const code of existing) {
    const match = pattern.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}
