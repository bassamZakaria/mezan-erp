import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { sha256File } from "./checksum.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmpDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "mezan-checksum-"));
  dirs.push(d);
  return d;
}

describe("sha256File", () => {
  it("matches node:crypto's own digest of the same bytes", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "sample.txt");
    const content = "Mezan backup checksum fixture\n".repeat(500);
    await writeFile(file, content, "utf8");

    const expected = createHash("sha256").update(content).digest("hex");
    await expect(sha256File(file)).resolves.toBe(expected);
  });

  it("produces different digests for different contents", async () => {
    const dir = await tmpDir();
    const fileA = path.join(dir, "a.bin");
    const fileB = path.join(dir, "b.bin");
    await writeFile(fileA, "alpha");
    await writeFile(fileB, "beta");

    const [a, b] = await Promise.all([sha256File(fileA), sha256File(fileB)]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects when the file does not exist", async () => {
    const dir = await tmpDir();
    await expect(sha256File(path.join(dir, "missing.bin"))).rejects.toThrow();
  });
});
