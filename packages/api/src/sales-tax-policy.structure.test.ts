import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * D79 round 5: a quote's conversion built its invoice service with no VAT
 * policy, so a tenant with VAT switched off posted 14%. Every place that
 * builds a sales invoice or quote service outside a test must hand it the
 * tenant's policy — this reads the sources so a new caller cannot forget.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [HERE, join(HERE, "../../backend/src")];
const CONSTRUCTORS = ["new SalesInvoiceService(", "new SalesQuoteService("];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(" || text[i] === "{") depth += 1;
    if (text[i] === ")" || text[i] === "}") depth -= 1;
    if (depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

function declarationOf(text: string, identifier: string): string {
  const at = text.search(new RegExp(`const ${identifier}\\b[^=]*= `));
  if (at < 0) return "";
  const open = text.indexOf("{", at);
  return open < 0 ? "" : balanced(text, open);
}

function carriesTaxPolicy(text: string, argument: string): boolean {
  if (/\btaxPolicy\b/.test(argument)) return true;
  const names = argument.trim().startsWith("{")
    ? [...argument.matchAll(/\.\.\.(\w+)/g)].map((match) => match[1] as string)
    : [argument.trim()];
  return names.some((name) => /\btaxPolicy\b/.test(declarationOf(text, name)));
}

describe("every sales invoice and quote service is built with the tenant's VAT policy", () => {
  const constructions = ROOTS.flatMap(sourceFiles).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return CONSTRUCTORS.flatMap((constructor) => {
      const found: { file: string; argument: string; text: string }[] = [];
      for (let at = text.indexOf(constructor); at >= 0; at = text.indexOf(constructor, at + 1)) {
        found.push({ file, text, argument: balanced(text, at + constructor.length - 1) });
      }
      return found;
    });
  });

  it("finds the constructions it is meant to guard", () => {
    expect(constructions.length).toBeGreaterThanOrEqual(8);
  });

  it("none is built without `taxPolicy`", () => {
    const missing = constructions.filter((c) => !carriesTaxPolicy(c.text, c.argument)).map((c) => `${c.file.split("/packages/")[1]}: ${c.argument.slice(0, 60).replace(/\s+/g, " ")}`);
    expect(missing).toEqual([]);
  });
});
