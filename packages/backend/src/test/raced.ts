export const RACERS = 3;

export async function raced<T>(
  attempt: (racer: number) => Promise<T>,
  invariant: (answers: readonly T[]) => void | Promise<void>,
  racers: number = RACERS,
): Promise<readonly T[]> {
  const answers = await Promise.all(Array.from({ length: racers }, (_, racer) => attempt(racer)));
  await invariant(answers);
  return answers;
}
