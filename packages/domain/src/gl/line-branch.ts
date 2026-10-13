interface BranchedLine {
  readonly branchId?: string | null;
}

/**
 * LEDGER INVARIANT: a line a posting adds beside a document's own lines — a
 * cost variance on its entry or its reversal — belongs to that document, so it
 * takes the one branch those lines carry. Own lines of several branches, or of
 * none, leave it «غير مخصص»: the branch cannot be told from the entry alone.
 */
export function inBranchOf<Line extends BranchedLine>(own: readonly BranchedLine[], added: readonly Line[]): Line[] {
  const branches = new Set(own.map((line) => line.branchId ?? null));
  const [sole] = [...branches];
  if (branches.size !== 1 || !sole) return [...added];
  return added.map((line) => ({ ...line, branchId: line.branchId ?? sole }));
}
