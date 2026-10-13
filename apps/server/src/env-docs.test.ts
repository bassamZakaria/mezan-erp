import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (file: string): string => readFileSync(path.join(repoRoot, file), "utf8");

const SAMPLES: Readonly<Record<string, string>> = {
  MEZAN_TENANT_DOMAIN: "mezan.example",
  MEZAN_PUBLIC_URL: "https://app.mezan.example",
  MEZAN_ORIGIN_SECRET: "an-origin-secret-of-sufficient-length",
  MEZAN_PLATFORM_OWNER_EMAIL: "owner@mezan.example",
  MEZAN_PLATFORM_OWNER_PASSWORD: "a-long-owner-password",
  MEZAN_REVIEW_PIN: "482913",
  MEZAN_SUPPORT_EMAIL: "support@mezan.example",
};

interface DocumentedTable {
  readonly name: string;
  readonly variables: Record<string, string>;
}

function documentedTables(file: string): DocumentedTable[] {
  const tables: DocumentedTable[] = [];
  const block = /<!-- env-table: (\S+) -->([\s\S]*?)<!-- \/env-table -->/g;
  for (const [, name, body] of read(file).matchAll(block)) {
    const variables: Record<string, string> = {};
    for (const line of body!.split("\n")) {
      const cells = line.split("|").map((cell) => cell.trim());
      const variable = /^`([A-Z][A-Z0-9_]*)`$/.exec(cells[1] ?? "")?.[1];
      if (!variable) continue;
      const literal = /^`([^`]+)`$/.exec(cells[2] ?? "")?.[1];
      const value = literal ?? SAMPLES[variable];
      if (value === undefined) throw new Error(`${file}: ${variable} has no literal value in the table and no sample in this test`);
      variables[variable] = value;
    }
    tables.push({ name: name!, variables });
  }
  return tables;
}

function renderBlueprintVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [, key, value] of read("render.yaml").matchAll(/- key: (\S+)\n\s+value: "?([^"\n]+)"?/g)) variables[key!] = value!;
  return variables;
}

const DOCUMENTED = ["docs/DEPLOY-AWS.md", "docs/DEPLOY-REVIEW.md", "docs/DEPLOY-DEMO.md"].flatMap((file) =>
  documentedTables(file).map((table) => ({ file, ...table })),
);

describe("every deployment's documented environment", () => {
  it("has a table for AWS, the reviewer stack and the Render demo", () => {
    expect(DOCUMENTED.map((table) => table.name).sort()).toEqual(["aws", "render", "review"]);
  });

  it.each(DOCUMENTED)("starts the server as $file documents it ($name), with a counted proxy hop and a public origin", ({ variables }) => {
    const env = parseEnv(variables);

    expect(env.trustProxy).toBe(true);
    expect(env.clientSource.trustedProxyHops).toBeGreaterThan(0);
    expect(env.publicOrigin).toMatch(/^https:\/\//);
  });

  it("counts two hops behind CloudFront and API Gateway and one behind Render's proxy", () => {
    const hops = Object.fromEntries(DOCUMENTED.map((table) => [table.name, table.variables["MEZAN_TRUSTED_PROXY_HOPS"]]));
    expect(hops).toEqual({ aws: "2", review: "2", render: "1" });
  });

  it("refuses to start on the proxy variable alone, which is what a stack that has not been given the hop count sets", () => {
    const aws = DOCUMENTED.find((table) => table.name === "aws")!.variables;
    const { MEZAN_TRUSTED_PROXY_HOPS: _hops, ...withoutTheCount } = aws;

    expect(() => parseEnv(withoutTheCount)).toThrow(/MEZAN_TRUSTED_PROXY_HOPS/);
  });
});

describe("render.yaml", () => {
  it("starts the server, and says what docs/DEPLOY-DEMO.md says it sets", () => {
    const blueprint = renderBlueprintVariables();
    const documented = DOCUMENTED.find((table) => table.name === "render")!.variables;

    expect(blueprint).toEqual(documented);
    const env = parseEnv({ ...blueprint, MEZAN_DEMO_PASSWORD: "a-demo-password" });
    expect(env.clientSource.trustedProxyHops).toBe(1);
    expect(env.publicOrigin).toBe("https://mezan-demo.onrender.com");
  });
});
