import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const aliases: Record<string, string> = {
  "@mezan/domain": "packages/domain/src/index.ts",
  "@mezan/contracts": "packages/contracts/src/index.ts",
  "@mezan/persistence": "packages/persistence/src/index.ts",
  "@mezan/api": "packages/api/src/index.ts",
  "@mezan/backend": "packages/backend/src/index.ts",
};

function resolveImport(from: string, specifier: string): string | null {
  const alias = aliases[specifier];
  if (alias) return path.join(root, alias);
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier.replace(/\.js$/, ""));
  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((candidate) => existsSync(candidate)) ?? null;
}

function workspaceModulesLoadedBy(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [path.join(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)) {
      const resolved = resolveImport(file, match[1]!);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen].map((file) => path.relative(root, file)).sort();
}

describe("the setup files every test worker loads", () => {
  it("load only the recorders they drain, never a package's whole index", () => {
    const config = readFileSync(path.join(root, "vitest.config.ts"), "utf8");
    const setupFiles = [...config.matchAll(/"((?:packages|apps)\/[^"]+\/test\/[^"]+\.ts)"/g)].map((match) => match[1]!);
    expect(setupFiles).toContain("packages/api/src/test/turn-yield-guard.ts");
    const loaded = setupFiles.flatMap(workspaceModulesLoadedBy);
    expect(loaded.filter((file) => file.endsWith("/index.ts"))).toEqual([]);
    expect(loaded.length).toBeLessThanOrEqual(6);
  });
});
