import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { run } from "./codemod.mjs";

/**
 * One file, one dictionary, one namespace: rewrite the source, then add the
 * keys the file actually introduced to the catalogue.
 *
 * A dictionary value of "@some.key" reuses an existing entry — the shared
 * vocabulary (`common.*`, `docStatus.*`) is why most screens add far fewer
 * keys than they have strings.
 */
const [, , file, dictPath, ns] = process.argv;
const dict = JSON.parse(readFileSync(dictPath, "utf8"));
const res = run(file, dict, ns);

if (res.missing) {
  console.log(JSON.stringify({ missing: res.missing }, null, 1));
  process.exit(1);
}

if (Object.keys(res.fresh).length) {
  const tmp = `/tmp/_keys_${ns}.json`;
  writeFileSync(tmp, JSON.stringify(res.fresh, null, 1));
  execFileSync("node", ["scripts/i18n/add-keys.mjs", tmp, ns], { stdio: "inherit" });
}
console.log(`${file}: ${res.rewritten} nodes, ${Object.keys(res.fresh).length} new keys, ${res.componentCount} components hooked`);
if (res.moduleScope.length) console.log("MODULE SCOPE (needs manual handling):", JSON.stringify(res.moduleScope, null, 1));
