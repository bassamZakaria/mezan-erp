import type { Supplier } from "./supplier.js";

/** Persistence port for the supplier master (docs/archive/catalog/02 "الموردون"). */
export interface SupplierRepository {
  findAll(): Promise<readonly Supplier[]>;
  findById(id: string): Promise<Supplier | null>;
  findByCode(code: string): Promise<Supplier | null>;
  save(supplier: Supplier): Promise<void>;
  insert(supplier: Supplier): Promise<void>;
}
