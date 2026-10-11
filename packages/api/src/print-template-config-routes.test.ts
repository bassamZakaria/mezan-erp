import { describe, it, expect } from "vitest";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, type PrintTemplateConfig, type PrintTemplateConfigRepository } from "@mezan/domain";
import { createPrintTemplateConfigRoutes } from "./print-template-config-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
class InMemoryPrintTemplateConfigRepo implements PrintTemplateConfigRepository {
  private saved: PrintTemplateConfig | null = null;
  async get() {
    return this.saved;
  }
  async save(config: PrintTemplateConfig) {
    this.saved = config;
  }
}

function newApp() {
  const repo = new InMemoryPrintTemplateConfigRepo();
  const app = createPrintTemplateConfigRoutes({ repo }, insecureHeaderAuthContextResolver);
  return { app, repo };
}

const ADMIN = "*";
function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("print-template-config-routes — GET", () => {
  it("returns the catalog default before any config is saved", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: ADMIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PrintTemplateConfig;
    expect(body).toEqual(DEFAULT_PRINT_TEMPLATE_CONFIG);
  });

  it("403s without admin.settings.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "" }));
    expect(res.status).toBe(403);
  });
});

describe("print-template-config-routes — PUT", () => {
  it("round-trips a valid config via a subsequent GET", async () => {
    const { app, repo } = newApp();
    const next: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      pageSize: "A5",
      identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, primaryColor: "#123456" },
    };
    const putRes = await app.fetch(
      req("/", { method: "PUT", permissions: ADMIN, body: JSON.stringify(next) }),
    );
    expect(putRes.status).toBe(200);
    expect(((await putRes.json()) as PrintTemplateConfig).pageSize).toBe("A5");
    expect(await repo.get()).toEqual(next);

    const getRes = await app.fetch(req("/", { permissions: ADMIN }));
    const body = (await getRes.json()) as PrintTemplateConfig;
    expect(body.pageSize).toBe("A5");
    expect(body.identity.primaryColor).toBe("#123456");
  });

  it("400s an invalid body (watermark.opacity out of range)", async () => {
    const { app } = newApp();
    const invalid = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      watermark: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.watermark, opacity: 5 },
    };
    const res = await app.fetch(
      req("/", { method: "PUT", permissions: ADMIN, body: JSON.stringify(invalid) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("403s without admin.settings.edit", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "PUT",
        permissions: "admin.settings.view",
        body: JSON.stringify(DEFAULT_PRINT_TEMPLATE_CONFIG),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("print-template-config-routes — a logo stored before the size limit", () => {
  const oversize = `data:image/png;base64,${"A".repeat(300_000)}`;
  const put = (app: ReturnType<typeof newApp>["app"], config: PrintTemplateConfig) =>
    app.fetch(req("/", { method: "PUT", permissions: ADMIN, body: JSON.stringify(config) }));

  it("does not block a later save that leaves it as it is", async () => {
    const { app, repo } = newApp();
    await repo.save({ ...DEFAULT_PRINT_TEMPLATE_CONFIG, identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, logoUrl: oversize } });
    const stored = (await repo.get())!;

    const res = await put(app, { ...stored, footer: { ...stored.footer }, pageSize: "A5" });

    expect(res.status).toBe(200);
    expect((await repo.get())!.pageSize).toBe("A5");
    expect((await repo.get())!.identity.logoUrl).toBe(oversize);
  });

  it("still refuses a new logo over the limit, in Arabic, and one swapped in beside the stored one", async () => {
    const { app, repo } = newApp();
    const fresh = await put(app, { ...DEFAULT_PRINT_TEMPLATE_CONFIG, identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, logoUrl: oversize } });
    expect(fresh.status).toBe(400);
    expect(await fresh.json()).toMatchObject({ error: "VALIDATION_ERROR", message: expect.stringContaining("الشعار") });

    await repo.save({ ...DEFAULT_PRINT_TEMPLATE_CONFIG, identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, logoUrl: oversize } });
    const other = await put(app, { ...DEFAULT_PRINT_TEMPLATE_CONFIG, identity: { ...DEFAULT_PRINT_TEMPLATE_CONFIG.identity, logoUrl: `${oversize}B` } });
    expect(other.status).toBe(400);
  });
});
