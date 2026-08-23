import type { LeaveAccrualBatch, LeaveAccrualBatchRepository } from "../accrual-batch.js";

export function createInMemoryAccrualBatchRepository(): LeaveAccrualBatchRepository {
  const byId = new Map<string, LeaveAccrualBatch>();

  return {
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async findByPeriod(period) {
      return [...byId.values()].find((b) => b.period === period) ?? null;
    },
    async list() {
      return [...byId.values()];
    },
    async create(batch) {
      byId.set(batch.id, batch);
    },
    async update(batch) {
      byId.set(batch.id, batch);
    },
  };
}
