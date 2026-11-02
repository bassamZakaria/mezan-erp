// Writes every active company user (Postgres books) as a Firebase Auth import file, keeping their password.
// Run on the server, then import from a machine signed in to the Firebase CLI:
//   MEZAN_DATABASE_URL=... node apps/server/scripts/firebase-export-users.mjs > users.json
//   firebase auth:import users.json --project mezan-erp-prod --hash-algo=STANDARD_SCRYPT \
//     --mem-cost=16384 --parallelization=1 --block-size=8 --dk-len=64
// users.json holds password hashes: delete it after the import.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const SEED_ADMIN_USER_ID = "USER-ADMIN";
// CONTRACT: packages/persistence/src/secret-hasher.ts — scrypt$<salt hex>$<hash hex>, Node's defaults N=16384 r=8 p=1, 64 bytes.
const SCRYPT_HASH = /^scrypt\$([0-9a-f]+)\$([0-9a-f]{128})$/;

export function importRecord(row) {
  const email = row.email.trim().toLowerCase();
  const record = { localId: createHash("sha256").update(email).digest("hex").slice(0, 28), email, emailVerified: true };
  if (row.name_ar || row.name_en) record.displayName = row.name_ar || row.name_en;
  const hash = SCRYPT_HASH.exec(row.password_hash ?? "");
  // A temporary password is never carried over: that user sets one through «نسيت كلمة المرور».
  // Postgres BIGINT reaches pg as a string: "0" is truthy.
  if (hash && Number(row.must_change_password) === 0) {
    record.passwordHash = Buffer.from(hash[2], "hex").toString("base64");
    record.salt = Buffer.from(hash[1], "hex").toString("base64");
  }
  return record;
}

async function main() {
  const url = process.env.MEZAN_DATABASE_URL;
  if (!url) throw new Error("set MEZAN_DATABASE_URL");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: schemas } = await client.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 't\\_%' ORDER BY schema_name`);
    const users = new Map();
    for (const { schema_name: schema } of schemas) {
      const { rows } = await client.query(
        `SELECT id, email, name_ar, name_en, password_hash, must_change_password FROM "${schema}"."user" WHERE status = 'active' AND id <> $1 AND coalesce(email, '') <> ''`,
        [SEED_ADMIN_USER_ID],
      );
      for (const row of rows) {
        const record = importRecord(row);
        if (users.has(record.email)) {
          process.stderr.write(`skipped ${record.email} in ${schema}: already exported from another company\n`);
          continue;
        }
        users.set(record.email, record);
      }
    }
    process.stdout.write(JSON.stringify({ users: [...users.values()] }));
    process.stderr.write(`${users.size} users exported\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
