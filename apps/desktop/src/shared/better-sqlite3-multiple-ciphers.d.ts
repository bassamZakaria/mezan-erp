// `better-sqlite3-multiple-ciphers` is `better-sqlite3` plus SQLCipher, and it
// ships the same `index.d.ts`. As of 13.0.3 its package.json `exports` map has
// no `types` condition, so a modern `moduleResolution` finds the runtime entry
// and no declarations — TS7016 on an import of a package that is, in fact,
// fully typed. Re-pointing it at better-sqlite3's typings is exact, not a
// convenience `any`: the two packages are the same API surface, which is the
// whole reason main/encrypted-database.ts can hand either one to
// @mezan/persistence's `SqliteDriver`.
declare module "better-sqlite3-multiple-ciphers" {
  import Database = require("better-sqlite3");
  export = Database;
}
