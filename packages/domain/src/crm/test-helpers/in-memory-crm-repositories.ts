import type { Activity, ActivityRepository } from "../activity.js";
import type { Lead, LeadRepository } from "../lead.js";
import type { Opportunity, OpportunityRepository } from "../opportunity.js";
import type { PipelineStage, PipelineStageRepository } from "../pipeline-stage.js";

/** A trivial in-memory {@link LeadRepository} fake for domain-layer unit tests. */
export function createInMemoryLeadRepository(): LeadRepository {
  const rows = new Map<string, Lead>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(lead) {
      rows.set(lead.id, lead);
    },
    async update(lead) {
      rows.set(lead.id, lead);
    },
  };
}

/** A trivial in-memory {@link OpportunityRepository} fake for domain-layer unit tests. */
export function createInMemoryOpportunityRepository(): OpportunityRepository {
  const rows = new Map<string, Opportunity>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(opportunity) {
      rows.set(opportunity.id, opportunity);
    },
    async update(opportunity) {
      rows.set(opportunity.id, opportunity);
    },
  };
}

/** A trivial in-memory {@link PipelineStageRepository} fake for domain-layer unit tests. */
export function createInMemoryPipelineStageRepository(): PipelineStageRepository {
  const rows = new Map<string, PipelineStage>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(stage) {
      rows.set(stage.id, stage);
    },
    async update(stage) {
      rows.set(stage.id, stage);
    },
  };
}

/** A trivial in-memory {@link ActivityRepository} fake for domain-layer unit tests. */
export function createInMemoryActivityRepository(): ActivityRepository {
  const rows = new Map<string, Activity>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(activity) {
      rows.set(activity.id, activity);
    },
    async update(activity) {
      rows.set(activity.id, activity);
    },
  };
}
