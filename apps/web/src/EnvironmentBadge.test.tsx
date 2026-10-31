// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { DEPLOYMENT_ENVIRONMENT_META, DeploymentEnvironment } from "@mezan/contracts";
import { EnvironmentBadge } from "./EnvironmentBadge";
import { renderWithProviders } from "./data/test-support";

function markPage(content: string) {
  const meta = document.createElement("meta");
  meta.name = DEPLOYMENT_ENVIRONMENT_META;
  meta.content = content;
  document.head.append(meta);
}

function removeMarks() {
  document.head.querySelectorAll(`meta[name="${DEPLOYMENT_ENVIRONMENT_META}"]`).forEach((meta) => meta.remove());
}

afterEach(removeMarks);

describe("EnvironmentBadge", () => {
  it("shows the staging badge when the server marks the page as staging", () => {
    markPage(DeploymentEnvironment.Staging);
    renderWithProviders(<EnvironmentBadge />);
    expect(screen.getByRole("note")).toHaveTextContent("STAGING");
  });

  it("shows nothing on production or an unmarked page", () => {
    markPage(DeploymentEnvironment.Production);
    const production = renderWithProviders(<EnvironmentBadge />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    production.unmount();

    removeMarks();
    renderWithProviders(<EnvironmentBadge />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
