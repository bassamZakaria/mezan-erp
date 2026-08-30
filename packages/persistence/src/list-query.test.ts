import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { FilterClauses, selectPage, countMatching, childRowsByParent } from "./list-query.js";

function seededDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE item (id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL, category TEXT);
    CREATE TABLE line (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, seq INTEGER NOT NULL);
  `);
  const insert = db.prepare(`INSERT INTO item (id, name, price, category) VALUES (?, ?, ?, ?)`);
  insert.run("i1", "Alpha", 100, "A");
  insert.run("i2", "Beta", 200, "B");
  insert.run("i3", "Gamma", 300, "A");
  insert.run("i4", "Delta", 400, null);
  return db;
}

describe("FilterClauses", () => {
  it("produces no WHERE clause when nothing is filtered", () => {
    const where = new FilterClauses();
    expect(where.sql).toBe("");
    expect(where.values).toEqual([]);
  });

  it("skips undefined, null, and empty-string values", () => {
    const where = new FilterClauses().eq("category", undefined).eq("category", null).eq("category", "");
    expect(where.sql).toBe("");
    expect(where.values).toEqual([]);
  });

  it("combines eq/gte/lte/raw with AND, binding values in call order", () => {
    const where = new FilterClauses()
      .eq("category", "A")
      .gte("price", 100)
      .lte("price", 500)
      .raw("name LIKE ?", "%a%");
    expect(where.sql).toBe("WHERE category = ? AND price >= ? AND price <= ? AND name LIKE ?");
    expect(where.values).toEqual(["A", 100, 500, "%a%"]);
  });

  it("raw() can bind more than one parameter for a single fragment", () => {
    const where = new FilterClauses().raw("status IN (?,?)", "draft", "posted");
    expect(where.sql).toBe("WHERE status IN (?,?)");
    expect(where.values).toEqual(["draft", "posted"]);
  });
});

describe("selectPage", () => {
  it("returns every row in ORDER BY order when no filter and no page are given", () => {
    const db = seededDb();
    try {
      const rows = selectPage<{ id: string }>(db, {
        table: "item",
        where: new FilterClauses(),
        orderBy: "price ASC",
      });
      expect(rows.map((r) => r.id)).toEqual(["i1", "i2", "i3", "i4"]);
    } finally {
      db.close();
    }
  });

  it("applies the filter", () => {
    const db = seededDb();
    try {
      const rows = selectPage<{ id: string }>(db, {
        table: "item",
        where: new FilterClauses().eq("category", "A"),
        orderBy: "price ASC",
      });
      expect(rows.map((r) => r.id)).toEqual(["i1", "i3"]);
    } finally {
      db.close();
    }
  });

  it("returns an empty array for a filter that matches nothing", () => {
    const db = seededDb();
    try {
      const rows = selectPage<{ id: string }>(db, {
        table: "item",
        where: new FilterClauses().eq("category", "Z"),
        orderBy: "price ASC",
      });
      expect(rows).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("applies LIMIT/OFFSET only when a page is given", () => {
    const db = seededDb();
    try {
      const page1 = selectPage<{ id: string }>(db, {
        table: "item",
        where: new FilterClauses(),
        orderBy: "price ASC",
        page: { limit: 2, offset: 0 },
      });
      const page2 = selectPage<{ id: string }>(db, {
        table: "item",
        where: new FilterClauses(),
        orderBy: "price ASC",
        page: { limit: 2, offset: 2 },
      });
      expect(page1.map((r) => r.id)).toEqual(["i1", "i2"]);
      expect(page2.map((r) => r.id)).toEqual(["i3", "i4"]);
    } finally {
      db.close();
    }
  });

  it("defaults offset to 0 when a limit is given without one", () => {
    const db = seededDb();
    try {
      const rows = selectPage<{ id: string }>(db, {
        table: "item",
        where: new FilterClauses(),
        orderBy: "price ASC",
        page: { limit: 1 },
      });
      expect(rows.map((r) => r.id)).toEqual(["i1"]);
    } finally {
      db.close();
    }
  });

  it("selects only the requested columns", () => {
    const db = seededDb();
    try {
      const rows = selectPage<{ id: string; name: string }>(db, {
        table: "item",
        where: new FilterClauses(),
        orderBy: "price ASC",
        columns: "id, name",
      });
      expect(rows[0]).toEqual({ id: "i1", name: "Alpha" });
    } finally {
      db.close();
    }
  });
});

describe("countMatching", () => {
  it("counts every row when nothing is filtered", () => {
    const db = seededDb();
    try {
      expect(countMatching(db, "item", new FilterClauses())).toBe(4);
    } finally {
      db.close();
    }
  });

  it("counts only the rows the filter matches", () => {
    const db = seededDb();
    try {
      expect(countMatching(db, "item", new FilterClauses().eq("category", "A"))).toBe(2);
    } finally {
      db.close();
    }
  });

  it("returns 0 for a filter that matches nothing", () => {
    const db = seededDb();
    try {
      expect(countMatching(db, "item", new FilterClauses().eq("category", "Z"))).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("childRowsByParent", () => {
  it("groups child rows by parent id, ordered within each group", () => {
    const db = seededDb();
    try {
      const insert = db.prepare(`INSERT INTO line (item_id, seq) VALUES (?, ?)`);
      insert.run("i1", 2);
      insert.run("i1", 1);
      insert.run("i2", 1);
      const grouped = childRowsByParent<{ item_id: string; seq: number }>(db, {
        table: "line",
        parentColumn: "item_id",
        parentIds: ["i1", "i2", "i3"],
        orderBy: "seq ASC",
      });
      expect(grouped.get("i1")?.map((r) => r.seq)).toEqual([1, 2]);
      expect(grouped.get("i2")?.map((r) => r.seq)).toEqual([1]);
      expect(grouped.has("i3")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("returns an empty map when parentIds is empty", () => {
    const db = seededDb();
    try {
      const grouped = childRowsByParent(db, {
        table: "line",
        parentColumn: "item_id",
        parentIds: [],
        orderBy: "seq ASC",
      });
      expect(grouped.size).toBe(0);
    } finally {
      db.close();
    }
  });

  it("chunks lookups that exceed the bound-parameter ceiling into multiple queries", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE line (item_id TEXT NOT NULL, seq INTEGER NOT NULL)`);
      const insert = db.prepare(`INSERT INTO line (item_id, seq) VALUES (?, ?)`);
      const parentIds: string[] = [];
      for (let i = 0; i < 1200; i++) {
        const id = `p${i}`;
        parentIds.push(id);
        insert.run(id, i);
      }
      const grouped = childRowsByParent<{ item_id: string; seq: number }>(db, {
        table: "line",
        parentColumn: "item_id",
        parentIds,
        orderBy: "seq ASC",
      });
      expect(grouped.size).toBe(1200);
      expect(grouped.get("p0")?.[0]?.seq).toBe(0);
      expect(grouped.get("p1199")?.[0]?.seq).toBe(1199);
    } finally {
      db.close();
    }
  });
});
