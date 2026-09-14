import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  NO_SIMPLIFIED_REGIME,
  type SimplifiedRegimeElection,
  type SimplifiedRegimeRepository,
  type SimplifiedRegimeState,
} from "@mezan/domain";

/**
 * النظام الضريبي المبسط — one row per tenant recording what the taxpayer filed
 * on Form 1/10, beside the settings bag it belongs with.
 *
 * Columns rather than a JSON blob, unlike `tenant_settings`: an auditor asks
 * for the election date and the form reference by name, and a figure buried in
 * a text column cannot be indexed, queried or migrated. The row is an
 * ASSERTION ABOUT A FILING, not a switch — nothing in the schema lets a write
 * here be mistaken for making an election.
 */
const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS simplified_regime (
  id                    TEXT PRIMARY KEY,
  state                 TEXT NOT NULL,
  elected_on            TEXT,
  form_110_reference    TEXT,
  irrevocable_until     TEXT,
  withdrawn_on          TEXT,
  form_111_reference    TEXT,
  e_invoicing_joined_on TEXT,
  notes                 TEXT,
  recorded_at           TEXT NOT NULL,
  recorded_by           TEXT NOT NULL
);
`;

const ROW_ID = "default";

interface RegimeRow {
  state: string;
  elected_on: string | null;
  form_110_reference: string | null;
  irrevocable_until: string | null;
  withdrawn_on: string | null;
  form_111_reference: string | null;
  e_invoicing_joined_on: string | null;
  notes: string | null;
  recorded_at: string;
  recorded_by: string;
}

function toElection(row: RegimeRow): SimplifiedRegimeElection {
  return {
    state: row.state as SimplifiedRegimeState,
    electedOn: row.elected_on,
    form110Reference: row.form_110_reference,
    irrevocableUntil: row.irrevocable_until,
    withdrawnOn: row.withdrawn_on,
    form111Reference: row.form_111_reference,
    eInvoicingJoinedOn: row.e_invoicing_joined_on,
    notes: row.notes,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  };
}

class SqliteSimplifiedRegimeStore implements SimplifiedRegimeRepository {
  private readonly upsert: Database.Statement;
  private readonly select: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO simplified_regime
        (id, state, elected_on, form_110_reference, irrevocable_until, withdrawn_on,
         form_111_reference, e_invoicing_joined_on, notes, recorded_at, recorded_by)
      VALUES
        (@id, @state, @elected_on, @form_110_reference, @irrevocable_until, @withdrawn_on,
         @form_111_reference, @e_invoicing_joined_on, @notes, @recorded_at, @recorded_by)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        elected_on = excluded.elected_on,
        form_110_reference = excluded.form_110_reference,
        irrevocable_until = excluded.irrevocable_until,
        withdrawn_on = excluded.withdrawn_on,
        form_111_reference = excluded.form_111_reference,
        e_invoicing_joined_on = excluded.e_invoicing_joined_on,
        notes = excluded.notes,
        recorded_at = excluded.recorded_at,
        recorded_by = excluded.recorded_by
    `);
    this.select = sqlite.prepare(`SELECT * FROM simplified_regime WHERE id = ?`);
  }

  async get(): Promise<SimplifiedRegimeElection | null> {
    const row = this.select.get(ROW_ID) as RegimeRow | undefined;
    return row ? toElection(row) : null;
  }

  async save(election: SimplifiedRegimeElection): Promise<void> {
    this.upsert.run({
      id: ROW_ID,
      state: election.state,
      elected_on: election.electedOn,
      form_110_reference: election.form110Reference,
      irrevocable_until: election.irrevocableUntil,
      withdrawn_on: election.withdrawnOn,
      form_111_reference: election.form111Reference,
      e_invoicing_joined_on: election.eInvoicingJoinedOn,
      notes: election.notes,
      recorded_at: election.recordedAt,
      recorded_by: election.recordedBy,
    });
  }
}

/** The tenant's regime record, or the "nothing filed" reading when there is no row. */
export async function readSimplifiedRegime(store: SimplifiedRegimeRepository): Promise<SimplifiedRegimeElection> {
  return (await store.get()) ?? NO_SIMPLIFIED_REGIME;
}

export function createSqliteSimplifiedRegimeStore(sqlite: Database.Database): SimplifiedRegimeRepository {
  sqlite.exec(CREATE_TABLE);
  return new SqliteSimplifiedRegimeStore(sqlite);
}

export interface SqliteSimplifiedRegimeStoreHandle extends SimplifiedRegimeRepository {
  close(): void;
}

/** The same store on its OWN connection — ":memory:" for a test, a path for real. */
export function createStandaloneSqliteSimplifiedRegimeStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteSimplifiedRegimeStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  const store = createSqliteSimplifiedRegimeStore(sqlite) as SimplifiedRegimeRepository;
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteSimplifiedRegimeStoreHandle;
}
