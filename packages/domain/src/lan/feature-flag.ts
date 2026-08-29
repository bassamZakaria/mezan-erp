/**
 * LAN multi-till — the feature flag gating the whole capability (docs/archive/plan.md
 * §2.6, §6.3.3): "bind the same Hono app to a LAN port ... gate it behind a
 * license flag." One tenant/license may activate `sales`/`pos`/etc. as
 * MODULES while still being single-machine; LAN serving is a narrower
 * capability layered on top, so it lives in `entitlements.features`, read via
 * `hasFeature()`, not `activeModules`.
 */
export const LAN_MULTI_TILL_FEATURE = "lan.multi_till";
