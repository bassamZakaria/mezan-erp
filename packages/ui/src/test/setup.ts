import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest doesn't run with `test.globals: true` in this repo, so
// @testing-library/react's automatic afterEach cleanup (which relies on a
// global `afterEach`) never registers itself — do it explicitly instead.
afterEach(() => {
  cleanup();
});
