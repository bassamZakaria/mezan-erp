import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contaboDir = path.join(repoRoot, "deploy/contabo");

const SAMPLE_VALUES: Record<string, string> = {
  MEZAN_ORIGIN_SECRET: "an-origin-secret-of-sufficient-length",
  MEZAN_SECRETS_KEY: "a".repeat(64),
  MEZAN_AUDIT_ANCHOR_SIGNING_KEY: "b".repeat(64),
  MEZAN_AUDIT_ANCHOR_S3_ACCESS_KEY_ID: "access-key-id",
  MEZAN_AUDIT_ANCHOR_S3_SECRET_ACCESS_KEY: "secret-access-key",
  MEZAN_SMTP_USERNAME: "smtp-user",
  MEZAN_SMTP_PASSWORD: "smtp-password",
  MEZAN_AUDIT_CHAIN_KEY: "c".repeat(64),
  MEZAN_TENANT_DB_SECRET: "d".repeat(64),
};

const SERVER_VARIABLE = /^(?:MEZAN_[A-Z0-9_]+|PORT|NODE_ENV)$/;

function envFileVariables(file: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [, name = "", raw = ""] of readFileSync(path.join(contaboDir, file), "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) {
    if (!SERVER_VARIABLE.test(name)) continue;
    const value = raw.trim() || SAMPLE_VALUES[name];
    if (value === undefined) throw new Error(`deploy/contabo/${file} leaves ${name} empty: give it a sample in SAMPLE_VALUES`);
    variables[name] = value;
  }
  return variables;
}

function composePinnedVariables(): Record<string, string> {
  const compose = readFileSync(path.join(contaboDir, "docker-compose.yml"), "utf8");
  const block = /^ {4}environment:\n((?: {6}\S.*\n)+)/m.exec(compose)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/^ {6}([A-Z][A-Z0-9_]*): "?([^"\n]+)"?$/gm)].map(([, name = "", value = ""]) => [name, value]));
}

const contaboVariables = (): Record<string, string> => ({
  ...envFileVariables(".env.example"),
  ...envFileVariables("shared.env.example"),
  ...composePinnedVariables(),
});

describe("the Contabo deployment as deploy/contabo documents it", () => {
  it("pins the proxy chain in docker-compose.yml: Caddy is the one hop", () => {
    expect(composePinnedVariables()).toMatchObject({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" });
  });

  it("starts the server on exactly the variables it lists, counting one proxy hop, with a public origin", () => {
    const env = parseEnv(contaboVariables());

    expect(env.trustProxy).toBe(true);
    expect(env.clientSource).toEqual({ trustedProxyHops: 1 });
    expect(env.publicOrigin).toMatch(/^https:\/\//);
  });

  it("refuses to start on the proxy variable alone, which is what a stack that has not been given the hop count sets", () => {
    const { MEZAN_TRUSTED_PROXY_HOPS: _hops, ...withoutTheCount } = contaboVariables();

    expect(() => parseEnv(withoutTheCount)).toThrow(/MEZAN_TRUSTED_PROXY_HOPS/);
  });
});
