import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDataMigrationFile } from "../src/lib/data-migration-file.js";
import { STEPS } from "../../../apps/web/src/settings/data-migration-steps.js";

const OUT = join(new URL("../../..", import.meta.url).pathname, "test-fixtures", "data-migration");
let bad = 0;
const seen = new Set<string>();
for (const step of STEPS) {
  if (seen.has(step.spec.id)) continue;
  seen.add(step.spec.id);
  const buf = await readFile(join(OUT, `${step.spec.id}.xlsx`));
  const parsed = await parseDataMigrationFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, step.spec);
  const ok = parsed.rows.length > 0 && parsed.errors.length === 0;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${step.spec.id.padEnd(30)} rows=${parsed.rows.length} parseErrors=${parsed.errors.length}`);
}
console.log(bad === 0 ? "\nevery fixture parses with the app's own parser" : `\n${bad} fixture(s) failed to parse`);
process.exit(bad === 0 ? 0 : 1);
