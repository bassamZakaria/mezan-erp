import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest doesn't run with `test.globals: true` in this repo, so
// @testing-library/react's automatic afterEach cleanup (which relies on a
// global `afterEach`) never registers itself — do it explicitly instead.
afterEach(() => {
  cleanup();
});

// jsdom implements no layout, so it ships no `Element.scrollIntoView`. Every
// real browser has it, and the components that keep an active listbox option
// or a focused row in view call it — without this stub those components throw
// in a test and pass in production, which is the wrong way round.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
