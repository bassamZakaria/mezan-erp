import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnv, type CloudEnv } from "./env.js";
import { tenantPublicOrigin, trustedPublicOrigin } from "./public-origin.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const docsDir = path.join(repoRoot, "docs");

const DEPLOYMENT_DOMAIN = "review.example.com";

const SAMPLE_VALUES: Record<string, string> = {
  MEZAN_TENANT_DOMAIN: DEPLOYMENT_DOMAIN,
  MEZAN_ORIGIN_SECRET: "an-origin-secret-cloudfront-adds",
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
    const named = rows.filter((row) => SERVER_VARIABLE.test(/^`([^`]+)`$/.exec(row[0] ?? "")?.[1] ?? ""));
    if (!named.some((row) => (row[0] ?? "").includes("MEZAN_"))) continue;
    if (named.length !== rows.length) {
      throw new Error(`${source}: every row of a server environment table names exactly one variable in backticks; got "${rows.find((row) => !named.includes(row))?.[0] ?? ""}"`);
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

const SIGNUP_HOSTS = [DEPLOYMENT_DOMAIN, `www.${DEPLOYMENT_DOMAIN}`, `signup.${DEPLOYMENT_DOMAIN}`, `demo.${DEPLOYMENT_DOMAIN}`];
const servesNoTenant = async (): Promise<boolean> => false;

function arrivingOn(host: string): Request {
  return new Request("http://internal/api/signup", { method: "POST", headers: { host, "x-forwarded-host": host } });
}

async function signupLinkOrigins(env: CloudEnv): Promise<(string | null)[]> {
  return Promise.all(SIGNUP_HOSTS.map((host) => trustedPublicOrigin(arrivingOn(host), env, servesNoTenant)));
}

describe("every deployment this repository documents", () => {
  it("is found: the reviewer stack's table, the demo's two command lines and the Render blueprint", () => {
    expect(DOCUMENTED.map((deployment) => deployment.source)).toEqual([
      "docs/DEPLOY-REVIEW.md",
      "docs/DEPLOY-DEMO.md (command 1)",
      "docs/DEPLOY-DEMO.md (command 2)",
      "render.yaml",
    ]);
  });

  it.each(DOCUMENTED)("$source starts on exactly the variables it lists", (deployment) => {
    expect(() => parseEnv(varsOf(deployment, false))).not.toThrow();
  });

  const withMailDocumented = DOCUMENTED.filter((deployment) => deployment.variables.some((variable) => variable.name === "MEZAN_SMTP_HOST"));

  it("includes at least one that documents platform mail", () => {
    expect(withMailDocumented.map((deployment) => deployment.source)).toContain("docs/DEPLOY-REVIEW.md");
  });

  it.each(withMailDocumented)("$source, with the mail variables it lists, starts and builds every mailed link on its own public address", async (deployment) => {
    const env = parseEnv(varsOf(deployment, true));

    expect(env.platformSmtp).toBeDefined();
    expect(await signupLinkOrigins(env)).toEqual(SIGNUP_HOSTS.map(() => `https://${DEPLOYMENT_DOMAIN}`));
    expect(tenantPublicOrigin(env, "demo")).toBe(`https://${DEPLOYMENT_DOMAIN}`);
  });
});
