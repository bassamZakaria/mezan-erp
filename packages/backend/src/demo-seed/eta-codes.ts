import type { App } from "@mezan/api";
import { step } from "./shared.js";

const SELLER_CODE_PREFIX = "EG-100200300-";
const FIRST_GENERATED_CODE = 9001;

interface ItemMappingRow {
  readonly itemId: string;
  readonly code: string;
  readonly etaItemCode: string | null;
}

export async function registerAuthorityCode(app: App, itemId: string, internalCode: string): Promise<void> {
  await step(app, "PUT", `/eta/item-mappings/${itemId}`, { etaCodeType: "EGS", etaItemCode: `${SELLER_CODE_PREFIX}${internalCode}` });
}

// INVARIANT: runs after the last seed that creates an item. A seeded item with
// no authority code holds every e-document that names it, so none is left
// without one (demo-seed-eta-ready.test.ts walks every item).
export async function registerEveryUnmappedItem(app: App): Promise<void> {
  const { rows } = (await step(app, "GET", "/eta/item-mappings")) as { rows: ItemMappingRow[] };
  const unmapped = rows.filter((row) => !row.etaItemCode).sort((a, b) => a.code.localeCompare(b.code));
  for (const [index, row] of unmapped.entries()) {
    await registerAuthorityCode(app, row.itemId, String(FIRST_GENERATED_CODE + index));
  }
}
