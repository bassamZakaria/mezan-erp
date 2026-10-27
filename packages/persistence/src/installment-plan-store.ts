import Database from "better-sqlite3";
import type { SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, type InstallmentLine } from "@mezan/domain";
import type { DocumentRepository } from "@mezan/domain";
import type { SqlDb } from "./sql/sql-db.js";
import {
  createDocumentStore,
  createSqliteDocumentStore,
  createStandaloneSqliteDocumentStore,
  ensureDocumentSchema,
  ensureDocumentTable,
  type SqliteDocumentStoreHandle,
} from "./document-store.js";

const DOC_TYPE = "INSTALLMENT_PLAN";

interface WireLine {
  no: number;
  customerId: string;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string | null;
  frequency: string;
  downPayment: string;
  dueDate: string;
  amount: string;
  paidAmount: string;
  status: string;
  lateFeeAmount: string;
}

function serializeLine(line: InstallmentLine): WireLine {
  return {
    no: line.no,
    customerId: line.customerId,
    sourceInvoiceId: line.sourceInvoiceId,
    sourceInvoiceNumber: line.sourceInvoiceNumber,
    frequency: line.frequency,
    downPayment: line.downPayment.toString(),
    dueDate: line.dueDate,
    amount: line.amount.toString(),
    paidAmount: line.paidAmount.toString(),
    status: line.status,
    lateFeeAmount: line.lateFeeAmount.toString(),
  };
}

function deserializeLine(wire: unknown): InstallmentLine {
  const w = wire as WireLine;
  return {
    no: w.no,
    customerId: w.customerId,
    sourceInvoiceId: w.sourceInvoiceId,
    sourceInvoiceNumber: w.sourceInvoiceNumber,
    frequency: w.frequency as InstallmentLine["frequency"],
    downPayment: Money.fromMajor(w.downPayment),
    dueDate: w.dueDate,
    amount: Money.fromMajor(w.amount),
    paidAmount: Money.fromMajor(w.paidAmount),
    status: w.status as InstallmentLine["status"],
    lateFeeAmount: Money.fromMajor(w.lateFeeAmount),
  };
}

export function createSqliteInstallmentPlanStore(sqlite: Database.Database) {
  ensureDocumentTable(sqlite);
  return createSqliteDocumentStore<InstallmentLine>(sqlite, DOC_TYPE, serializeLine, deserializeLine);
}

export function createStandaloneSqliteInstallmentPlanStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteDocumentStoreHandle<InstallmentLine> {
  return createStandaloneSqliteDocumentStore<InstallmentLine>(DOC_TYPE, serializeLine, deserializeLine, path);
}

export async function ensureInstallmentPlanSchema(db: SqlDb): Promise<void> {
  await ensureDocumentSchema(db);
}

export function createInstallmentPlanStore(db: SqlDb): DocumentRepository<InstallmentLine> {
  return createDocumentStore<InstallmentLine>(db, DOC_TYPE, serializeLine, deserializeLine);
}
