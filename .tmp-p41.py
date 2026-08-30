p = "packages/persistence/src/bank-reconciliation-repository.ts"
s = open(p).read()
o = """  sqlite.exec(CREATE_TABLES);"""
n = """  sqlite.exec(CREATE_TABLES);
  const statementColumns = new Set(
    (sqlite.prepare(`PRAGMA table_info(bank_statement)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of [
    ["unmatched_at_finalize", "INTEGER"],
    ["finalize_override_reason", "TEXT"],
    ["finalized_by", "TEXT"],
  ] as const) {
    if (!statementColumns.has(name)) sqlite.exec(`ALTER TABLE bank_statement ADD COLUMN ${name} ${type}`);
  }"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
