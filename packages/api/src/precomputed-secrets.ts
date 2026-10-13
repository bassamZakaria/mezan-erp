import type { SecretHasher } from "@mezan/domain";

export interface SecretsToPrecompute {
  readonly hash?: readonly string[];
  readonly verify?: readonly (readonly [secret: string, hash: string])[];
}

export interface PrecomputingHasher {
  readonly hasher: SecretHasher;
  precompute(secrets: SecretsToPrecompute): Promise<() => void>;
}

interface Ready<T> {
  readonly value: T;
}

const verdictKey = (secret: string, hash: string) => `${hash}\u0000${secret}`;

function take<T>(store: Map<string, Ready<T>[]>, key: string): Ready<T> | undefined {
  const waiting = store.get(key);
  const ready = waiting?.pop();
  if (waiting?.length === 0) store.delete(key);
  return ready;
}

function put<T>(store: Map<string, Ready<T>[]>, key: string, value: T): () => void {
  const ready: Ready<T> = { value };
  const waiting = store.get(key);
  if (waiting) waiting.push(ready);
  else store.set(key, [ready]);
  return () => {
    const left = (store.get(key) ?? []).filter((entry) => entry !== ready);
    if (left.length === 0) store.delete(key);
    else store.set(key, left);
  };
}

// scrypt runs on the thread pool, so awaiting it inside a transaction gives the
// event loop to every other request while the BEGIN is open. A route does the
// slow work here first; inside the transaction the same call then resolves
// without leaving the microtask queue. The plaintext sits in these maps only
// between `precompute` and the release its caller must run.
export function createPrecomputingHasher(inner: SecretHasher): PrecomputingHasher {
  const hashes = new Map<string, Ready<string>[]>();
  const verdicts = new Map<string, Ready<boolean>[]>();
  return {
    hasher: {
      hash(secret) {
        const ready = take(hashes, secret);
        return ready ? Promise.resolve(ready.value) : inner.hash(secret);
      },
      verify(secret, hash) {
        const ready = take(verdicts, verdictKey(secret, hash));
        return ready ? Promise.resolve(ready.value) : inner.verify(secret, hash);
      },
    },
    async precompute(secrets) {
      const toHash = secrets.hash ?? [];
      const toVerify = secrets.verify ?? [];
      const [hashed, verified] = await Promise.all([
        Promise.all(toHash.map((secret) => inner.hash(secret))),
        Promise.all(toVerify.map(([secret, hash]) => inner.verify(secret, hash))),
      ]);
      const drops = [
        ...toHash.map((secret, index) => put(hashes, secret, hashed[index]!)),
        ...toVerify.map(([secret, hash], index) => put(verdicts, verdictKey(secret, hash), verified[index]!)),
      ];
      return () => {
        for (const drop of drops) drop();
      };
    },
  };
}
