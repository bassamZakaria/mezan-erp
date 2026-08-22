import type { Project, ProjectRepository } from "../project.js";

/** A trivial in-memory {@link ProjectRepository} fake for domain-layer unit tests. */
export class InMemoryProjectRepository implements ProjectRepository {
  private readonly rows = new Map<string, Project>();

  async findById(id: string): Promise<Project | null> {
    return this.rows.get(id) ?? null;
  }

  async findByCode(code: string): Promise<Project | null> {
    for (const project of this.rows.values()) {
      if (project.code === code) return project;
    }
    return null;
  }

  async list(): Promise<Project[]> {
    return [...this.rows.values()];
  }

  async create(project: Project): Promise<void> {
    this.rows.set(project.id, project);
  }

  async update(project: Project): Promise<void> {
    this.rows.set(project.id, project);
  }
}
