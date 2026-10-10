export interface ReturnableSourceLine {
  readonly sourceLineId: string;
  readonly itemId: string;
  readonly label: string;
}

export interface SourceLineOption {
  readonly value: string;
  readonly label: string;
}

// An item sold or bought on two lines — at two prices, or two tax rates — is two
// options, numbered so the user can tell which line a return reverses.
export function sourceLineOptions(lines: readonly ReturnableSourceLine[]): SourceLineOption[] {
  const perItem = new Map<string, number>();
  for (const line of lines) perItem.set(line.itemId, (perItem.get(line.itemId) ?? 0) + 1);
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const position = (seen.get(line.itemId) ?? 0) + 1;
    seen.set(line.itemId, position);
    const repeated = (perItem.get(line.itemId) ?? 0) > 1;
    return { value: line.sourceLineId, label: repeated ? `${line.label} · ${position}` : line.label };
  });
}
