import { describe, expect, it } from "vitest";
import { DeploymentEnvironment, parseDeploymentEnvironment } from "./deployment-environment.js";

describe("parseDeploymentEnvironment", () => {
  it("reads MEZAN_ENV values, ignoring case and spaces", () => {
    expect(parseDeploymentEnvironment(" Staging ")).toBe(DeploymentEnvironment.Staging);
    expect(parseDeploymentEnvironment("production")).toBe(DeploymentEnvironment.Production);
  });

  it("treats anything else as unset", () => {
    expect(parseDeploymentEnvironment(undefined)).toBeUndefined();
    expect(parseDeploymentEnvironment("development")).toBeUndefined();
    expect(parseDeploymentEnvironment("")).toBeUndefined();
  });
});
