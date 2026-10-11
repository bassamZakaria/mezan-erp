export const RACERS = 3;

// The same request sent by several callers in one tick. A handler that reads,
// hands the connection back around outside work and then writes lets every one
// of them through; `invariant` states what must hold whoever won.
export async function raced<T>(
  attempt: (racer: number) => Promise<T>,
  invariant: (answers: readonly T[]) => void | Promise<void>,
  racers: number = RACERS,
): Promise<readonly T[]> {
  const answers = await Promise.all(Array.from({ length: racers }, (_, racer) => attempt(racer)));
  await invariant(answers);
  return answers;
}
