import type { Customer } from "./customer.js";

/** Persistence port for the customer master (docs/archive/catalog/01 "العملاء"). */
export interface CustomerRepository {
  findAll(): Promise<readonly Customer[]>;
  findById(id: string): Promise<Customer | null>;
  findByCode(code: string): Promise<Customer | null>;
  save(customer: Customer): Promise<void>;
  insert(customer: Customer): Promise<void>;
}
