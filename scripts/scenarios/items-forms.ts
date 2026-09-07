import type { Ctx } from "./harness.js";

/**
 * Executable checks for the الأصناف create/edit sub-pages — docs/TESTING.md §7.15.
 *
 * These five forms became URL-addressable pages, and that move put weight on
 * two things a side panel never needed:
 *
 *   1. The ADDRESS has to identify the record. The forms put a business code
 *      in the path (`…/items/IT-0001`), and the screen resolves it with
 *      `find(row => row.code === segment)`. A duplicate code makes that `find`
 *      pick an arbitrary row, so a reader who clicked «تعديل» on one item
 *      would silently edit another. Uniqueness is a UI correctness property
 *      here, not just a data nicety.
 *   2. A page can be entered COLD, with none of the state a click would have
 *      set. `…/items/new` shows the next free code, computed from the list —
 *      which is empty for the first frame after a reload. That is how the form
 *      came to offer ITM-000001, a code already taken.
 *
 * What this module cannot see stays manual (ITMF-001…, SPCF-001…,
 * TPLF-001… in docs/TESTING.md §7.15): layout, the Back button, the sticky header, RTL
 * mirroring. What it can do is drive the exact request each form sends and
 * assert the address contract the pages are built on.
 */
export async function run(ctx: Ctx): Promise<void> {
  await addressKeysAreUnique(ctx);
  await everyListedRowHasAResolvableAddress(ctx);
  await unknownAddressResolvesToNothing(ctx);
  await ctx.scenario("items-forms / the add page's next code is free and the duplicate is refused", () => nextCodeIsFree(ctx));
  await ctx.scenario("items-forms / the item form's own create and edit payloads round-trip", () => itemFormRoundTrip(ctx));
  await ctx.scenario("items-forms / the specification form's create and edit payloads round-trip", () => specificationFormRoundTrip(ctx));
  await ctx.scenario("items-forms / the product-template form's payload round-trips", () => templateFormRoundTrip(ctx));
  await ctx.scenario("items-forms / the BOM form's payload round-trips", () => bomFormRoundTrip(ctx));
  await ctx.scenario("items-forms / the configurable-product form's payload round-trips", () => configurableFormRoundTrip(ctx));
}

