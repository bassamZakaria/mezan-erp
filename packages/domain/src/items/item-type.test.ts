import { describe, it, expect } from "vitest";
import {
  ITEM_TYPES,
  itemTypeCapabilities,
  itemTypeTracksStock,
  itemTypeIsSellable,
  itemTypeIsPurchasable,
  itemTypeIsBomComponent,
  itemTypeIsBomOutput,
} from "./item-type.js";

describe("item type capabilities", () => {
  it("lists all six item types", () => {
    expect(ITEM_TYPES).toEqual(["stock", "service", "raw_material", "finished_good", "consumable", "recipe"]);
  });

  it("stock (منتج): tracks stock, sellable, purchasable, and a BOM component/output", () => {
    const caps = itemTypeCapabilities("stock");
    expect(caps).toEqual({ tracksStock: true, sellable: true, purchasable: true, bomComponent: true, bomOutput: true });
  });

  it("service: does not track stock but is sellable and purchasable", () => {
    expect(itemTypeTracksStock("service")).toBe(false);
    expect(itemTypeIsSellable("service")).toBe(true);
    expect(itemTypeIsPurchasable("service")).toBe(true);
    expect(itemTypeIsBomComponent("service")).toBe(false);
    expect(itemTypeIsBomOutput("service")).toBe(false);
  });

  it("raw_material: tracks stock and is purchasable/a BOM component, never sellable or a BOM output", () => {
    expect(itemTypeTracksStock("raw_material")).toBe(true);
    expect(itemTypeIsSellable("raw_material")).toBe(false);
    expect(itemTypeIsPurchasable("raw_material")).toBe(true);
    expect(itemTypeIsBomComponent("raw_material")).toBe(true);
    expect(itemTypeIsBomOutput("raw_material")).toBe(false);
  });

  it("finished_good: tracks stock, sellable, never purchasable, and can be a BOM component or output", () => {
    expect(itemTypeTracksStock("finished_good")).toBe(true);
    expect(itemTypeIsSellable("finished_good")).toBe(true);
    expect(itemTypeIsPurchasable("finished_good")).toBe(false);
    expect(itemTypeIsBomComponent("finished_good")).toBe(true);
    expect(itemTypeIsBomOutput("finished_good")).toBe(true);
  });

  it("consumable: tracks stock and is purchasable/a BOM component, never sellable or a BOM output", () => {
    expect(itemTypeTracksStock("consumable")).toBe(true);
    expect(itemTypeIsSellable("consumable")).toBe(false);
    expect(itemTypeIsPurchasable("consumable")).toBe(true);
    expect(itemTypeIsBomComponent("consumable")).toBe(true);
    expect(itemTypeIsBomOutput("consumable")).toBe(false);
  });

  it("recipe: a pure definition — never tracked, sellable, purchasable, or a BOM component; only a BOM output", () => {
    const caps = itemTypeCapabilities("recipe");
    expect(caps).toEqual({ tracksStock: false, sellable: false, purchasable: false, bomComponent: false, bomOutput: true });
  });
});
