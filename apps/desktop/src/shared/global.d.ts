import type { MezanBridge } from "./ipc-contract.js";

/**
 * Ambient typing for the renderer-side global the preload bridge installs
 * (see preload/index.ts). apps/web is the actual renderer and owns its own
 * consumption of `window.mezan`; this declaration documents the contract
 * from the desktop side so the shape stays in one place.
 */
declare global {
  interface Window {
    readonly mezan?: MezanBridge;
  }
}

export {};
