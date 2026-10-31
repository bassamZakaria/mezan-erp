export enum DeploymentEnvironment {
  Production = "production",
  Staging = "staging",
}

// CONTRACT: the server writes this <meta> into every page it serves; the web app reads it to show the staging badge.
export const DEPLOYMENT_ENVIRONMENT_META = "mezan-environment";

export function parseDeploymentEnvironment(raw: string | undefined): DeploymentEnvironment | undefined {
  const value = raw?.trim().toLowerCase();
  return Object.values(DeploymentEnvironment).find((env) => env === value);
}
