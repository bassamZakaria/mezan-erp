import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/*
 * testing-library's default `waitFor` deadline is 1s, which is generous for a
 * file run on its own and not generous at all for 824 files running fully in
 * parallel: a screen that refetches on a filter change routinely takes longer
 * than that to settle under load. The symptom is a suite that passes per-file
 * and fails a handful of DIFFERENT tests on every full run, which reads as a
 * product bug and is not one. Raising the deadline weakens no assertion — the
 * same condition still has to become true — it only stops the clock deciding.
 */
configure({ asyncUtilTimeout: 5000 });

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
