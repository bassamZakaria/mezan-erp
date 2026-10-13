import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bootCloudHarness, HARNESS_CLIENT, HARNESS_PROXY_HOP, type CloudHarness } from "./cloud-harness.js";

const harnesses: CloudHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PROXY_VARIABLES = ["MEZAN_TRUST_PROXY", "MEZAN_TRUSTED_PROXY_HOPS"] as const;
const FORWARDED_CHAIN = `${HARNESS_CLIENT}, ${HARNESS_PROXY_HOP}`;

function proxyVariablesInRenderYaml(): Record<string, string | undefined> {
  const blueprint = readFileSync(path.join(repoRoot, "render.yaml"), "utf8");
  return Object.fromEntries(
    PROXY_VARIABLES.map((name) => [name, new RegExp(`- key: ${name}\\s+value: "?([^"\\n]+)"?`).exec(blueprint)?.[1]]),
  );
}

async function checkCodeStatus(vars: Record<string, string | undefined>): Promise<number> {
  const cloud = await bootCloudHarness({ vars });
  harnesses.push(cloud);
  const res = await cloud.send("/api/signup/check-code?code=acme-co", { chain: FORWARDED_CHAIN });
  return res.status;
}

describe("the cloud app as the deployed entry point serves it: no socket under the request, the caller in a forwarded chain", () => {
  it("answers the public signup check when the proxy is trusted and its hops are counted", async () => {
    expect(await checkCodeStatus({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2" })).toBe(200);
  });

  it("answers the public signup check under the proxy variables render.yaml sets", async () => {
    expect(await checkCodeStatus(proxyVariablesInRenderYaml())).toBe(200);
  });
});
