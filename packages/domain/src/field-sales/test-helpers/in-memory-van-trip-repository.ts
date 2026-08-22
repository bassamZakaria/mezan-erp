import type { VanTrip, VanTripRepository } from "../van-trip.js";

/** A trivial in-memory {@link VanTripRepository} fake for domain-layer unit tests. */
export function createInMemoryVanTripRepository(): VanTripRepository {
  const rows = new Map<string, VanTrip>();
  return {
    async findById(id: string): Promise<VanTrip | null> {
      return rows.get(id) ?? null;
    },
    async list(): Promise<VanTrip[]> {
      return [...rows.values()];
    },
    async create(trip: VanTrip): Promise<void> {
      rows.set(trip.id, trip);
    },
    async update(trip: VanTrip): Promise<void> {
      rows.set(trip.id, trip);
    },
  };
}
