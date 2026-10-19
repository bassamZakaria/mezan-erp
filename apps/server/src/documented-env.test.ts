import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const docsDir = path.join(repoRoot, "docs");

const DEPLOYMENT_DOMAIN = "demo.example.com";

const SAMPLE_VALUES: Record<string, string> = {
  MEZAN_TENANT_DOMAIN: DEPLOYMENT_DOMAIN,
  MEZAN_ORIGIN_SECRET: "an-origin-secret-of-sufficient-length",
  MEZAN_PLATFORM_OWNER_EMAIL: "owner@example.com",
  MEZAN_PLATFORM_OWNER_PASSWORD: "owner-password-123",
  MEZAN_REVIEW_PIN: "654321",
  MEZAN_SUPPORT_EMAIL: "support@example.com",
  MEZAN_SMTP_HOST: "smtp.example.com",
  MEZAN_SMTP_FROM_EMAIL: "no-reply@example.com",
  MEZAN_PUBLIC_URL: `https://${DEPLOYMENT_DOMAIN}`,
  MEZAN_DEMO_PASSWORD: "a-demo-password",
};

interface DocumentedVariable {
  readonly name: string;
  readonly value: string;
  readonly onlyWithMail: boolean;
}

interface DocumentedDeployment {
  readonly source: string;
  readonly variables: readonly DocumentedVariable[];
}

const SERVER_VARIABLE = /^(?:MEZAN_[A-Z0-9_]+|PORT|NODE_ENV)$/;
const LITERAL_CELL = /^`([^`<>]+)`$/;
const OPTIONAL_CELL = /^optional\b/i;

function valueOf(name: string, cell: string, source: string): string {
  const literal = LITERAL_CELL.exec(cell)?.[1];
  if (literal !== undefined) return literal;
  const sample = SAMPLE_VALUES[name];
  if (sample === undefined) throw new Error(`${source} documents ${name} as "${cell}", which is not a literal value: give it a sample in SAMPLE_VALUES`);
  return sample;
}

function tablesIn(markdown: string): string[][][] {
  const tables: string[][][] = [];
  let current: string[][] | null = null;
  for (const line of markdown.split("\n")) {
    if (!line.trimStart().startsWith("|")) {
      current = null;
      continue;
    }
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (!current) tables.push((current = []));
    current.push(cells);
  }
  return tables;
}

function deploymentsInMarkdown(file: string): DocumentedDeployment[] {
  const source = path.relative(repoRoot, file);
  const found: DocumentedDeployment[] = [];
  for (const [header, , ...rows] of tablesIn(readFileSync(file, "utf8"))) {
    if (header?.[0] !== "Variable") continue;
    const nameIn = (row: string[]): string | undefined => /^`([^`]+)`$/.exec(row[0] ?? "")?.[1];
    const named = rows.filter((row) => SERVER_VARIABLE.test(nameIn(row) ?? ""));
    if (!named.some((row) => (row[0] ?? "").includes("MEZAN_"))) continue;
    const malformed = rows.find((row) => nameIn(row) === undefined);
    if (malformed) {
      throw new Error(`${source}: every row of a server environment table names exactly one variable in backticks; got "${malformed[0] ?? ""}"`);
    }
    found.push({
      source,
      variables: named.map((row) => {
        const name = (row[0] ?? "").slice(1, -1);
        const cell = row[1] ?? "";
        return { name, value: valueOf(name, cell, source), onlyWithMail: OPTIONAL_CELL.test(cell) };
      }),
    });
  }
  return found;
}

function deploymentInBlueprint(): DocumentedDeployment {
  const blueprint = readFileSync(path.join(repoRoot, "render.yaml"), "utf8");
  const variables: DocumentedVariable[] = [];
  for (const match of blueprint.matchAll(/^\s*- key: (\S+)\n(?:\s*#.*\n)*\s*(value|sync): (.+)$/gm)) {
    const [, name = "", kind, raw = ""] = match;
    if (!SERVER_VARIABLE.test(name)) continue;
    variables.push({ name, value: kind === "value" ? raw.trim().replace(/^"(.*)"$/, "$1") : valueOf(name, "set in the dashboard", "render.yaml"), onlyWithMail: false });
  }
  return { source: "render.yaml", variables };
}

function deploymentsInCommandLines(file: string): DocumentedDeployment[] {
  const source = path.relative(repoRoot, file);
  const blocks = readFileSync(file, "utf8").match(/```sh\n[\s\S]*?```/g) ?? [];
  return blocks
    .map((block) => [...block.replace(/\\\n/g, " ").matchAll(/\b(MEZAN_[A-Z0-9_]+)=(\S+)/g)].map(([, name = "", value = ""]) => ({ name, value, onlyWithMail: false })))
    .filter((variables) => variables.length > 0)
    .map((variables, index) => ({ source: `${source} (command ${index + 1})`, variables }));
}

const deployDocs = readdirSync(docsDir).filter((name) => /^DEPLOY-.*\.md$/.test(name)).map((name) => path.join(docsDir, name));
const DOCUMENTED: DocumentedDeployment[] = [
  ...deployDocs.flatMap(deploymentsInMarkdown),
  ...deployDocs.flatMap(deploymentsInCommandLines),
  deploymentInBlueprint(),
];

const varsOf = (deployment: DocumentedDeployment, withMail: boolean): Record<string, string> =>
  Object.fromEntries(deployment.variables.filter((variable) => withMail || !variable.onlyWithMail).map((variable) => [variable.name, variable.value]));

describe("every deployment this repository documents", () => {
  it("is found: the demo guide's table, its two command lines and the Render blueprint", () => {
    expect(DOCUMENTED.map((deployment) => deployment.source)).toEqual([
      "docs/DEPLOY-DEMO.md",
      "docs/DEPLOY-DEMO.md (command 1)",
      "docs/DEPLOY-DEMO.md (command 2)",
      "render.yaml",
    ]);
  });

  it.each(DOCUMENTED)("$source starts on exactly the variables it lists", (deployment) => {
    expect(() => parseEnv(varsOf(deployment, false))).not.toThrow();
  });
});