/** `nextItemCode` in ItemsScreen.tsx, mirrored so the scenario tests what ships. */
function nextItemCode(count: number): string {
  return `ITM-${String(count + 1).padStart(6, "0")}`;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

/**
 * ITMF-003 / SPCF-002 / TPLF-002 — the address key identifies exactly one record.
 */
async function addressKeysAreUnique(ctx: Ctx): Promise<void> {
  await ctx.scenario("items-forms / every address key the forms route on is unique", async () => {
    for (const [label, path, key] of [
      ["items", "/items", "code"],
      ["specifications", "/item-specifications", "code"],
      ["product templates", "/inventory/product-templates", "code"],
    ] as const) {
      const rows = await ctx.allRows(path);
      const keys = rows.map((r: any) => String(r[key] ?? ""));
      ctx.check(`${label}: every row carries a non-empty ${key}`, keys.every((k) => k !== ""), `${keys.filter((k) => k === "").length} blank`);
      const dupes = duplicates(keys);
      ctx.check(`${label}: no two rows share a ${key}`, dupes.length === 0, dupes.join(", "));
    }
  });
}

/**
 * ITMF-003 / ITMF-005 — what the list draws and what the edit address resolves are the
 * same set. The screen looks the row up in the SAME list it just drew, so a row
 * that is drawn but not findable by its own code is a dead «تعديل» button.
 */
async function everyListedRowHasAResolvableAddress(ctx: Ctx): Promise<void> {
  await ctx.scenario("items-forms / every row the list draws resolves from its own address", async () => {
    const items = await ctx.allRows("/items");
    ctx.check("the catalogue is not empty, so the check means something", items.length > 0, `${items.length} items`);
    const unresolvable = items.filter((row: any) => items.filter((r: any) => r.code === row.code || r.id === row.code).length !== 1);
    ctx.check("each item's code finds exactly one row", unresolvable.length === 0, unresolvable.slice(0, 3).map((r: any) => r.code).join(", "));

    // The uuid form of the address has to keep working: it is what every link
    // written before the forms moved to codes still carries.
    const byId = items.filter((row: any) => items.filter((r: any) => r.id === row.id).length !== 1);
    ctx.check("each item's id finds exactly one row", byId.length === 0);
  });
}

/**
 * ITMF-008 / SPCF-005 — an address naming no record resolves to nothing, which is what
 * lets the page show «لم يتم العثور على هذا الصنف» instead of a blank form
 * that would create a second record on save.
 */
async function unknownAddressResolvesToNothing(ctx: Ctx): Promise<void> {
  await ctx.scenario("items-forms / an address that names no record resolves to nothing", async () => {
    const items = await ctx.allRows("/items");
    ctx.check("no item answers to a made-up code", !items.some((r: any) => r.code === "IT-DOES-NOT-EXIST" || r.id === "IT-DOES-NOT-EXIST"));

    const specs = await ctx.allRows("/item-specifications");
    ctx.check("no specification answers to a made-up code", !specs.some((r: any) => r.code === "NOPE-404"));

    const direct = await ctx.req("GET", "/items/IT-DOES-NOT-EXIST");
    ctx.check("and the route refuses it rather than inventing a row", direct.status === 404 || direct.status === 400, `status ${direct.status}`);
  });
}

/**
 * ITMF-010 — the code «إضافة صنف» offers must be free. The page computes it
 * from the loaded catalogue; if it ever computes from an empty one it offers
 * ITM-000001, and this is the assertion that fails.
 */
async function nextCodeIsFree(ctx: Ctx): Promise<void> {
  const items = await ctx.allRows("/items");
  const offered = nextItemCode(items.length);
  ctx.check("the offered code is not already taken", !items.some((r: any) => r.code === offered), offered);

  const created = await ctx.req("POST", "/items", {
    id: crypto.randomUUID(),
    code: offered,
    nameAr: "صنف من صفحة الإضافة",
    type: "stock",
    baseUnitCode: "PCS",
    trackInventory: true,
    revenueAccountId: "4100",
    cogsAccountId: "5100",
    inventoryAccountId: "1200",
  });
  ctx.check("creating with the offered code succeeds", created.ok, `status ${created.status}`);

  // The cold-load defect this guards: ITM-000001 is taken, and the route must
  // say so rather than quietly making a second item with a duplicate code.
  const clash = await ctx.req("POST", "/items", {
    id: crypto.randomUUID(),
    code: offered,
    nameAr: "نفس الكود مرة أخرى",
    type: "stock",
    baseUnitCode: "PCS",
    trackInventory: true,
    revenueAccountId: "4100",
    cogsAccountId: "5100",
    inventoryAccountId: "1200",
  });
  ctx.check("re-using it is refused", !clash.ok, `status ${clash.status}`);
}

/**
 * ITMF-017 / ITMF-018 — the shapes `draftToItem` builds, both halves. The edit
 * half strips `id` and `code` before PATCHing, so this asserts the code
 * SURVIVES the edit: it is the address the page was reached at, and an edit
 * that silently renamed it would break the URL the user is standing on.
 */
async function itemFormRoundTrip(ctx: Ctx): Promise<void> {
  const id = crypto.randomUUID();
  const code = `ITM-FORM-${Date.now().toString().slice(-6)}`;
  const created = await ctx.req("POST", "/items", {
    id,
    code,
    nameAr: "صنف اختبار صفحة النموذج",
    nameEn: "Form page test item",
    type: "stock",
    baseUnitCode: "PCS",
    barcodes: ["6221000000017"],
    salePrice: "180.00",
    costPrice: "140.00",
    taxRatePercent: 14,
    trackInventory: true,
    costingMethod: "WAC",
    revenueAccountId: "4100",
    cogsAccountId: "5100",
    inventoryAccountId: "1200",
  });
  ctx.check("create returns 2xx", created.ok, `status ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);

  const patched = await ctx.req("PATCH", `/items/${id}`, {
    nameAr: "صنف اختبار صفحة النموذج — بعد التعديل",
    nameEn: "Form page test item (edited)",
    salePrice: "195.00",
    status: "inactive",
  });
  ctx.check("edit returns 2xx", patched.ok, `status ${patched.status}`);

  const after = (await ctx.allRows("/items")).find((r: any) => r.id === id);
  ctx.check("the edited name is what came back", after?.nameEn === "Form page test item (edited)", String(after?.nameEn));
  ctx.check("the status the form set stuck", after?.status === "inactive", String(after?.status));
  ctx.check("and the CODE the address is keyed on did not move", after?.code === code, `${after?.code} vs ${code}`);
}

/**
 * SPCF-004 — the specification form's two payloads. The edit form
 * disables «الكود» and «النوع» and omits both from its patch, so this asserts
 * they survive an edit that changes everything else.
 */
async function specificationFormRoundTrip(ctx: Ctx): Promise<void> {
  const code = `SPCFORM${Date.now().toString().slice(-5)}`;
  const created = await ctx.req("POST", "/item-specifications", {
    code,
    nameAr: "مواصفة من صفحة النموذج",
    nameEn: "Form page spec",
    type: "select",
    values: ["أحمر", "أخضر"],
    unit: null,
    filterable: true,
  });
  ctx.check("create returns 2xx", created.ok, `status ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);

  const patched = await ctx.req("PATCH", `/item-specifications/${encodeURIComponent(code)}`, {
    nameAr: "مواصفة معدّلة",
    nameEn: "Form page spec (edited)",
    values: ["أحمر", "أخضر", "أزرق"],
    unit: null,
    filterable: false,
    status: "inactive",
  });
  ctx.check("edit returns 2xx", patched.ok, `status ${patched.status}`);

  const after = (await ctx.allRows("/item-specifications")).find((r: any) => r.code === code);
  ctx.check("the third allowed value was added", (after?.values ?? []).length === 3, JSON.stringify(after?.values));
  ctx.check("the toggle the form flipped stuck", after?.filterable === false, String(after?.filterable));
  ctx.check("the code the address is keyed on did not move", after?.code === code);
  ctx.check("and the type, which the edit form disables, did not move", after?.type === "select", String(after?.type));
}

/** TPLF-003 — «قالب منتج جديد» sends exactly these five fields. */
async function templateFormRoundTrip(ctx: Ctx): Promise<void> {
  const code = `TPL-FORM-${Date.now().toString().slice(-5)}`;
  const created = await ctx.req("POST", "/inventory/product-templates", {
    code,
    nameAr: "قالب من صفحة النموذج",
    baseUnitCode: "PCS",
    defaultSalePrice: "120.00",
    defaultCost: "90.00",
  });
  ctx.check("create returns 2xx", created.ok, `status ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);

  // The form navigates to the new template's own address on success, so the
  // code it was created with has to come back on the created row.
  const after = (await ctx.allRows("/inventory/product-templates")).find((r: any) => r.code === code);
  ctx.check("the new template is addressable by the code just sent", after !== undefined, code);
  ctx.check("and it starts with no attributes, as the empty form implies", (after?.attributes ?? []).length === 0);
}

/** BOMF-002 — «قائمة مواد جديدة» sends lines as strings, not numbers. */
async function bomFormRoundTrip(ctx: Ctx): Promise<void> {
  const items = await ctx.allRows("/items");
  const product = items.find((r: any) => r.type === "stock");
  const component = items.find((r: any) => r.type === "stock" && r.id !== product?.id);
  if (!product || !component) {
    ctx.check("the seed has two stock items to build a BOM from", false, `${items.length} items`);
    return;
  }
  const id = crypto.randomUUID();
  const created = await ctx.req("POST", "/manufacturing/boms", {
    id,
    productItemId: product.id,
    standardQty: "1",
    unit: product.baseUnitCode,
    laborCost: "0",
    overheadCost: "0",
    versionNotes: "من صفحة النموذج",
    lines: [{ itemId: component.id, qty: "2", wastePercent: 0 }],
  });
  ctx.check("create returns 2xx", created.ok, `status ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);

  const after = (await ctx.allRows("/manufacturing/boms")).find((r: any) => r.id === id);
  ctx.check("the BOM came back with its one line", (after?.lines ?? []).length === 1, JSON.stringify(after?.lines ?? []).slice(0, 120));
  ctx.check("bound to the component the picker chose, by real id", after?.lines?.[0]?.itemId === component.id);
}

/** CFGF-002 — the configurable-product form's inputs/materials/formulas payload. */
async function configurableFormRoundTrip(ctx: Ctx): Promise<void> {
  const items = await ctx.allRows("/items");
  const output = items.find((r: any) => r.type === "stock");
  const material = items.find((r: any) => r.type === "stock" && r.id !== output?.id);
  if (!output || !material) {
    ctx.check("the seed has two stock items to configure from", false);
    return;
  }
  const id = crypto.randomUUID();
  const code = `CFG-FORM-${Date.now().toString().slice(-5)}`;
  const created = await ctx.req("POST", "/manufacturing/configurable-products", {
    id,
    code,
    nameAr: "منتج قابل للتهيئة من صفحة النموذج",
    nameEn: null,
    outputItemId: output.id,
    unit: output.baseUnitCode,
    description: null,
    inputs: [{ id: "width", labelAr: "العرض", min: 10, max: 300 }],
    materials: [{ itemId: material.id, qtyFormula: "width/100", wastePercent: 0 }],
    pricingMethod: "formula",
    priceFormula: "width*3.5",
    laborFormula: null,
    overheadFormula: null,
    itemPolicy: "per_order",
  });
  ctx.check("create returns 2xx", created.ok, `status ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);

  const after = (await ctx.allRows("/manufacturing/configurable-products")).find((r: any) => r.id === id);
  ctx.check("the input the form defined came back", (after?.inputs ?? []).length === 1, JSON.stringify(after?.inputs ?? []).slice(0, 120));
  // A zod wire schema strips unknown keys, so a formula the client sends and
  // the contract omits vanishes behind a cheerful 201 — assert it survived.
  ctx.check("and so did the price formula it was priced by", after?.priceFormula === "width*3.5", String(after?.priceFormula));
}
